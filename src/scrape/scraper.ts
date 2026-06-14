import type { RawSongListItem, RawDetailRecord } from './raw-types';

/** fetch の代わりに注入可能にしてテストしやすくする */
export type Fetcher = (url: string) => Promise<string>;

const defaultFetch: Fetcher = (url) => globalThis.fetch(url).then((r) => r.text());

export const GENRE_COUNT = 8;
const BASE_URL = 'https://donderhiroba.jp';

/** taiko_no クエリ。空（自分）なら付与しない。 */
const taikoParam = (taikoNo: string): string =>
  taikoNo ? `&taiko_no=${encodeURIComponent(taikoNo)}` : '';

export async function fetchGenreSongs(
  genre: number,
  taikoNo = '',
  fetcher: Fetcher = defaultFetch,
): Promise<RawSongListItem[]> {
  const html = await fetcher(`${BASE_URL}/score_list.php?genre=${genre}${taikoParam(taikoNo)}`);
  const dom = new DOMParser().parseFromString(html, 'text/html');

  return [...dom.querySelectorAll('.contentBox')].map((song) => {
    const firstLink = song.querySelector('.buttonList > li > a');
    const idMatch = firstLink?.getAttribute('href')?.match(/song_no=(\d+)/);
    const id = idMatch?.[1];

    const results = [...song.querySelectorAll<HTMLAnchorElement>('.buttonList > li > a')].map(
      (a) => {
        const img = a.querySelector('img');
        const diffMatch = a.getAttribute('href')?.match(/level=(\d+)/);
        const difficulty = diffMatch?.[1] ?? '4';
        const srcParts = img?.getAttribute('src')?.split('_') ?? [];
        const isUnplayed = srcParts.includes('none');

        return {
          difficulty,
          played: !isUnplayed,
        };
      },
    );

    return {
      name: song.querySelector('.songName')?.textContent?.trim(),
      id,
      genre,
      results,
    };
  });
}

export async function fetchDetailRecord(
  id: string,
  difficulty: string,
  taikoNo = '',
  fetcher: Fetcher = defaultFetch,
): Promise<RawDetailRecord> {
  const html = await fetcher(
    `${BASE_URL}/score_detail.php?song_no=${id}&level=${difficulty}${taikoParam(taikoNo)}`,
  );
  const dom = new DOMParser().parseFromString(html, 'text/html');

  const text = (selector: string): string | undefined =>
    dom.querySelector(selector)?.textContent?.trim() ?? undefined;

  return {
    id,
    crownSrc: dom.querySelector<HTMLImageElement>('.crown')?.getAttribute('src') ?? undefined,
    classSrc:
      dom.querySelector<HTMLImageElement>('.best_score_icon')?.getAttribute('src') ?? undefined,
    difficulty,
    highScore: text('.high_score'),
    goodCnt: text('.good_cnt'),
    okCnt: text('.ok_cnt'),
    ngCnt: text('.ng_cnt'),
    comboCnt: text('.combo_cnt'),
    poundCnt: text('.pound_cnt'),
    options: [...dom.querySelectorAll<HTMLImageElement>('.optionImage > img')]
      .map((e) => e.getAttribute('src') ?? '')
      .filter((s) => s.length > 0 && !s.includes('blank')),
    playCnt: text('.stage_cnt'),
    clearCnt: text('.clear_cnt'),
    fullComboCnt: text('.full_combo_cnt'),
    dondafulComboCnt: text('.dondaful_combo_cnt'),
    ranking: text('.ranking'),
  };
}

/**
 * 最近のプレイ履歴ページ (history_recent_score.php) を取得し、曲名と難易度を抽出する。
 * このページからは song_no が得られないため曲名+難易度のみを返す（呼び出し側で逆引き）。
 * page=1 が最新、数値を増やすほど過去に遡る（1ページ5曲）。
 */
export async function fetchRecentHistory(
  page: number,
  taikoNo = '',
  fetcher: Fetcher = defaultFetch,
): Promise<{ title: string; difficulty: string }[]> {
  const html = await fetcher(
    `${BASE_URL}/history_recent_score.php?page=${page}${taikoParam(taikoNo)}`,
  );
  const dom = new DOMParser().parseFromString(html, 'text/html');

  return [...dom.querySelectorAll('.scoreUser')]
    .map((entry) => {
      const title = entry.querySelector('.songNameTitleScore h2')?.textContent?.trim();
      // levelIcon の src 例: image/sp/640/icon_course02_5_640.png → 末尾手前の 5 が level(1..5)
      const levelSrc = entry.querySelector('.levelIcon')?.getAttribute('src') ?? '';
      const difficulty = levelSrc.match(/icon_course\d+_(\d+)_/)?.[1];
      return title && difficulty ? { title, difficulty } : null;
    })
    .filter((e): e is { title: string; difficulty: string } => e !== null);
}
