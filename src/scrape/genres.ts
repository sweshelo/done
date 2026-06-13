/**
 * donderhiroba の score_list.php?genre=N の N → ジャンル情報。
 *
 * NOTE: title は wikiwiki.jp の譜面表ページのキー（次フェーズで ★数/色取得に使う）に
 * 揃える想定だが、本家のジャンル並び順は要確認 (DESIGN.md §9-Q4 関連)。
 * 確定するまでは暫定値とし、未知のジャンルは `ジャンルN` にフォールバックする。
 */
export const GENRE_COUNT = 8;

const GENRE_TITLES: Record<number, string> = {
  1: 'ポップス',
  2: 'アニメ',
  3: 'キッズ',
  4: 'ボーカロイド',
  5: 'ゲームミュージック',
  6: 'ナムコオリジナル',
  7: 'クラシック',
  8: 'バラエティ',
};

export function genreId(n: number): string {
  return String(n);
}

export function genreTitle(n: number): string {
  return GENRE_TITLES[n] ?? `ジャンル${n}`;
}

export function allGenres(): { id: string; title: string }[] {
  return Array.from({ length: GENRE_COUNT }, (_, i) => {
    const n = i + 1;
    return { id: genreId(n), title: genreTitle(n) };
  });
}
