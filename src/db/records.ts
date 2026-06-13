import type { SQLiteDatabase } from 'expo-sqlite';

import type { Class, Course, Crown, Record as DoneRecord } from '@/types';

/** DB の records 行（snake_case） */
interface RecordRow {
  id: number;
  song_number: number;
  course: Course;
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
    course: row.course,
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
  songNumber: number,
  course: Course,
): Promise<RecordRow | null> {
  return db.getFirstAsync<RecordRow>(
    `SELECT * FROM records WHERE song_number = ? AND course = ?
     ORDER BY updated_at DESC, id DESC LIMIT 1`,
    songNumber,
    course,
  );
}

/**
 * 履歴保持 upsert。最新行と任意フィールドを比較し、差異があれば新しい行を追加する。
 * 過去の記録は上書きしない（SPEC の核心要件）。
 * @returns 行を追加したら true、変化なしでスキップしたら false
 */
export async function insertRecordIfChanged(
  db: SQLiteDatabase,
  record: DoneRecord,
): Promise<boolean> {
  const latest = await latestRecord(db, record.songNumber, record.course);
  if (latest && !hasChanged(latest, record)) return false;

  await db.runAsync(
    `INSERT INTO records
      (song_number, course, crown, class, score_total, good, ok, ng, combo, pound,
       ranking, options, play, clear, fullcombo, dondafulcombo, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    record.songNumber,
    record.course,
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

/** records をまとめて保存し、追加件数を返す */
export async function saveRecords(db: SQLiteDatabase, records: DoneRecord[]): Promise<number> {
  let inserted = 0;
  await db.withTransactionAsync(async () => {
    for (const r of records) {
      if (await insertRecordIfChanged(db, r)) inserted++;
    }
  });
  return inserted;
}

// ---------------------------------------------------------------------------
// 記録閲覧用クエリ（次フェーズで UI から利用する骨組み）
// ---------------------------------------------------------------------------

export interface RecordFilter {
  genreId?: string;
  course?: Course;
  crown?: Crown;
  class?: Class;
  minStar?: number;
  maxStar?: number;
  tier?: string;
  minScore?: number;
}

export type RecordSortKey = 'score' | 'star' | 'tier' | 'updatedAt' | 'ranking';

export interface RecordSort {
  key: RecordSortKey;
  desc?: boolean;
}

/** 各 (song_number, course) の最新行のみ */
const LATEST_PER_CHART = /* sql */ `
  SELECT r.* FROM records r
  JOIN (
    SELECT song_number, course, MAX(updated_at) AS mx
    FROM records GROUP BY song_number, course
  ) m ON m.song_number = r.song_number AND m.course = r.course AND m.mx = r.updated_at
`;

const SORT_COLUMN: Record<RecordSortKey, string> = {
  score: 'r.score_total',
  star: 'lv.star',
  tier: 'lv.tier',
  updatedAt: 'r.updated_at',
  ranking: 'r.ranking',
};

/**
 * フィルタ/ソート条件から記録一覧クエリを組み立てる骨組み。
 * 既定では各譜面の最新記録を返す。条件は後から追加していく。
 */
export function buildRecordQuery(
  filter: RecordFilter = {},
  sort: RecordSort = { key: 'updatedAt', desc: true },
): { sql: string; params: (string | number)[] } {
  const where: string[] = [];
  const params: (string | number)[] = [];

  if (filter.course) {
    where.push('r.course = ?');
    params.push(filter.course);
  }
  if (filter.crown) {
    where.push('r.crown = ?');
    params.push(filter.crown);
  }
  if (filter.class) {
    where.push('r.class = ?');
    params.push(filter.class);
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

  const col = SORT_COLUMN[sort.key];
  const dir = sort.desc ? 'DESC' : 'ASC';

  const sql = /* sql */ `
    SELECT r.*, s.title AS song_title, lv.star AS star, lv.tier AS tier
    FROM (${LATEST_PER_CHART}) r
    JOIN songs s ON s.number = r.song_number
    LEFT JOIN levels lv ON lv.song_number = r.song_number AND lv.course = r.course
    ${filter.genreId ? 'JOIN genre_songs gs ON gs.song_number = r.song_number' : ''}
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY ${col} ${dir}
  `;

  return { sql, params };
}
