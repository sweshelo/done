import type { SQLiteDatabase } from 'expo-sqlite';

import { SELF_TAIKO_NO, type Class, type Crown, type Level } from '@/types';
import { getAlmostConfig, getMainLevels } from './meta';

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
  //| { kind: 'recent', name: string }
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
