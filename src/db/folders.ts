import type { SQLiteDatabase } from 'expo-sqlite';

import { SELF_TAIKO_NO, type Crown, type Level } from '@/types';
import { getAlmostConfig } from './meta';

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
  | { kind: 'manual'; id: number; name: string };

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
  const { mode, value } = await getAlmostConfig(db);
  const col = kind === 'almostFc' ? 'r.ng' : 'r.ok';
  const crown = kind === 'almostFc' ? 'CLEAR' : 'FULL_COMBO';
  const threshold =
    mode === 'percent'
      ? `CAST(${col} AS REAL) / (r.good + r.ok + r.ng) * 100 <= ?`
      : `${col} <= ?`;

  return db.getAllAsync<FolderSongRow>(
    /* sql */ `
      SELECT r.song_number, s.title, r.level, r.crown, ${col} AS remaining
      FROM (${SELF_LATEST_SCORED}) r
      JOIN songs s ON s.number = r.song_number
      WHERE r.crown = ?
        AND (r.good + r.ok + r.ng) > 0
        AND ${col} > 0
        AND ${threshold}
      ORDER BY remaining ASC, s.title ASC
    `,
    SELF_TAIKO_NO,
    SELF_TAIKO_NO,
    crown,
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
