import type { SQLiteDatabase } from 'expo-sqlite';

import { SELF_TAIKO_NO, type Class, type Level, type Crown, type Record as DoneRecord } from '@/types';
import type { Target } from '@/scrape/messages';

/** DB の records 行（snake_case） */
interface RecordRow {
  id: number;
  song_number: number;
  level: Level;
  crown: Crown;
  class: Class;
  score_total: number;
  good: number;
  ok: number;
  ng: number;
  combo: number;
  pound: number;
  ranking: number | null;
  options: string;
  play: number | null;
  clear: number | null;
  fullcombo: number | null;
  dondafulcombo: number | null;
  updated_at: number;
}

/** records 行をドメイン Record に変換 */
export function rowToRecord(row: RecordRow): DoneRecord {
  return {
    songNumber: row.song_number,
    level: row.level,
    crown: row.crown,
    class: row.class,
    score: {
      total: row.score_total,
      good: row.good,
      ok: row.ok,
      ng: row.ng,
      combo: row.combo,
      pound: row.pound,
      options: safeParseOptions(row.options),
      ranking: row.ranking ?? 0,
    },
    history:
      row.play != null
        ? {
            play: row.play,
            clear: row.clear ?? 0,
            fullcombo: row.fullcombo ?? 0,
            dondafulcombo: row.dondafulcombo ?? 0,
          }
        : undefined,
    updatedAt: row.updated_at,
  };
}

function safeParseOptions(json: string): string[] {
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

/**
 * 「記録が更新された」と判定するフィールド（ユーザー確定: 任意フィールド変化）。
 * いずれかが最新行と異なれば履歴行を追加する。
 */
function hasChanged(latest: RecordRow, next: DoneRecord): boolean {
  return (
    latest.score_total !== next.score.total ||
    latest.crown !== next.crown ||
    latest.class !== next.class ||
    latest.good !== next.score.good ||
    latest.ok !== next.score.ok ||
    latest.ng !== next.score.ng ||
    latest.combo !== next.score.combo
  );
}

async function latestRecord(
  db: SQLiteDatabase,
  taikoNo: string,
  songNumber: number,
  level: Level,
): Promise<RecordRow | null> {
  return db.getFirstAsync<RecordRow>(
    `SELECT * FROM records WHERE taiko_no = ? AND song_number = ? AND level = ?
     ORDER BY updated_at DESC, id DESC LIMIT 1`,
    taikoNo,
    songNumber,
    level,
  );
}

/**
 * 履歴保持 upsert。同一プレイヤー(taiko_no)の最新行と任意フィールドを比較し、
 * 差異があれば新しい行を追加する。過去の記録は上書きしない（SPEC の核心要件）。
 * @returns 行を追加したら true、変化なしでスキップしたら false
 */
export async function insertRecordIfChanged(
  db: SQLiteDatabase,
  record: DoneRecord,
  taikoNo: string = SELF_TAIKO_NO,
): Promise<boolean> {
  const latest = await latestRecord(db, taikoNo, record.songNumber, record.level);
  if (latest && !hasChanged(latest, record)) return false;

  await db.runAsync(
    `INSERT INTO records
      (taiko_no, song_number, level, crown, class, score_total, good, ok, ng, combo, pound,
       ranking, options, play, clear, fullcombo, dondafulcombo, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    taikoNo,
    record.songNumber,
    record.level,
    record.crown,
    record.class,
    record.score.total,
    record.score.good,
    record.score.ok,
    record.score.ng,
    record.score.combo,
    record.score.pound,
    record.score.ranking || null,
    JSON.stringify(record.score.options ?? []),
    record.history?.play ?? null,
    record.history?.clear ?? null,
    record.history?.fullcombo ?? null,
    record.history?.dondafulcombo ?? null,
    record.updatedAt ?? Date.now(),
  );
  return true;
}

/**
 * records をまとめて保存し、追加件数を返す。
 * isInitial=true のとき、各レコードの updated_at を 0（取得日不明）として保存する。
 * taikoNo で保存先プレイヤーを指定（既定=自分）。
 */
export async function saveRecords(
  db: SQLiteDatabase,
  records: DoneRecord[],
  isInitial = false,
  taikoNo: string = SELF_TAIKO_NO,
): Promise<number> {
  let inserted = 0;
  await db.withTransactionAsync(async () => {
    for (const r of records) {
      const record = isInitial ? { ...r, updatedAt: 0 } : r;
      if (await insertRecordIfChanged(db, record, taikoNo)) inserted++;
    }
  });
  return inserted;
}

/**
 * 最近プレイ履歴の (曲名, 難易度) をローカル songs から song_number に逆引きし、
 * 詳細取得用 Target[] を作る。履歴ページは song_no を返さないため曲名一致で解決する。
 * 同名曲が複数あれば全候補を対象にする（SPEC: 確認のためのリクエストは避けられない）。
 * @returns targets（id+difficulty で重複排除）と、解決できなかった曲名 unresolved
 */
export async function resolveTargetsByTitle(
  db: SQLiteDatabase,
  entries: { title: string; difficulty: string }[],
): Promise<{ targets: Target[]; unresolved: string[] }> {
  const targets: Target[] = [];
  const seen = new Set<string>();
  const unresolved: string[] = [];

  for (const entry of entries) {
    const rows = await db.getAllAsync<{ number: number }>(
      'SELECT number FROM songs WHERE title = ?',
      entry.title,
    );
    if (rows.length === 0) {
      unresolved.push(entry.title);
      continue;
    }
    for (const row of rows) {
      const id = String(row.number);
      const key = `${id}:${entry.difficulty}`;
      if (seen.has(key)) continue;
      seen.add(key);
      targets.push({ id, name: entry.title, genreIds: [], difficulty: entry.difficulty });
    }
  }

  return { targets, unresolved };
}

// ---------------------------------------------------------------------------
// 記録閲覧用クエリ
// ---------------------------------------------------------------------------

export interface RecordFilter {
  /** 閲覧プレイヤーの太鼓番。既定=自分('') */
  taikoNo?: string;
  /** 曲名部分一致 (LIKE) */
  titleQuery?: string;
  /** ジャンル絞り込み */
  genreId?: string;
  /** 難易度絞り込み（複数選択）。おに裏 (EXTRA) はおに (ONI) と同等に扱う呼び出し側で展開すること */
  levels?: Level[];
  /** クリア王冠絞り込み（複数選択） */
  crowns?: Crown[];
  /** 極マーク絞り込み（複数選択）。Class の全8種を個別指定可能 */
  classes?: Class[];
  minStar?: number;
  maxStar?: number;
  tier?: string;
  minScore?: number;
}

export type RecordSortKey =
  | 'score'
  | 'baseScore'
  | 'star'
  | 'tier'
  | 'updatedAt'
  // | 'ranking'
  | 'achievement'
  | 'totalNotes';

export interface RecordSort {
  key: RecordSortKey;
  desc?: boolean;
}

/**
 * 指定プレイヤー(taiko_no)の各 (song_number, level) の最新行のみ。
 * 内側集約と外側 r の両方を taiko_no で絞る（'?' は taiko_no を2回バインド）。
 */
const LATEST_PER_CHART = /* sql */ `
  SELECT r.* FROM records r
  JOIN (
    SELECT song_number, level, MAX(updated_at) AS mx
    FROM records WHERE taiko_no = ? GROUP BY song_number, level
  ) m ON m.song_number = r.song_number AND m.level = r.level AND m.mx = r.updated_at
  WHERE r.taiko_no = ?
`;

/**
 * 達成率 = good / (good + ok + ng)
 * total_notes = good + ok + ng（サブソートにも使う）
 * base_score = score_total - pound * 100（素点）
 */
const COMPUTED_COLS = /* sql */ `
  (r.good + r.ok + r.ng) AS total_notes,
  CASE WHEN (r.good + r.ok + r.ng) > 0
    THEN CAST(r.good AS REAL) / (r.good + r.ok + r.ng)
    ELSE 0
  END AS achievement,
  (r.score_total - r.pound * 100) AS base_score
`;

const SORT_CLAUSE: Record<RecordSortKey, string> = {
  score: 'r.score_total',
  baseScore: 'base_score',
  star: 'lv.star',
  tier: 'CASE WHEN lv.tier_rank IS NULL THEN 1 ELSE 0 END, lv.tier_rank',
  updatedAt: 'r.updated_at',
  // ranking: 'r.ranking',
  // 達成率降順、同率は総ノーツ数降順（難しい曲優先）
  achievement: 'achievement, total_notes',
  totalNotes: 'total_notes',
};

/**
 * フィルタ/ソート条件から記録一覧クエリを組み立てる。
 * 既定では各譜面の最新記録を返す。
 */
export function buildRecordQuery(
  filter: RecordFilter = {},
  sort: RecordSort = { key: 'updatedAt', desc: true },
): { sql: string; params: (string | number)[] } {
  const where: string[] = [];
  // LATEST_PER_CHART の '?' 2つ（内側集約 + 外側 r）に taiko_no をバインド。
  // SQL テキスト上 FROM サブクエリが WHERE より前に来るため params 先頭に置く。
  const taikoNo = filter.taikoNo ?? SELF_TAIKO_NO;
  const params: (string | number)[] = [taikoNo, taikoNo];

  // tier ソート時は ★10 譜面のみを対象とする
  if (sort.key === 'tier') {
    where.push('lv.star = 10');
  }

  if (filter.titleQuery) {
    where.push('s.title LIKE ?');
    params.push(`%${filter.titleQuery}%`);
  }
  if (filter.levels && filter.levels.length > 0) {
    const placeholders = filter.levels.map(() => '?').join(', ');
    where.push(`r.level IN (${placeholders})`);
    params.push(...filter.levels);
  }
  if (filter.crowns && filter.crowns.length > 0) {
    const placeholders = filter.crowns.map(() => '?').join(', ');
    where.push(`r.crown IN (${placeholders})`);
    params.push(...filter.crowns);
  }
  if (filter.classes && filter.classes.length > 0) {
    const placeholders = filter.classes.map(() => '?').join(', ');
    where.push(`r.class IN (${placeholders})`);
    params.push(...filter.classes);
  }
  if (filter.minScore != null) {
    where.push('r.score_total >= ?');
    params.push(filter.minScore);
  }
  if (filter.minStar != null) {
    where.push('lv.star >= ?');
    params.push(filter.minStar);
  }
  if (filter.maxStar != null) {
    where.push('lv.star <= ?');
    params.push(filter.maxStar);
  }
  if (filter.tier) {
    where.push('lv.tier = ?');
    params.push(filter.tier);
  }
  if (filter.genreId) {
    where.push('gs.genre_id = ?');
    params.push(filter.genreId);
  }

  const dir = sort.desc !== false ? 'DESC' : 'ASC';

  let orderClause: string;
  switch (sort.key) {
    case 'achievement':
      // 副ソート: スコア降順 → 総ノーツ数降順（難しい曲・高得点を優先）
      orderClause = `achievement ${dir}, r.score_total ${dir}, total_notes ${dir}`;
      break;
    case 'star':
      // ☆10 は tier_rank ASC（0 = 最難関）を副ソートとして付与。NULL は末尾。
      orderClause = [
        `lv.star ${dir}`,
        `CASE WHEN lv.star = 10 AND lv.tier_rank IS NULL THEN 1 ELSE 0 END ASC`,
        `CASE WHEN lv.star = 10 THEN lv.tier_rank END ASC`,
      ].join(', ');
      break;
    default:
      orderClause = `${SORT_CLAUSE[sort.key]} ${dir}`;
      break;
  }

  const sql = /* sql */ `
    SELECT
      r.*,
      s.title AS song_title,
      lv.star AS star,
      lv.tier AS tier,
      ${COMPUTED_COLS},
      (SELECT GROUP_CONCAT(gs_sub.genre_id)
       FROM genre_songs gs_sub
       WHERE gs_sub.song_number = r.song_number) AS genre_ids
    FROM (${LATEST_PER_CHART}) r
    JOIN songs s ON s.number = r.song_number
    LEFT JOIN charts lv ON lv.song_number = r.song_number AND lv.level = r.level
    ${filter.genreId ? 'JOIN genre_songs gs ON gs.song_number = r.song_number' : ''}
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY ${orderClause}
  `;

  return { sql, params };
}
