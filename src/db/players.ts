import type { SQLiteDatabase } from 'expo-sqlite';

import { SELF_TAIKO_NO, type Player } from '@/types';

/** players 行（snake_case） */
interface PlayerRow {
  taiko_no: string;
  name: string;
  created_at: number | null;
}

/**
 * プレイヤー一覧を返す。自分（taiko_no=''）を先頭に、以降は追加順。
 * migration v3 で自分行は seed 済みのため必ず1件以上返る。
 */
export async function listPlayers(db: SQLiteDatabase): Promise<Player[]> {
  const rows = await db.getAllAsync<PlayerRow>(
    `SELECT taiko_no, name, created_at FROM players
     ORDER BY CASE WHEN taiko_no = '' THEN 0 ELSE 1 END, created_at ASC, name ASC`,
  );
  return rows.map((r) => ({ taikoNo: r.taiko_no, name: r.name }));
}

/** ライバルを追加（既存の太鼓番なら名前を更新）。自分(空)は追加不可。 */
export async function addPlayer(
  db: SQLiteDatabase,
  taikoNo: string,
  name: string,
): Promise<void> {
  const no = taikoNo.trim();
  if (no === SELF_TAIKO_NO) throw new Error('太鼓番を入力してください');
  await db.runAsync(
    `INSERT INTO players (taiko_no, name, created_at) VALUES (?, ?, ?)
     ON CONFLICT(taiko_no) DO UPDATE SET name = excluded.name`,
    no,
    name.trim() || no,
    Date.now(),
  );
}

/** ライバルを削除。自分(空)は削除不可。記録(records)は残す。 */
export async function removePlayer(db: SQLiteDatabase, taikoNo: string): Promise<void> {
  if (taikoNo === SELF_TAIKO_NO) return;
  await db.runAsync('DELETE FROM players WHERE taiko_no = ?', taikoNo);
}
