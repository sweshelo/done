/**
 * WebView に注入するエントリ。Bun で IIFE バンドルし lib/inject-script.ts を生成する
 * (scripts/build-inject.ts)。donderhiroba のページ上 (ログイン済みセッション) で実行され、
 * window.ReactNativeWebView.postMessage 経由で RN にメッセージを送る。
 *
 * 表示中の URL からコンテキストを判定し、取得範囲を切り替える:
 *   - /score_list.php?genre=X  → そのジャンルのみ (genre モード)
 *   - /score_detail.php?song_no=X&level=Y → その1曲1難易度のみ (detail モード)
 *   - それ以外                 → 全ジャンル全スコア (full モード)
 * retryTargets が指定された場合は常に detail フローで上書きされる。
 */
import type { Record as DoneRecord } from '../types';
import { withConcurrency } from './concurrency';
import { allGenres, GENRE_COUNT, genreId, genreTitle } from './genres';
import type { CatalogSongPayload, ScrapeMessage, Target } from './messages';
import { parseDifficulty, toRecord } from './parsers';
import { fetchDetailRecord, fetchGenreSongs } from './scraper';

interface DoneConfig {
  retryTargets?: Target[];
  concurrency?: number;
  /** 取得対象難易度。未指定(undefined)の場合は全難易度を取得する。 */
  difficulties?: string[]; // Course[] だが inject バンドル内では文字列として扱う
}

declare const window: Window & {
  ReactNativeWebView?: { postMessage(data: string): void };
  __DONE_CONFIG__?: DoneConfig;
};

const post = (msg: ScrapeMessage) => window.ReactNativeWebView?.postMessage(JSON.stringify(msg));

void (async () => {
  const cfg: DoneConfig = window.__DONE_CONFIG__ ?? {};

  try {
    // --- コンテキスト判定 ---
    type Mode = 'full' | 'genre' | 'detail';
    let mode: Mode = 'full';
    let contextGenre = 1;
    let contextSongNo: string | undefined;
    let contextLevel: string | undefined;

    if (!cfg.retryTargets?.length) {
      const urlObj = new URL(window.location.href);
      const pathname = urlObj.pathname;
      const params = urlObj.searchParams;

      if (pathname.includes('score_list.php')) {
        mode = 'genre';
        contextGenre = Number(params.get('genre') ?? '1') || 1;
      } else if (pathname.includes('score_detail.php')) {
        mode = 'detail';
        contextSongNo = params.get('song_no') ?? undefined;
        contextLevel = params.get('level') ?? undefined;
        contextGenre = Number(params.get('genre') ?? '1') || 1;
      }
    }

    // --- Detail モード: 表示中の1曲1難易度のみ取得 ---
    if (mode === 'detail') {
      if (!contextSongNo || !contextLevel) {
        throw new Error('score_detail.php の URL に song_no/level が見当たりません');
      }
      const songTitle = document.querySelector('.songName')?.textContent?.trim();

      // FK 制約のため songs/genres を先に upsert させる最小限のカタログを送信
      post({
        type: 'catalog',
        genres: [{ id: genreId(contextGenre), title: genreTitle(contextGenre) }],
        songs: [{
          number: Number(contextSongNo),
          title: songTitle,
          genreIds: [genreId(contextGenre)],
          courses: [parseDifficulty(contextLevel)],
        }],
      });

      post({ type: 'progress', phase: 'detail', message: songTitle ?? contextSongNo, current: 0, total: 1 });
      const raw = await fetchDetailRecord(contextSongNo, contextLevel);
      const rec = toRecord(raw);
      post({ type: 'complete', records: [rec], failedTargets: [] });
      return;
    }

    // --- Phase 1 / リトライ ---
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
      // Phase 1: genre モードは1ジャンルのみ、full モードは全ジャンル
      const genresToFetch =
        mode === 'genre'
          ? [contextGenre]
          : Array.from({ length: GENRE_COUNT }, (_, i) => i + 1);

      post({
        type: 'progress',
        phase: 'catalog',
        message: '楽曲リストを取得中…',
        current: 0,
        total: genresToFetch.length,
      });

      const songsByGenre = await Promise.all(genresToFetch.map((g) => fetchGenreSongs(g)));

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

      const genresForCatalog =
        mode === 'genre'
          ? [{ id: genreId(contextGenre), title: genreTitle(contextGenre) }]
          : allGenres();

      post({ type: 'catalog', genres: genresForCatalog, songs: catalogSongs });

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

    // 難易度フィルタが指定されていれば対象を絞り込む
    // parseDifficulty で level 番号 → Course 文字列に変換して照合する
    if (cfg.difficulties && cfg.difficulties.length > 0) {
      const allowed = new Set(cfg.difficulties);
      targets = targets.filter((t) => allowed.has(parseDifficulty(t.difficulty)));
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
