import type { SQLiteDatabase } from 'expo-sqlite';

import { SELF_TAIKO_NO, type Class, type Level, type Crown, type Record as DoneRecord } from '@/types';
import type { Target } from '@/scrape/messages';
import type { AlmostMode } from './meta';

/** DB の records 行（snake_case）。score 系列はライバルの欠落時 NULL になりうる。 */
interface RecordRow {
  id: number;
  song_number: number;
  level: Level;
  crown: Crown;
  class: Class;
  score_total: number | null;
  good: number | null;
  ok: number | null;
  ng: number | null;
  combo: number | null;
  pound: number | null;
  ranking: number | null;
  options: string;
  play: number | null;
  clear: number | null;
  fullcombo: number | null;
  dondafulcombo: number | null;
  updated_at: number;
}

/** records 行をドメイン Record に変換。score 欠落（王冠のみ）行は score: undefined。 */
export function rowToRecord(row: RecordRow): DoneRecord {
  return {
    songNumber: row.song_number,
    level: row.level,
    crown: row.crown,
    class: row.class,
    score:
      row.score_total != null
        ? {
            total: row.score_total,
            good: row.good ?? 0,
            ok: row.ok ?? 0,
            ng: row.ng ?? 0,
            combo: row.combo ?? 0,
            pound: row.pound ?? 0,
            options: safeParseOptions(row.options),
            ranking: row.ranking ?? 0,
          }
        : undefined,
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
 * スコア詳細が最新行と異なるか。next.score が無ければ（欠落）スコア変化なしとみなす。
 * latest にスコアが無い（王冠のみ行）が next にスコアがある場合は変化ありとする。
 */
function scoreChangedFrom(latest: RecordRow, next: DoneRecord): boolean {
  if (!next.score) return false;
  if (latest.score_total == null) return true;
  return (
    latest.score_total !== next.score.total ||
    latest.good !== next.score.good ||
    latest.ok !== next.score.ok ||
    latest.ng !== next.score.ng ||
    latest.combo !== next.score.combo
  );
}

/** 王冠/極マークが最新行と異なるか。 */
function crownChangedFrom(latest: RecordRow, next: DoneRecord): boolean {
  return latest.crown !== next.crown || latest.class !== next.class;
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
 * 履歴保持 upsert。同一プレイヤー(taiko_no)の最新行と比較する。
 * - スコア詳細が変化 → スコア込みの履歴行を追加（従来挙動）。
 * - スコアが欠落 or 前回と完全一致だが王冠/極マークが変化 → score=NULL の「王冠のみ行」を追加
 *   （ライバルの詳細未同期で王冠だけ新しいケースを、偽のスコアで上書きせず記録する）。
 * - いずれも変化なし → スキップ。
 * 過去の記録は決して上書きしない（SPEC の核心要件）。
 * @returns 行を追加したら true、変化なしでスキップしたら false
 */
export async function insertRecordIfChanged(
  db: SQLiteDatabase,
  record: DoneRecord,
  taikoNo: string = SELF_TAIKO_NO,
): Promise<boolean> {
  const latest = await latestRecord(db, taikoNo, record.songNumber, record.level);

  const scoreChanged = !latest ? record.score != null : scoreChangedFrom(latest, record);
  const crownChanged = !latest || crownChangedFrom(latest, record);

  // スコア込みで保存するのは「スコアがあり、かつ前回からスコアが変化した」場合のみ。
  // それ以外で王冠/極マークだけ変化したら score=NULL の王冠のみ行を追加する。
  const writeScore = record.score != null && scoreChanged;
  if (!writeScore && !crownChanged) return false;

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
    writeScore ? record.score!.total : null,
    writeScore ? record.score!.good : null,
    writeScore ? record.score!.ok : null,
    writeScore ? record.score!.ng : null,
    writeScore ? record.score!.combo : null,
    writeScore ? record.score!.pound : null,
    writeScore ? record.score!.ranking || null : null,
    writeScore ? JSON.stringify(record.score!.options ?? []) : '[]',
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
// スコア更新日（差分の日付選択・「最近」フォルダ共通）
// ---------------------------------------------------------------------------

/** スコア更新があった 1 日。startMs/endMs はローカル暦日の境界（endMs は排他的上限）。 */
export interface ScoreUpdateDay {
  /** 'YYYY-MM-DD'（localtime） */
  day: string;
  /** その日 0:00 のエポック ms */
  startMs: number;
  /** 翌日 0:00 のエポック ms（排他的上限） */
  endMs: number;
  /** その日に更新された譜面数（song×level） */
  count: number;
}

/**
 * 指定プレイヤー（既定=自分）のスコア入り記録を、ローカル暦日で集約して新しい順に返す。
 * 初回全件取得の updated_at=0 センチネルは除外する。limit 指定で件数を絞れる。
 * SQLite の date(...,'localtime') と JS Date は同じ端末 TZ を使うため境界は整合する。
 */
export async function getScoreUpdateDays(
  db: SQLiteDatabase,
  taikoNo: string = SELF_TAIKO_NO,
  limit?: number,
): Promise<ScoreUpdateDay[]> {
  const rows = await db.getAllAsync<{ day: string; count: number }>(
    /* sql */ `
      SELECT date(updated_at / 1000, 'unixepoch', 'localtime') AS day,
             COUNT(DISTINCT song_number || '-' || level) AS count
      FROM records
      WHERE taiko_no = ? AND score_total IS NOT NULL AND updated_at > 0
      GROUP BY day
      ORDER BY day DESC
      ${limit != null ? 'LIMIT ?' : ''}
    `,
    ...(limit != null ? [taikoNo, limit] : [taikoNo]),
  );
  return rows.map((r) => {
    const [y, m, d] = r.day.split('-').map(Number);
    const start = new Date(y, m - 1, d);
    const end = new Date(y, m - 1, d + 1);
    return { day: r.day, startMs: start.getTime(), endMs: end.getTime(), count: r.count };
  });
}

// ---------------------------------------------------------------------------
// 期間の差分（SNS 出力用）
// ---------------------------------------------------------------------------

/**
 * 「差分」一覧の 1 行。after = 期間終わりの最新状態、before = 期間始まりより前の最新状態。
 * before 系列が NULL の譜面は「その期間が初記録（NEW）」を意味する。
 * crown/class は最新行（base）から、数値スコアは最新のスコア入り行（scored）から取る。
 */
export interface TodayDiffRow {
  song_number: number;
  song_title: string | null;
  level: Level;
  star: number | null;
  tier: string | null;
  genre_ids: string | null;
  // after（現在の最新）
  crown: Crown;
  class: Class;
  score_total: number | null;
  good: number | null;
  ok: number | null;
  ng: number | null;
  combo: number | null;
  pound: number | null;
  // before（今日より前の最新。NULL = 本日初記録）
  before_crown: Crown | null;
  before_class: Class | null;
  before_score_total: number | null;
  before_good: number | null;
  before_ok: number | null;
  before_ng: number | null;
  before_combo: number | null;
  before_pound: number | null;
}

/**
 * [sinceMs, untilMs) に更新された各譜面について、since より前の最新状態（before）と
 * until より前の最新状態（after）を並べて返す。任意の 1 日を指定すれば「その日の差分」、
 * untilMs に翌日 0:00 を渡せば「今日の差分」になる（after = 実質グローバル最新）。
 * 既定は自分（taiko_no=''）。記録は追記専用のため、当日中に複数回更新しても
 * 「その日の始まりの最新」と「その日の終わりの最新」を比べることで日トータルの伸びを表せる。
 */
export async function getDiffsInRange(
  db: SQLiteDatabase,
  sinceMs: number,
  untilMs: number,
  taikoNo: string = SELF_TAIKO_NO,
): Promise<TodayDiffRow[]> {
  const sql = /* sql */ `
    WITH
    today_charts AS (
      SELECT DISTINCT song_number, level FROM records
      WHERE taiko_no = $taiko AND updated_at >= $since AND updated_at < $until
    ),
    after_base AS (
      SELECT r.* FROM records r JOIN (
        SELECT song_number, level, MAX(updated_at) AS mx
        FROM records WHERE taiko_no = $taiko AND updated_at < $until GROUP BY song_number, level
      ) m ON m.song_number = r.song_number AND m.level = r.level AND m.mx = r.updated_at
      WHERE r.taiko_no = $taiko AND r.updated_at < $until
    ),
    after_scored AS (
      SELECT r.* FROM records r JOIN (
        SELECT song_number, level, MAX(updated_at) AS mx
        FROM records WHERE taiko_no = $taiko AND score_total IS NOT NULL AND updated_at < $until
        GROUP BY song_number, level
      ) m ON m.song_number = r.song_number AND m.level = r.level AND m.mx = r.updated_at
      WHERE r.taiko_no = $taiko AND r.score_total IS NOT NULL AND r.updated_at < $until
    ),
    before_base AS (
      SELECT r.* FROM records r JOIN (
        SELECT song_number, level, MAX(updated_at) AS mx
        FROM records WHERE taiko_no = $taiko AND updated_at < $since
        GROUP BY song_number, level
      ) m ON m.song_number = r.song_number AND m.level = r.level AND m.mx = r.updated_at
      WHERE r.taiko_no = $taiko AND r.updated_at < $since
    ),
    before_scored AS (
      SELECT r.* FROM records r JOIN (
        SELECT song_number, level, MAX(updated_at) AS mx
        FROM records WHERE taiko_no = $taiko AND updated_at < $since AND score_total IS NOT NULL
        GROUP BY song_number, level
      ) m ON m.song_number = r.song_number AND m.level = r.level AND m.mx = r.updated_at
      WHERE r.taiko_no = $taiko AND r.updated_at < $since AND r.score_total IS NOT NULL
    )
    SELECT
      tc.song_number, tc.level,
      s.title AS song_title,
      lv.star AS star, lv.tier AS tier,
      ab.crown AS crown, ab.class AS class,
      asc_.score_total, asc_.good, asc_.ok, asc_.ng, asc_.combo, asc_.pound,
      bb.crown AS before_crown, bb.class AS before_class,
      bsc.score_total AS before_score_total, bsc.good AS before_good, bsc.ok AS before_ok,
      bsc.ng AS before_ng, bsc.combo AS before_combo, bsc.pound AS before_pound,
      (SELECT GROUP_CONCAT(gs.genre_id) FROM genre_songs gs WHERE gs.song_number = tc.song_number)
        AS genre_ids
    FROM today_charts tc
    JOIN after_base ab ON ab.song_number = tc.song_number AND ab.level = tc.level
    LEFT JOIN after_scored asc_ ON asc_.song_number = tc.song_number AND asc_.level = tc.level
    LEFT JOIN before_base bb ON bb.song_number = tc.song_number AND bb.level = tc.level
    LEFT JOIN before_scored bsc ON bsc.song_number = tc.song_number AND bsc.level = tc.level
    JOIN songs s ON s.number = tc.song_number
    LEFT JOIN charts lv ON lv.song_number = tc.song_number AND lv.level = tc.level
    ORDER BY
      CASE WHEN bb.song_number IS NULL THEN 0 ELSE 1 END ASC,
      (COALESCE(asc_.score_total, 0) - COALESCE(bsc.score_total, 0)) DESC,
      tc.song_number ASC
  `;
  return db.getAllAsync<TodayDiffRow>(sql, { $taiko: taikoNo, $since: sinceMs, $until: untilMs });
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
  /** 最新行の更新日時がこの値以上の譜面のみ（「最近スコアを更新した曲」フォルダ用）。 */
  updatedSince?: number;
  /**
   * 「もうすぐFC/DC」フォルダ用の絞り込み。col の残数（不可=ng / 可=ok）が 0 超かつ
   * 閾値以下の譜面に限定する。crowns/levels と併用する。
   */
  almost?: { col: 'ng' | 'ok'; mode: AlmostMode; value: number };
}

/** 記録一覧の 1 行（buildRecordQuery が返す computed cols 込みの行）。 */
export interface RecordListRow {
  song_number: number;
  song_title: string | null;
  level: Level;
  crown: Crown;
  class: Class;
  // 王冠のみ行（ライバルのスコア欠落）では score 系列が NULL になりうる
  score_total: number | null;
  good: number | null;
  ok: number | null;
  ng: number | null;
  pound: number | null;
  star: number | null;
  tier: string | null;
  updated_at: number;
  total_notes: number | null;
  achievement: number | null; // 0.0 ~ 1.0
  /** 素点 = score_total - pound * 100 */
  base_score: number | null;
  /** カンマ区切りのジャンル ID 文字列 (GROUP_CONCAT) */
  genre_ids: string | null;
  /** 「自分と近い順」ソート時のみ付与される、自分の同譜面スコア */
  self_score?: number | null;
}

export type RecordSortKey =
  | 'score'
  | 'baseScore'
  | 'star'
  | 'tier'
  | 'updatedAt'
  // | 'ranking'
  | 'achievement'
  | 'totalNotes'
  /** 自分のスコアと近い順（ライバル閲覧時のみ有効） */
  | 'closeToSelf';

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
 * 各 (song_number, level) の「スコアが入っている」最新行のみ（王冠のみ行 score=NULL は除外）。
 * '?' は taiko_no を2回バインド。
 */
const LATEST_SCORED_PER_CHART = /* sql */ `
  SELECT r.* FROM records r
  JOIN (
    SELECT song_number, level, MAX(updated_at) AS mx
    FROM records WHERE taiko_no = ? AND score_total IS NOT NULL GROUP BY song_number, level
  ) m ON m.song_number = r.song_number AND m.level = r.level AND m.mx = r.updated_at
  WHERE r.taiko_no = ? AND r.score_total IS NOT NULL
`;

/**
 * 各譜面の表示用「マージ済み最新行」。王冠/極マーク/更新日時は最新行(base)から、
 * 数値スコア（と options/ranking）は最新のスコア入り行(sc)から取る。
 * ライバルの王冠だけ新しくスコアが欠落/据え置きでも、王冠は最新・スコアは直近の実値を見せる。
 * '?' は taiko_no を4回バインド（base 2 + sc 2）。
 */
const LATEST_MERGED = /* sql */ `
  SELECT
    base.id, base.song_number, base.level, base.crown, base.class,
    sc.score_total, sc.good, sc.ok, sc.ng, sc.combo, sc.pound, sc.ranking,
    COALESCE(sc.options, base.options) AS options,
    base.play, base.clear, base.fullcombo, base.dondafulcombo,
    base.updated_at, base.taiko_no
  FROM (${LATEST_PER_CHART}) base
  LEFT JOIN (${LATEST_SCORED_PER_CHART}) sc
    ON sc.song_number = base.song_number AND sc.level = base.level
`;

/**
 * 達成率 = good / (good + ok + ng)
 * total_notes = good + ok + ng（サブソートにも使う）
 * base_score = score_total - pound * 100（素点）
 */
export const COMPUTED_COLS = /* sql */ `
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
  // closeToSelf は専用の ORDER 句で扱う。自分閲覧時のフォールバック用にスコアを指定。
  closeToSelf: 'r.score_total',
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
  // LATEST_MERGED の '?' 4つ（base 集約+外側、sc 集約+外側）に taiko_no をバインド。
  // SQL テキスト上 FROM サブクエリが WHERE より前に来るため params 先頭に置く。
  const taikoNo = filter.taikoNo ?? SELF_TAIKO_NO;
  const params: (string | number)[] = [taikoNo, taikoNo, taikoNo, taikoNo];

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
  if (filter.updatedSince != null) {
    where.push('r.updated_at >= ?');
    params.push(filter.updatedSince);
  }
  if (filter.almost) {
    const { col, mode, value } = filter.almost;
    // スコア入りの最新行に対し、残数(col)が 0 超かつ閾値以下の譜面に限定する。
    where.push('(r.good + r.ok + r.ng) > 0');
    where.push(`r.${col} > 0`);
    if (mode === 'percent') {
      where.push(`CAST(r.${col} AS REAL) / (r.good + r.ok + r.ng) * 100 <= ?`);
    } else {
      where.push(`r.${col} <= ?`);
    }
    params.push(value);
  }

  const dir = sort.desc !== false ? 'DESC' : 'ASC';

  // 「自分と近い順」: ライバル閲覧時のみ有効。自分の最新スコア入り行を結合し差の絶対値で並べる。
  const closeToSelfActive = sort.key === 'closeToSelf' && taikoNo !== SELF_TAIKO_NO;
  if (closeToSelfActive) {
    // self 結合の '?' 2つは FROM サブクエリ(4) の直後・WHERE より前に来るため index 4 に挿入。
    params.splice(4, 0, SELF_TAIKO_NO, SELF_TAIKO_NO);
  }

  // スコア由来のソートでは score 欠落（王冠のみ）の譜面を常に末尾へ送る。
  const SCORE_DERIVED: RecordSortKey[] = ['score', 'baseScore', 'achievement', 'totalNotes'];
  const nullGuard = SCORE_DERIVED.includes(sort.key)
    ? 'CASE WHEN r.score_total IS NULL THEN 1 ELSE 0 END ASC, '
    : '';

  let orderClause: string;
  switch (sort.key) {
    case 'closeToSelf':
      orderClause = closeToSelfActive
        ? // 自分の記録が無い譜面・スコア欠落は末尾。差が小さい順（近い順）。
          'CASE WHEN r.score_total IS NULL OR slf.score_total IS NULL THEN 1 ELSE 0 END ASC, ' +
          'ABS(r.score_total - slf.score_total) ASC'
        : `CASE WHEN r.score_total IS NULL THEN 1 ELSE 0 END ASC, r.score_total DESC`;
      break;
    case 'achievement':
      // 副ソート: スコア降順 → 総ノーツ数降順（難しい曲・高得点を優先）
      orderClause = `${nullGuard}achievement ${dir}, r.score_total ${dir}, total_notes ${dir}`;
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
      orderClause = `${nullGuard}${SORT_CLAUSE[sort.key]} ${dir}`;
      break;
  }

  const sql = /* sql */ `
    SELECT
      r.*,
      s.title AS song_title,
      lv.star AS star,
      lv.tier AS tier,
      ${closeToSelfActive ? 'slf.score_total AS self_score,' : ''}
      ${COMPUTED_COLS},
      (SELECT GROUP_CONCAT(gs_sub.genre_id)
       FROM genre_songs gs_sub
       WHERE gs_sub.song_number = r.song_number) AS genre_ids
    FROM (${LATEST_MERGED}) r
    JOIN songs s ON s.number = r.song_number
    ${closeToSelfActive ? `LEFT JOIN (${LATEST_SCORED_PER_CHART}) slf ON slf.song_number = r.song_number AND slf.level = r.level` : ''}
    LEFT JOIN charts lv ON lv.song_number = r.song_number AND lv.level = r.level
    ${filter.genreId ? 'JOIN genre_songs gs ON gs.song_number = r.song_number' : ''}
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY ${orderClause}
  `;

  return { sql, params };
}
