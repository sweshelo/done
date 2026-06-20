import type { SQLiteDatabase } from 'expo-sqlite';

/**
 * スキーマバージョン。DDL を追加するたびに +1 し、MIGRATIONS に差分を追記する。
 * SQLiteProvider の onInit から runMigrations を呼ぶ。
 */
export const DATABASE_VERSION = 7;

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

  2: /* sql */ `
    -- taiko.wiki 全良難易度表の tier 順序を保持するカラムを追加。
    -- NULL = 未取得、0 が最上位（取得ページ上の出現順）。
    ALTER TABLE levels ADD COLUMN tier_rank INTEGER;
  `,

  3: /* sql */ `
    -- ユーザー区別（太鼓番）。records に taiko_no を追加し、自分は '' センチネル。
    -- 既存行は DEFAULT '' で無損失に「自分」となる。
    ALTER TABLE records ADD COLUMN taiko_no TEXT NOT NULL DEFAULT '';

    -- プレイヤー（自分 + ライバル）の名簿。自分は taiko_no='' で seed する。
    CREATE TABLE IF NOT EXISTS players (
      taiko_no   TEXT PRIMARY KEY,
      name       TEXT NOT NULL,
      created_at INTEGER
    );
    INSERT OR IGNORE INTO players (taiko_no, name, created_at) VALUES ('', '自分', 0);

    -- 履歴差分判定キーを (taiko_no, song_number, course) に拡張。
    DROP INDEX IF EXISTS idx_records_song_course;
    CREATE INDEX IF NOT EXISTS idx_records_user_song_course
      ON records (taiko_no, song_number, course, updated_at DESC);
  `,

  4: /* sql */ `
    -- 汎用 key-value メタ情報（自分の太鼓番 self_taiko_no などを保持）。
    CREATE TABLE IF NOT EXISTS app_meta (
      key   TEXT PRIMARY KEY,
      value TEXT
    );
  `,

  5: /* sql */ `
    -- ドメインの「難易度」を Course→Level に改名したことに伴うスキーマ追従。
    -- 譜面詳細テーブル levels→charts、難易度列 course→level に改名する。
    -- RENAME COLUMN は PK・索引内の参照を自動更新する（SQLite >= 3.25）。
    ALTER TABLE levels RENAME TO charts;
    ALTER TABLE charts  RENAME COLUMN course TO level;
    ALTER TABLE records RENAME COLUMN course TO level;

    DROP INDEX IF EXISTS idx_records_user_song_course;
    CREATE INDEX IF NOT EXISTS idx_records_user_song_level
      ON records (taiko_no, song_number, level, updated_at DESC);
  `,

  6: /* sql */ `
    -- ライバルのスコアは詳細ページが未同期で欠落しうる。score 系列を NULL 許容にし、
    -- 「王冠のみ判明」の履歴行を score=NULL で保存できるようにする。
    -- SQLite は列の NOT NULL 制約を後から外せないためテーブルを作り替える。
    -- records は他テーブルから参照されないリーフ表（FK は songs を指すのみ）なので
    -- FK ON のまま安全に再構築できる。id を明示コピーし AUTOINCREMENT を継続させる。
    CREATE TABLE records_new (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      song_number   INTEGER NOT NULL REFERENCES songs(number),
      level         TEXT NOT NULL,
      crown         TEXT NOT NULL,
      class         TEXT NOT NULL,
      score_total   INTEGER,
      good          INTEGER,
      ok            INTEGER,
      ng            INTEGER,
      combo         INTEGER,
      pound         INTEGER,
      ranking       INTEGER,
      options       TEXT NOT NULL DEFAULT '[]',
      play          INTEGER,
      clear         INTEGER,
      fullcombo     INTEGER,
      dondafulcombo INTEGER,
      updated_at    INTEGER NOT NULL,
      taiko_no      TEXT NOT NULL DEFAULT ''
    );

    INSERT INTO records_new
      (id, song_number, level, crown, class, score_total, good, ok, ng, combo, pound,
       ranking, options, play, clear, fullcombo, dondafulcombo, updated_at, taiko_no)
    SELECT
       id, song_number, level, crown, class, score_total, good, ok, ng, combo, pound,
       ranking, options, play, clear, fullcombo, dondafulcombo, updated_at, taiko_no
    FROM records;

    DROP TABLE records;
    ALTER TABLE records_new RENAME TO records;

    CREATE INDEX IF NOT EXISTS idx_records_user_song_level
      ON records (taiko_no, song_number, level, updated_at DESC);
  `,

  7: /* sql */ `
    -- 楽曲のフォルダ機能。手動フォルダのみ DB に保持する
    -- （ジャンル / もうすぐFC / もうすぐDC のスマートフォルダはコードで動的合成）。
    -- folder_songs は曲単位（song_number）。FK ON のため folders 削除で CASCADE 削除する。
    CREATE TABLE IF NOT EXISTS folders (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS folder_songs (
      folder_id   INTEGER NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
      song_number INTEGER NOT NULL REFERENCES songs(number),
      added_at    INTEGER,
      PRIMARY KEY (folder_id, song_number)
    );
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
