import type { SQLiteDatabase } from 'expo-sqlite';

import { SELF_TAIKO_NO, type Class, type Crown, type Level } from '@/types';
import { getAlmostConfig, getMainLevels } from './meta';
import { buildRecordQuery, COMPUTED_COLS, getScoreUpdateDays, type RecordListRow } from './records';

/** 「最近スコアを更新した曲」フォルダで遡る、スコア更新日の日数。 */
const RECENT_UPDATE_DAYS = 3;

/** 難易度の表示順（かんたん→裏）。getFolderSongDetails のグルーピングで使う。 */
const LEVEL_ORDER: Record<Level, number> = {
  EASY: 0,
  NORMAL: 1,
  DIFFICULT: 2,
  ONI: 3,
  EXTRA: 4,
};

/**
 * フォルダ機能。手動フォルダ（folders / folder_songs）に加え、記録から動的に算出する
 * スマートフォルダ（ジャンル別 / もうすぐFC / もうすぐDC）を同じ FolderRef で扱う。
 * フォルダの単位は曲（song_number）。お気に入りの曲登録も曲単位なので整合する。
 */

/** フォルダ識別子。スマートフォルダは DB 行を持たずコードで合成する。 */
export type FolderRef =
  | { kind: 'genre'; genreId: string; name: string }
  | { kind: 'almostFc'; name: string }
  | { kind: 'almostDc'; name: string }
  | { kind: 'recent', name: string }
  | { kind: 'mismatchFc'; name: string }
  | { kind: 'mismatchDc'; name: string }
  | { kind: 'options'; name: string }
  | { kind: 'manual'; id: number; name: string }
  | { kind: 'star'; star: number; name: string };

/** フォルダ内の1曲（表示用）。FC/DC では level と残り数（ng/ok）も付く。 */
export interface FolderSongRow {
  song_number: number;
  title: string | null;
  level?: Level;
  crown?: Crown;
  /** もうすぐFC では不可(ng)数、もうすぐDC では可(ok)数。 */
  remaining?: number;
}

/** 一覧表示用の手動フォルダ。count は格納曲数。 */
export interface ManualFolderRow {
  id: number;
  name: string;
  count: number;
}

/** ジャンル/手動フォルダの曲を、難易度ごとの記録付きで返す表示用の型。 */
export interface FolderSongDetail {
  song_number: number;
  title: string | null;
  /** その曲に存在する難易度（charts ∪ 自分の記録）を EASY→EXTRA 順で。 */
  levels: { level: Level; crown: Crown; class: Class; hasRecord: boolean }[];
  /** 各難易度の最新スコアの最大値（並べ替え/絞り込み用）。未記録なら null。 */
  maxScore: number | null;
}

/** 楽曲カタログ検索の1件。手動フォルダへの追加 UI で使う。 */
export interface CatalogSongRow {
  song_number: number;
  title: string | null;
  /** 自分の最新スコアの最大値（全難易度横断）。未記録なら null。 */
  max_score: number | null;
  /** 対象フォルダに既に含まれているか。 */
  in_folder: boolean;
}

// ---------------------------------------------------------------------------
// 手動フォルダ CRUD
// ---------------------------------------------------------------------------

export async function listManualFolders(db: SQLiteDatabase): Promise<ManualFolderRow[]> {
  return db.getAllAsync<ManualFolderRow>(
    `SELECT f.id, f.name, COUNT(fs.song_number) AS count
     FROM folders f
     LEFT JOIN folder_songs fs ON fs.folder_id = f.id
     GROUP BY f.id
     ORDER BY f.sort_order ASC, f.id ASC`,
  );
}

export async function createFolder(db: SQLiteDatabase, name: string): Promise<number> {
  const result = await db.runAsync(
    `INSERT INTO folders (name, sort_order, created_at) VALUES (?, 0, ?)`,
    name,
    Date.now(),
  );
  return result.lastInsertRowId;
}

export async function renameFolder(db: SQLiteDatabase, id: number, name: string): Promise<void> {
  await db.runAsync('UPDATE folders SET name = ? WHERE id = ?', name, id);
}

export async function deleteFolder(db: SQLiteDatabase, id: number): Promise<void> {
  // folder_songs は FK ON DELETE CASCADE で削除される
  await db.runAsync('DELETE FROM folders WHERE id = ?', id);
}

export async function addSongToFolder(
  db: SQLiteDatabase,
  folderId: number,
  songNumber: number,
): Promise<void> {
  await db.runAsync(
    `INSERT INTO folder_songs (folder_id, song_number, added_at) VALUES (?, ?, ?)
     ON CONFLICT(folder_id, song_number) DO NOTHING`,
    folderId,
    songNumber,
    Date.now(),
  );
}

export async function removeSongFromFolder(
  db: SQLiteDatabase,
  folderId: number,
  songNumber: number,
): Promise<void> {
  await db.runAsync(
    'DELETE FROM folder_songs WHERE folder_id = ? AND song_number = ?',
    folderId,
    songNumber,
  );
}

/** その曲が属する手動フォルダ id 配列（FolderPicker のチェック状態用）。 */
export async function getFoldersForSong(
  db: SQLiteDatabase,
  songNumber: number,
): Promise<number[]> {
  const rows = await db.getAllAsync<{ folder_id: number }>(
    'SELECT folder_id FROM folder_songs WHERE song_number = ?',
    songNumber,
  );
  return rows.map((r) => r.folder_id);
}

// ---------------------------------------------------------------------------
// スマートフォルダ用クエリ
// ---------------------------------------------------------------------------

/**
 * 自分(taiko_no='')の各 (song_number, level) のスコア入り最新行。
 * records.ts の LATEST_SCORED_PER_CHART と同等（自分固定）。
 */
const SELF_LATEST_SCORED = /* sql */ `
  SELECT r.* FROM records r
  JOIN (
    SELECT song_number, level, MAX(updated_at) AS mx
    FROM records WHERE taiko_no = ? AND score_total IS NOT NULL
    GROUP BY song_number, level
  ) m ON m.song_number = r.song_number AND m.level = r.level AND m.mx = r.updated_at
  WHERE r.taiko_no = ? AND r.score_total IS NOT NULL
`;

/**
 * 「もうすぐ」系スマートフォルダの行を取得する。
 * almostFc: crown='CLEAR' かつ 不可(ng) が閾値以下、almostDc: crown='FULL_COMBO' かつ 可(ok) が閾値以下。
 */
async function getAlmostSongs(
  db: SQLiteDatabase,
  kind: 'almostFc' | 'almostDc',
): Promise<FolderSongRow[]> {
  const { mode, value, levels } = await getAlmostConfig(db);
  const col = kind === 'almostFc' ? 'r.ng' : 'r.ok';
  const crown = kind === 'almostFc' ? 'CLEAR' : 'FULL_COMBO';
  const threshold =
    mode === 'percent'
      ? `CAST(${col} AS REAL) / (r.good + r.ok + r.ng) * 100 <= ?`
      : `${col} <= ?`;
  const levelPlaceholders = levels.map(() => '?').join(', ');

  return db.getAllAsync<FolderSongRow>(
    /* sql */ `
      SELECT r.song_number, s.title, r.level, r.crown, ${col} AS remaining
      FROM (${SELF_LATEST_SCORED}) r
      JOIN songs s ON s.number = r.song_number
      WHERE r.crown = ?
        AND r.level IN (${levelPlaceholders})
        AND (r.good + r.ok + r.ng) > 0
        AND ${col} > 0
        AND ${threshold}
      ORDER BY remaining ASC, s.title ASC
    `,
    SELF_TAIKO_NO,
    SELF_TAIKO_NO,
    crown,
    ...levels,
    value,
  );
}

// ---------------------------------------------------------------------------
// フォルダ内容の解決（表示・お気に入り共通）
// ---------------------------------------------------------------------------

/** フォルダの曲一覧（表示用）。ref.kind で取得元を切り替える。 */
export async function getFolderSongs(
  db: SQLiteDatabase,
  ref: FolderRef,
): Promise<FolderSongRow[]> {
  switch (ref.kind) {
    case 'genre':
      return db.getAllAsync<FolderSongRow>(
        `SELECT s.number AS song_number, s.title
         FROM genre_songs gs
         JOIN songs s ON s.number = gs.song_number
         WHERE gs.genre_id = ?
         ORDER BY s.title ASC`,
        ref.genreId,
      );
    case 'almostFc':
    case 'almostDc':
      return getAlmostSongs(db, ref.kind);
    case 'mismatchFc':
    case 'mismatchDc': {
      // 「王冠とスコアが異なる曲」。お気に入り反映用に song_number/level/crown を返す。
      const rows = await queryMismatchRows(db, ref.kind);
      return rows.map((r) => ({
        song_number: r.song_number,
        title: r.song_title,
        level: r.level,
        crown: r.crown,
      }));
    }
    case 'options': {
      // 自己ベストで演奏オプションを使用した曲。お気に入り反映用に song_number/level/crown を返す。
      const rows = await queryBestWithOptionsRows(db);
      return rows.map((r) => ({
        song_number: r.song_number,
        title: r.song_title,
        level: r.level,
        crown: r.crown,
      }));
    }
    case 'recent': {
      // 直近 RECENT_UPDATE_DAYS 日分のスコア更新日に更新があった曲を新しい順で集める。
      const days = await getScoreUpdateDays(db, SELF_TAIKO_NO, RECENT_UPDATE_DAYS);
      if (days.length === 0) return [];
      const since = days[days.length - 1].startMs; // 直近 N 日のうち最古の 0:00
      return db.getAllAsync<FolderSongRow>(
        /* sql */ `
          SELECT s.number AS song_number, s.title, MAX(r.updated_at) AS mx
          FROM records r
          JOIN songs s ON s.number = r.song_number
          WHERE r.taiko_no = ? AND r.score_total IS NOT NULL AND r.updated_at >= ?
          GROUP BY s.number
          ORDER BY mx DESC, s.title ASC
        `,
        SELF_TAIKO_NO,
        since,
      );
    }
    case 'manual':
      return db.getAllAsync<FolderSongRow>(
        `SELECT s.number AS song_number, s.title
         FROM folder_songs fs
         JOIN songs s ON s.number = fs.song_number
         WHERE fs.folder_id = ?
         ORDER BY fs.added_at ASC`,
        ref.id,
      );
    case 'star': {
      // メインの難易度の譜面が ref.star（☆の数）に一致する曲を集める。
      const mainLevels = await getMainLevels(db);
      const placeholders = mainLevels.map(() => '?').join(', ');
      return db.getAllAsync<FolderSongRow>(
        /* sql */ `
          SELECT s.number AS song_number, s.title
          FROM songs s
          WHERE EXISTS (
            SELECT 1 FROM charts c
            WHERE c.song_number = s.number
              AND c.level IN (${placeholders})
              AND c.star = ?
          )
          ORDER BY s.title ASC
        `,
        ...mainLevels,
        ref.star,
      );
    }
  }
}

/**
 * 「王冠とスコアが異なる曲」フォルダの中身を RecordListRow で返す。
 * mismatchFc: 王冠＝FC だが最高スコアのリザルトに不可(ng)が残る譜面。
 * mismatchDc: 王冠＝DC だが最高スコアのリザルトに可(ok)/不可(ng)が残る譜面。
 * 「最高スコアのリザルト」は譜面ごとの MAX(score_total) 行（同点は最新優先で1行に確定）から取り、
 * 表示用の王冠/極/更新日時は記録タブと同様に最新行から取る。対象難易度はメインの難易度に従う。
 */
async function queryMismatchRows(
  db: SQLiteDatabase,
  kind: 'mismatchFc' | 'mismatchDc',
): Promise<RecordListRow[]> {
  const mainLevels = await getMainLevels(db);
  const crown: Crown = kind === 'mismatchFc' ? 'FULL_COMBO' : 'DONDAFUL_COMBO';
  // FC: 不可が残る／DC: 可または不可が残る。
  const mismatch =
    kind === 'mismatchFc'
      ? 'IFNULL(r.ng, 0) >= 1'
      : '(IFNULL(r.ng, 0) >= 1 OR IFNULL(r.ok, 0) >= 1)';
  // 不一致の度合いが大きい順（残ノーツが多い順）に並べる。
  const severity = kind === 'mismatchFc' ? 'r.ng DESC' : '(r.ng + r.ok) DESC';
  const levelPlaceholders = mainLevels.map(() => '?').join(', ');

  return db.getAllAsync<RecordListRow>(
    /* sql */ `
      WITH best AS (
        SELECT * FROM (
          SELECT r.*, ROW_NUMBER() OVER (
            PARTITION BY r.song_number, r.level
            ORDER BY r.score_total DESC, r.updated_at DESC, r.id DESC
          ) AS rn
          FROM records r
          WHERE r.taiko_no = ? AND r.score_total IS NOT NULL
        ) WHERE rn = 1
      ),
      latest AS (
        SELECT r.* FROM records r
        JOIN (
          SELECT song_number, level, MAX(updated_at) AS mx
          FROM records WHERE taiko_no = ? GROUP BY song_number, level
        ) m ON m.song_number = r.song_number AND m.level = r.level AND m.mx = r.updated_at
        WHERE r.taiko_no = ?
      )
      SELECT
        r.song_number, s.title AS song_title, r.level,
        l.crown, l.class, r.score_total, r.good, r.ok, r.ng, r.pound,
        lv.star AS star, lv.tier AS tier, l.updated_at,
        ${COMPUTED_COLS},
        (SELECT GROUP_CONCAT(gs.genre_id) FROM genre_songs gs
         WHERE gs.song_number = r.song_number) AS genre_ids
      FROM best r
      JOIN latest l ON l.song_number = r.song_number AND l.level = r.level
      JOIN songs s ON s.number = r.song_number
      LEFT JOIN charts lv ON lv.song_number = r.song_number AND lv.level = r.level
      WHERE l.crown = ?
        AND r.level IN (${levelPlaceholders})
        AND ${mismatch}
      ORDER BY ${severity}, s.title ASC
    `,
    SELF_TAIKO_NO,
    SELF_TAIKO_NO,
    SELF_TAIKO_NO,
    crown,
    ...mainLevels,
  );
}

/**
 * 「自己ベストで演奏オプションを使用した曲」フォルダの中身を RecordListRow で返す。
 * 各譜面の自己ベスト（最高スコア）行のリザルトに演奏オプション（options）が記録されている譜面を集める。
 * 自己ベスト行は譜面ごとの MAX(score_total) 行（同点は最新優先で1行に確定）から取り、
 * 表示用の王冠/極/更新日時は記録タブと同様に最新行から取る。難易度は限定しない（全難易度対象）。
 * options 列（JSON 配列文字列）も返し、行にオプションアイコンを表示できるようにする。
 */
async function queryBestWithOptionsRows(db: SQLiteDatabase): Promise<RecordListRow[]> {
  return db.getAllAsync<RecordListRow>(
    /* sql */ `
      WITH best AS (
        SELECT * FROM (
          SELECT r.*, ROW_NUMBER() OVER (
            PARTITION BY r.song_number, r.level
            ORDER BY r.score_total DESC, r.updated_at DESC, r.id DESC
          ) AS rn
          FROM records r
          WHERE r.taiko_no = ? AND r.score_total IS NOT NULL
        ) WHERE rn = 1
      ),
      latest AS (
        SELECT r.* FROM records r
        JOIN (
          SELECT song_number, level, MAX(updated_at) AS mx
          FROM records WHERE taiko_no = ? GROUP BY song_number, level
        ) m ON m.song_number = r.song_number AND m.level = r.level AND m.mx = r.updated_at
        WHERE r.taiko_no = ?
      )
      SELECT
        r.song_number, s.title AS song_title, r.level,
        l.crown, l.class, r.score_total, r.good, r.ok, r.ng, r.pound, r.options,
        lv.star AS star, lv.tier AS tier, l.updated_at,
        ${COMPUTED_COLS},
        (SELECT GROUP_CONCAT(gs.genre_id) FROM genre_songs gs
         WHERE gs.song_number = r.song_number) AS genre_ids
      FROM best r
      JOIN latest l ON l.song_number = r.song_number AND l.level = r.level
      JOIN songs s ON s.number = r.song_number
      LEFT JOIN charts lv ON lv.song_number = r.song_number AND lv.level = r.level
      WHERE r.options IS NOT NULL AND r.options != '' AND r.options != '[]'
      ORDER BY
        CASE WHEN lv.star IS NULL THEN 1 ELSE 0 END ASC, lv.star DESC,
        r.score_total DESC, s.title ASC
    `,
    SELF_TAIKO_NO,
    SELF_TAIKO_NO,
    SELF_TAIKO_NO,
  );
}

/**
 * スマートフォルダ（もうすぐFC / もうすぐDC / 最近スコアを更新した曲 / 王冠とスコアが異なる曲FC・DC /
 * 自己ベストで演奏オプションを使用した曲）の
 * 中身を、記録一覧と同じ RecordListRow（譜面=song×level 単位）で返す。記録タブと同じ Row で表示する用途。
 * almost は完成に近い順（残数 col 昇順）、recent は更新日時の新しい順で並べる。
 */
export async function getSmartFolderRecords(
  db: SQLiteDatabase,
  ref: FolderRef,
): Promise<RecordListRow[]> {
  if (ref.kind === 'mismatchFc' || ref.kind === 'mismatchDc') {
    return queryMismatchRows(db, ref.kind);
  }

  if (ref.kind === 'options') {
    return queryBestWithOptionsRows(db);
  }

  if (ref.kind === 'recent') {
    const days = await getScoreUpdateDays(db, SELF_TAIKO_NO, RECENT_UPDATE_DAYS);
    if (days.length === 0) return [];
    const since = days[days.length - 1].startMs; // 直近 N 日のうち最古の 0:00
    const { sql, params } = buildRecordQuery(
      { taikoNo: SELF_TAIKO_NO, updatedSince: since },
      { key: 'updatedAt', desc: true },
    );
    return db.getAllAsync<RecordListRow>(sql, ...params);
  }

  // almostFc / almostDc
  const { mode, value, levels } = await getAlmostConfig(db);
  const col = ref.kind === 'almostFc' ? 'ng' : 'ok';
  const crown: Crown = ref.kind === 'almostFc' ? 'CLEAR' : 'FULL_COMBO';
  const { sql, params } = buildRecordQuery(
    { taikoNo: SELF_TAIKO_NO, crowns: [crown], levels, almost: { col, mode, value } },
    { key: 'score', desc: true },
  );
  const rows = await db.getAllAsync<RecordListRow>(sql, ...params);
  // 完成に近い順（残数が少ない順）に並べる。
  return rows.sort((a, b) => (a[col] ?? Infinity) - (b[col] ?? Infinity));
}

/** お気に入り登録用の曲番号配列（song_no 重複排除、順序保持）。 */
export async function getFolderSongNumbers(
  db: SQLiteDatabase,
  ref: FolderRef,
): Promise<number[]> {
  const rows = await getFolderSongs(db, ref);
  const seen = new Set<number>();
  const result: number[] = [];
  for (const r of rows) {
    if (seen.has(r.song_number)) continue;
    seen.add(r.song_number);
    result.push(r.song_number);
  }
  return result;
}

// ---------------------------------------------------------------------------
// 難易度別の記録付き取得（ジャンル/手動フォルダ）／カタログ検索
// ---------------------------------------------------------------------------

/** getFolderSongDetails の中間行（song × level）。 */
interface FolderLevelRow {
  song_number: number;
  title: string | null;
  level: Level;
  crown: Crown | null;
  class: Class | null;
  has_record: number;
  best_score: number | null;
}

/**
 * ジャンル/手動フォルダの曲を、その曲に存在する全難易度（charts ∪ 自分の記録）ごとに
 * 自分の最新の王冠/極マークと最高スコアを付けて返す。almost フォルダは対象外（[] を返す）。
 */
export async function getFolderSongDetails(
  db: SQLiteDatabase,
  ref: FolderRef,
): Promise<FolderSongDetail[]> {
  let targetCte: string;
  const targetParams: (string | number)[] = [];
  if (ref.kind === 'genre') {
    targetCte = 'SELECT gs.song_number FROM genre_songs gs WHERE gs.genre_id = ?';
    targetParams.push(ref.genreId);
  } else if (ref.kind === 'manual') {
    targetCte = 'SELECT fs.song_number FROM folder_songs fs WHERE fs.folder_id = ?';
    targetParams.push(ref.id);
  } else if (ref.kind === 'star') {
    // ☆別フォルダ：メインの難易度の譜面が指定の ☆ の曲を対象にする。
    const mainLevels = await getMainLevels(db);
    const placeholders = mainLevels.map(() => '?').join(', ');
    targetCte = `SELECT c.song_number FROM charts c WHERE c.level IN (${placeholders}) AND c.star = ?`;
    targetParams.push(...mainLevels, ref.star);
  } else if (ref.kind === 'recent') {
    // 「最近スコアを更新した曲」：直近 N 日分のスコア更新があった曲を対象にする。
    const days = await getScoreUpdateDays(db, SELF_TAIKO_NO, RECENT_UPDATE_DAYS);
    if (days.length === 0) return [];
    const since = days[days.length - 1].startMs;
    targetCte =
      'SELECT DISTINCT song_number FROM records WHERE taiko_no = ? AND score_total IS NOT NULL AND updated_at >= ?';
    targetParams.push(SELF_TAIKO_NO, since);
  } else {
    return [];
  }

  const rows = await db.getAllAsync<FolderLevelRow>(
    /* sql */ `
      WITH target(song_number) AS (${targetCte}),
      levels_for_song(song_number, level) AS (
        SELECT song_number, level FROM charts
        WHERE song_number IN (SELECT song_number FROM target)
        UNION
        SELECT song_number, level FROM records
        WHERE taiko_no = ? AND song_number IN (SELECT song_number FROM target)
      )
      SELECT lf.song_number, s.title, lf.level,
             lr.crown, lr.class,
             CASE WHEN lr.id IS NULL THEN 0 ELSE 1 END AS has_record,
             sc.best_score
      FROM levels_for_song lf
      JOIN songs s ON s.number = lf.song_number
      LEFT JOIN (
        SELECT r.* FROM records r
        JOIN (
          SELECT song_number, level, MAX(updated_at) AS mx
          FROM records WHERE taiko_no = ? GROUP BY song_number, level
        ) m ON m.song_number = r.song_number AND m.level = r.level AND m.mx = r.updated_at
        WHERE r.taiko_no = ?
      ) lr ON lr.song_number = lf.song_number AND lr.level = lf.level
      LEFT JOIN (
        SELECT song_number, level, MAX(score_total) AS best_score
        FROM records WHERE taiko_no = ? GROUP BY song_number, level
      ) sc ON sc.song_number = lf.song_number AND sc.level = lf.level
      ORDER BY s.title ASC
    `,
    ...targetParams,
    SELF_TAIKO_NO,
    SELF_TAIKO_NO,
    SELF_TAIKO_NO,
    SELF_TAIKO_NO,
  );

  // song 単位にまとめ、level を EASY→EXTRA 順に整列する。
  const map = new Map<number, FolderSongDetail>();
  for (const r of rows) {
    let detail = map.get(r.song_number);
    if (!detail) {
      detail = { song_number: r.song_number, title: r.title, levels: [], maxScore: null };
      map.set(r.song_number, detail);
    }
    detail.levels.push({
      level: r.level,
      crown: r.crown ?? 'NO_PLAY',
      class: r.class ?? 'NO_MARK',
      hasRecord: r.has_record === 1,
    });
    if (r.best_score != null) {
      detail.maxScore = detail.maxScore == null ? r.best_score : Math.max(detail.maxScore, r.best_score);
    }
  }
  for (const detail of map.values()) {
    detail.levels.sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level]);
  }
  return [...map.values()];
}

/** searchCatalogSongs の生行（in_folder は 0/1）。 */
interface CatalogRawRow {
  song_number: number;
  title: string | null;
  max_score: number | null;
  in_folder: number;
}

export interface CatalogSearchOptions {
  titleQuery?: string;
  minScore?: number | null;
  scoreSort?: 'none' | 'desc' | 'asc';
  /** 含有判定の対象フォルダ。 */
  folderId: number;
  limit?: number;
}

/**
 * 全楽曲カタログ（songs テーブル）を曲名/スコアで検索する。手動フォルダへの追加 UI 用。
 * max_score は自分の最新スコアの最大値（全難易度横断）。in_folder は対象フォルダの含有。
 */
export async function searchCatalogSongs(
  db: SQLiteDatabase,
  opts: CatalogSearchOptions,
): Promise<CatalogSongRow[]> {
  const params: (string | number)[] = [SELF_TAIKO_NO, opts.folderId];
  const where: string[] = [];
  if (opts.titleQuery && opts.titleQuery.trim()) {
    where.push('s.title LIKE ?');
    params.push(`%${opts.titleQuery.trim()}%`);
  }
  if (opts.minScore != null) {
    where.push('sc.max_score >= ?');
    params.push(opts.minScore);
  }

  let orderClause: string;
  if (opts.scoreSort === 'desc') {
    orderClause = 'CASE WHEN sc.max_score IS NULL THEN 1 ELSE 0 END ASC, sc.max_score DESC, s.title ASC';
  } else if (opts.scoreSort === 'asc') {
    orderClause = 'CASE WHEN sc.max_score IS NULL THEN 1 ELSE 0 END ASC, sc.max_score ASC, s.title ASC';
  } else {
    orderClause = 's.title ASC';
  }

  const rows = await db.getAllAsync<CatalogRawRow>(
    /* sql */ `
      SELECT s.number AS song_number, s.title, sc.max_score,
             CASE WHEN fsf.song_number IS NULL THEN 0 ELSE 1 END AS in_folder
      FROM songs s
      LEFT JOIN (
        SELECT song_number, MAX(score_total) AS max_score
        FROM records WHERE taiko_no = ? GROUP BY song_number
      ) sc ON sc.song_number = s.number
      LEFT JOIN (
        SELECT song_number FROM folder_songs WHERE folder_id = ?
      ) fsf ON fsf.song_number = s.number
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY ${orderClause}
      LIMIT ?
    `,
    ...params,
    opts.limit ?? 200,
  );

  return rows.map((r) => ({
    song_number: r.song_number,
    title: r.title,
    max_score: r.max_score,
    in_folder: r.in_folder === 1,
  }));
}
