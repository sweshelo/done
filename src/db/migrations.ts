import type { SQLiteDatabase } from 'expo-sqlite';

/**
 * スキーマバージョン。DDL を追加するたびに +1 し、MIGRATIONS に差分を追記する。
 * SQLiteProvider の onInit から runMigrations を呼ぶ。
 */
export const DATABASE_VERSION = 1;

/** バージョン v に上げるための DDL。index = 適用後のバージョン番号。 */
const MIGRATIONS: Record<number, string> = {
  1: /* sql */ `
    -- v1 は初期スキーマ。保持すべきデータは無いため、過去の dev 実行で残った
    -- 旧スキーマのテーブルがあれば作り直す（子テーブルから順に DROP）。
    DROP TABLE IF EXISTS records;
    DROP TABLE IF EXISTS genre_songs;
    DROP TABLE IF EXISTS levels;
    DROP TABLE IF EXISTS songs;
    DROP TABLE IF EXISTS genres;

    CREATE TABLE IF NOT EXISTS genres (
      id    TEXT PRIMARY KEY,
      title TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS songs (
      number      INTEGER PRIMARY KEY,
      internal_id TEXT,
      title       TEXT
    );

    CREATE TABLE IF NOT EXISTS genre_songs (
      genre_id    TEXT NOT NULL REFERENCES genres(id),
      song_number INTEGER NOT NULL REFERENCES songs(number),
      PRIMARY KEY (genre_id, song_number)
    );

    CREATE TABLE IF NOT EXISTS levels (
      song_number INTEGER NOT NULL REFERENCES songs(number),
      course      TEXT NOT NULL,
      star        INTEGER,
      link        TEXT,
      tier        TEXT,
      PRIMARY KEY (song_number, course)
    );

    CREATE TABLE IF NOT EXISTS records (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      song_number   INTEGER NOT NULL REFERENCES songs(number),
      course        TEXT NOT NULL,
      crown         TEXT NOT NULL,
      class         TEXT NOT NULL,
      score_total   INTEGER NOT NULL,
      good          INTEGER NOT NULL,
      ok            INTEGER NOT NULL,
      ng            INTEGER NOT NULL,
      combo         INTEGER NOT NULL,
      pound         INTEGER NOT NULL,
      ranking       INTEGER,
      options       TEXT NOT NULL DEFAULT '[]',
      play          INTEGER,
      clear         INTEGER,
      fullcombo     INTEGER,
      dondafulcombo INTEGER,
      updated_at    INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_records_song_course
      ON records (song_number, course, updated_at DESC);
  `,
};

/**
 * PRAGMA user_version をもとに未適用のマイグレーションを順に適用する。
 * SDK 56 公式パターン (SQLiteProvider onInit) に準拠。
 */
export async function runMigrations(db: SQLiteDatabase): Promise<void> {
  await db.execAsync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  let version = row?.user_version ?? 0;
  if (version >= DATABASE_VERSION) return;

  for (let v = version + 1; v <= DATABASE_VERSION; v++) {
    const ddl = MIGRATIONS[v];
    if (!ddl) continue;
    await db.withExclusiveTransactionAsync(async (tx) => {
      await tx.execAsync(ddl);
    });
    version = v;
  }

  // user_version はパラメータバインド不可のため文字列補間
  await db.execAsync(`PRAGMA user_version = ${DATABASE_VERSION}`);
}

export const DATABASE_NAME = 'done.db';
