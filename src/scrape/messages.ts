import type { Level, Record as DoneRecord } from '../types';

/** Phase 2 の取得対象（リトライにも使う） */
export interface Target {
  id: string; // song_no
  name: string;
  genreIds: string[];
  difficulty: string; // level 1..5
}

/** カタログとして保存する楽曲1件（プレイ有無に関わらず全曲） */
export interface CatalogSongPayload {
  number: number;
  internalId?: string;
  title?: string;
  genreIds: string[];
  levels: Level[];
}

/** 最近プレイ履歴の1件（song_no は取得できないため曲名+難易度のみ） */
export interface RecentHistoryEntry {
  title: string;
  difficulty: string; // level 1..5
}

export type ScrapeMessage =
  | { type: 'progress'; phase: 'catalog' | 'detail' | 'update'; message: string; current: number; total: number }
  | { type: 'catalog'; genres: { id: string; title: string }[]; songs: CatalogSongPayload[] }
  | { type: 'complete'; records: DoneRecord[]; failedTargets: Target[]; taikoNo?: string }
  | { type: 'recentList'; entries: RecentHistoryEntry[] }
  | { type: 'selfTaikoNo'; taikoNo: string }
  | { type: 'error'; message: string };
