/** スクレイプした生データ（パース前）。WebView (ブラウザ) コンテキストで使う。 */

export interface RawSongResult {
  difficulty: string; // donderhiroba の level パラメータ (1..5)
  played: boolean;
}

export interface RawSongListItem {
  name: string | undefined;
  id: string | undefined; // song_no
  genre: number; // 1..8
  results: RawSongResult[];
}

export interface RawDetailRecord {
  id: string;
  crownSrc: string | undefined;
  classSrc: string | undefined;
  difficulty: string;
  highScore: string | undefined;
  goodCnt: string | undefined;
  okCnt: string | undefined;
  ngCnt: string | undefined;
  comboCnt: string | undefined;
  poundCnt: string | undefined;
  options: string[];
  playCnt: string | undefined;
  clearCnt: string | undefined;
  fullComboCnt: string | undefined;
  dondafulComboCnt: string | undefined;
  ranking: string | undefined;
}
