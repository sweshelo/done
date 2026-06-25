import type { SQLiteDatabase } from 'expo-sqlite';

import type { Level } from '@/types';

/** app_meta の key 定数 */
export const SELF_TAIKO_NO_KEY = 'self_taiko_no';

/** 「もうすぐFC/DC」判定の閾値方式（'absolute' = 絶対値, 'percent' = ％）。 */
export const ALMOST_MODE_KEY = 'almost_mode';
/** 「もうすぐFC/DC」判定の閾値（数値文字列）。 */
export const ALMOST_VALUE_KEY = 'almost_value';
/**
 * 「メインの難易度」。もうすぐFC/DC の対象難易度と ☆別フォルダの絞り込みに使う
 * 共通設定（Level の CSV）。未設定なら既定（おに）。
 */
export const MAIN_LEVELS_KEY = 'main_levels';

export type AlmostMode = 'absolute' | 'percent';
export interface AlmostConfig {
  mode: AlmostMode;
  value: number;
  /** 対象難易度。空でない配列。既定は全5難易度。 */
  levels: Level[];
}

const ALMOST_MODE_DEFAULT: AlmostMode = 'absolute';
const ALMOST_VALUE_DEFAULT = 3;
const ALL_LEVELS: Level[] = ['EASY', 'NORMAL', 'DIFFICULT', 'ONI', 'EXTRA'];
/** メインの難易度の既定値（おに＝ONI + 裏 EXTRA）。 */
const MAIN_LEVELS_DEFAULT: Level[] = ['ONI', 'EXTRA'];

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

/**
 * 「メインの難易度」を読む。もうすぐFC/DC と ☆別フォルダで共有する。
 * 未設定時は既定（おに）を返す。常に空でない配列を返す。
 */
export async function getMainLevels(db: SQLiteDatabase): Promise<Level[]> {
  const raw = await getMeta(db, MAIN_LEVELS_KEY);
  const parsed = raw
    ? (raw.split(',').filter((l) => (ALL_LEVELS as string[]).includes(l)) as Level[])
    : [];
  return parsed.length > 0 ? parsed : MAIN_LEVELS_DEFAULT;
}

/**
 * 「もうすぐFC/DC」判定の閾値設定を読む。未設定時は既定 (absolute / 3) を返す。
 * 対象難易度は「メインの難易度」(getMainLevels) を共有する。
 */
export async function getAlmostConfig(db: SQLiteDatabase): Promise<AlmostConfig> {
  const mode = (await getMeta(db, ALMOST_MODE_KEY)) as AlmostMode | null;
  const rawValue = await getMeta(db, ALMOST_VALUE_KEY);
  const value = rawValue != null && rawValue !== '' ? Number(rawValue) : NaN;
  return {
    mode: mode === 'percent' || mode === 'absolute' ? mode : ALMOST_MODE_DEFAULT,
    value: Number.isFinite(value) ? value : ALMOST_VALUE_DEFAULT,
    levels: await getMainLevels(db),
  };
}
