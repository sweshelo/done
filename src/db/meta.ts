import type { SQLiteDatabase } from 'expo-sqlite';

/** app_meta の key 定数 */
export const SELF_TAIKO_NO_KEY = 'self_taiko_no';

/** 「もうすぐFC/DC」判定の閾値方式（'absolute' = 絶対値, 'percent' = ％）。 */
export const ALMOST_MODE_KEY = 'almost_mode';
/** 「もうすぐFC/DC」判定の閾値（数値文字列）。 */
export const ALMOST_VALUE_KEY = 'almost_value';

export type AlmostMode = 'absolute' | 'percent';
export interface AlmostConfig {
  mode: AlmostMode;
  value: number;
}

const ALMOST_MODE_DEFAULT: AlmostMode = 'absolute';
const ALMOST_VALUE_DEFAULT = 3;

export async function getMeta(db: SQLiteDatabase, key: string): Promise<string | null> {
  const row = await db.getFirstAsync<{ value: string }>(
    'SELECT value FROM app_meta WHERE key = ?',
    key,
  );
  return row?.value ?? null;
}

export async function setMeta(db: SQLiteDatabase, key: string, value: string): Promise<void> {
  await db.runAsync(
    `INSERT INTO app_meta (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    key,
    value,
  );
}

/** 「もうすぐFC/DC」判定の閾値設定を読む。未設定時は既定 (absolute / 3) を返す。 */
export async function getAlmostConfig(db: SQLiteDatabase): Promise<AlmostConfig> {
  const mode = (await getMeta(db, ALMOST_MODE_KEY)) as AlmostMode | null;
  const rawValue = await getMeta(db, ALMOST_VALUE_KEY);
  const value = rawValue != null && rawValue !== '' ? Number(rawValue) : NaN;
  return {
    mode: mode === 'percent' || mode === 'absolute' ? mode : ALMOST_MODE_DEFAULT,
    value: Number.isFinite(value) ? value : ALMOST_VALUE_DEFAULT,
  };
}
