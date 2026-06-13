import type { RawSongListItem, RawDetailRecord } from './raw-types';

/** fetch の代わりに注入可能にしてテストしやすくする */
export type Fetcher = (url: string) => Promise<string>;

const defaultFetch: Fetcher = (url) => globalThis.fetch(url).then((r) => r.text());

export const GENRE_COUNT = 8;
const BASE_URL = 'https://donderhiroba.jp';

export async function fetchGenreSongs(
  genre: number,
  fetcher: Fetcher = defaultFetch,
): Promise<RawSongListItem[]> {
  const html = await fetcher(`${BASE_URL}/score_list.php?genre=${genre}`);
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
  fetcher: Fetcher = defaultFetch,
): Promise<RawDetailRecord> {
  const html = await fetcher(`${BASE_URL}/score_detail.php?song_no=${id}&level=${difficulty}`);
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
