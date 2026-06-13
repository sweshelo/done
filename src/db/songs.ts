import type { SQLiteDatabase } from 'expo-sqlite';

import type { Course, Genre, Level, Song } from '@/types';
import type { SongStar, SongTier } from '@/scrape/taiko-wiki';

/**
 * 楽曲カタログ（Song / Genre / Level）の upsert。
 * プレイ履歴の有無に関わらず、Phase 1 で取得した全曲をここに保存する（SPEC 要件）。
 */

export async function upsertGenre(db: SQLiteDatabase, genre: Pick<Genre, 'id' | 'title'>) {
  await db.runAsync(
    `INSERT INTO genres (id, title) VALUES (?, ?)
     ON CONFLICT(id) DO UPDATE SET title = excluded.title`,
    genre.id,
    genre.title,
  );
}

export async function upsertSong(
  db: SQLiteDatabase,
  song: { number: number; internalId?: string; title?: string },
) {
  // 既存値を NULL で上書きしないよう COALESCE で温存する
  await db.runAsync(
    `INSERT INTO songs (number, internal_id, title) VALUES (?, ?, ?)
     ON CONFLICT(number) DO UPDATE SET
       internal_id = COALESCE(excluded.internal_id, songs.internal_id),
       title       = COALESCE(excluded.title, songs.title)`,
    song.number,
    song.internalId ?? null,
    song.title ?? null,
  );
}

export async function linkGenreSong(db: SQLiteDatabase, genreId: string, songNumber: number) {
  await db.runAsync(
    `INSERT INTO genre_songs (genre_id, song_number) VALUES (?, ?)
     ON CONFLICT(genre_id, song_number) DO NOTHING`,
    genreId,
    songNumber,
  );
}

export async function upsertLevel(
  db: SQLiteDatabase,
  songNumber: number,
  level: Level,
) {
  // star / link / tier は別経路（taiko.wiki 等）で後から埋まるため、
  // 既存の非 NULL 値を温存する。
  await db.runAsync(
    `INSERT INTO levels (song_number, course, star, link, tier) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(song_number, course) DO UPDATE SET
       star = COALESCE(excluded.star, levels.star),
       link = COALESCE(excluded.link, levels.link),
       tier = COALESCE(excluded.tier, levels.tier)`,
    songNumber,
    level.course,
    level.star ?? null,
    level.link ?? null,
    level.tier ?? null,
  );
}

/** スクレイプ Phase 1 が返す楽曲カタログ1件分（1曲が複数ジャンルに属しうる） */
export interface SongCatalogItem {
  number: number;
  internalId?: string;
  title?: string;
  genreIds: string[];
  /** その曲に存在する難易度（course） */
  courses: Course[];
}

/**
 * 楽曲カタログをまとめて保存する。同一トランザクションで Song / Genre / Level を upsert。
 * genres は呼び出し側で別途 upsert 済みであることを前提とする（id/title が必要なため）。
 */
export async function saveSongCatalog(db: SQLiteDatabase, items: SongCatalogItem[]) {
  await db.withTransactionAsync(async () => {
    for (const item of items) {
      await upsertSong(db, {
        number: item.number,
        internalId: item.internalId,
        title: item.title,
      });
      for (const genreId of item.genreIds) {
        await linkGenreSong(db, genreId, item.number);
      }
      for (const course of item.courses) {
        await upsertLevel(db, item.number, { course });
      }
    }
  });
}

export async function saveGenres(db: SQLiteDatabase, genres: Pick<Genre, 'id' | 'title'>[]) {
  await db.withTransactionAsync(async () => {
    for (const g of genres) await upsertGenre(db, g);
  });
}

const WIKI_COURSE_MAP: Record<string, Course> = {
  easy: 'EASY',
  normal: 'NORMAL',
  hard: 'DIFFICULT',
  oni: 'ONI',
  ura: 'EXTRA',
};

/**
 * taiko.wiki の★数データを levels テーブルに書き込む。
 * UPDATE のみ（INSERT なし）なので FK 違反が起きず、カタログ未取得の曲はスキップされる。
 * 戻り値は更新した行の総数。
 */
export async function saveStarCounts(db: SQLiteDatabase, stars: SongStar[]): Promise<number> {
  let updated = 0;
  await db.withTransactionAsync(async () => {
    for (const star of stars) {
      for (const [wikiKey, course] of Object.entries(WIKI_COURSE_MAP)) {
        const level = star[wikiKey as keyof SongStar] as number | undefined;
        if (level == null) continue;
        const result = await db.runAsync(
          'UPDATE levels SET star = ? WHERE song_number = ? AND course = ?',
          level,
          star.songNo,
          course,
        );
        updated += result.changes;
      }
    }
  });
  return updated;
}

/**
 * taiko.wiki の全良難易度表データを levels テーブルの tier 列に書き込む。
 * UPDATE のみなので FK 違反なし。カタログ未取得の曲はスキップされる。
 * 戻り値は更新した行の総数。
 */
export async function saveTierData(db: SQLiteDatabase, tiers: SongTier[]): Promise<number> {
  let updated = 0;
  await db.withTransactionAsync(async () => {
    for (const t of tiers) {
      const result = await db.runAsync(
        'UPDATE levels SET tier = ?, tier_rank = ? WHERE song_number = ? AND course = ?',
        t.tier,
        t.tierRank,
        t.songNo,
        t.course,
      );
      updated += result.changes;
    }
  });
  return updated;
}
