/**
 * WebView に注入するエントリ。Bun で IIFE バンドルし lib/inject-script.ts を生成する
 * (scripts/build-inject.ts)。donderhiroba のページ上 (ログイン済みセッション) で実行され、
 * window.ReactNativeWebView.postMessage 経由で RN にメッセージを送る。
 *
 * 動作モードは注入直前に RN が代入する window.__DONE_CONFIG__ で切り替える:
 *   - mode 'probe'  : ログイン状態のみ判定して 'session' を返す
 *   - mode 'scrape' : Phase1(カタログ) → Phase2(詳細) を実行
 */
import { withConcurrency } from './concurrency';
import { allGenres, genreId, GENRE_COUNT } from './genres';
import type { CatalogSongPayload, ScrapeMessage, Target } from './messages';
import { parseDifficulty, toRecord } from './parsers';
import { fetchDetailRecord, fetchGenreSongs } from './scraper';
import { probeLoginState } from './session';
import type { Record as DoneRecord } from '../types';

interface DoneConfig {
  mode: 'probe' | 'scrape';
  retryTargets?: Target[];
  concurrency?: number;
}

declare const window: Window & {
  ReactNativeWebView?: { postMessage(data: string): void };
  __DONE_CONFIG__?: DoneConfig;
};

const post = (msg: ScrapeMessage) => window.ReactNativeWebView?.postMessage(JSON.stringify(msg));

void (async () => {
  const cfg: DoneConfig = window.__DONE_CONFIG__ ?? { mode: 'probe' };

  try {
    if (cfg.mode === 'probe') {
      const state = await probeLoginState();
      post({ type: 'session', loggedIn: state.loggedIn, reason: state.reason });
      return;
    }

    let targets: Target[];

    if (cfg.retryTargets && cfg.retryTargets.length > 0) {
      // 再試行: Phase 1 をスキップ
      targets = cfg.retryTargets;
      post({
        type: 'progress',
        phase: 'detail',
        message: '失敗分を再試行中…',
        current: 0,
        total: targets.length,
      });
    } else {
      // Phase 1: 全ジャンルの楽曲リストを取得
      post({
        type: 'progress',
        phase: 'catalog',
        message: '楽曲リストを取得中…',
        current: 0,
        total: GENRE_COUNT,
      });

      const songsByGenre = await Promise.all(
        Array.from({ length: GENRE_COUNT }, (_, i) => fetchGenreSongs(i + 1)),
      );

      // 同一曲が複数ジャンルに属す場合があるため曲IDで集約しジャンル/難易度をマージ
      const map = new Map<
        string,
        { id: string; name: string; genres: number[]; results: { difficulty: string; played: boolean }[] }
      >();
      for (const songs of songsByGenre) {
        for (const song of songs) {
          if (!song.id) continue;
          const ex = map.get(song.id);
          if (ex) {
            if (!ex.genres.includes(song.genre)) ex.genres.push(song.genre);
            for (const r of song.results) {
              const f = ex.results.find((er) => er.difficulty === r.difficulty);
              if (!f) ex.results.push(r);
              else if (r.played && !f.played) f.played = true;
            }
          } else {
            map.set(song.id, {
              id: song.id,
              name: song.name ?? '',
              genres: [song.genre],
              results: song.results,
            });
          }
        }
      }

      // カタログ（プレイ有無に関わらず全曲）を送信
      const catalogSongs: CatalogSongPayload[] = [...map.values()].map((s) => ({
        number: Number(s.id),
        title: s.name,
        genreIds: s.genres.map(genreId),
        courses: s.results.map((r) => parseDifficulty(r.difficulty)),
      }));
      post({ type: 'catalog', genres: allGenres(), songs: catalogSongs });

      // Phase 2 用 targets（プレイ済みのみ）
      targets = [...map.values()].flatMap((s) =>
        s.results
          .filter((r) => r.played)
          .map((r) => ({
            id: s.id,
            name: s.name,
            genreIds: s.genres.map(genreId),
            difficulty: r.difficulty,
          })),
      );
    }

    // Phase 2: 詳細スコアを並列取得（個別エラーは失敗リストに収集）
    const failed: Target[] = [];
    let done = 0;

    const results = await withConcurrency<DoneRecord | null>(
      targets.map((t) => async (): Promise<DoneRecord | null> => {
        try {
          const raw = await fetchDetailRecord(t.id, t.difficulty);
          const rec = toRecord(raw);
          post({ type: 'progress', phase: 'detail', message: t.name, current: ++done, total: targets.length });
          return rec;
        } catch {
          failed.push(t);
          post({ type: 'progress', phase: 'detail', message: t.name, current: ++done, total: targets.length });
          return null;
        }
      }),
      cfg.concurrency ?? 10,
    );

    const records = results.filter((r): r is DoneRecord => r !== null);
    post({ type: 'complete', records, failedTargets: failed });
  } catch (e) {
    post({ type: 'error', message: String(e) });
  }
})();
