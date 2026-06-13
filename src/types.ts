/**
 * ドメイン型。SPEC.md の定義を正とする。
 * プロトタイプ (done/packages/scrape) の `difficulity`(typo) / `songId` は
 * SPEC に合わせて `course` / `songNumber` に修正し、`score.ranking` を追加している。
 */

export type Crown = 'NO_PLAY' | 'PLAYED' | 'CLEAR' | 'FULL_COMBO' | 'DONDAFUL_COMBO';

export type Class =
  | 'NO_MARK'
  | 'IKI_WHITE'
  | 'IKI_BRONZE'
  | 'IKI_SILVER'
  | 'GOLD_MIYABI'
  | 'PINK_MIYABI'
  | 'PURPLE_MIYABI'
  | 'KIWAMI';

export type Course = 'EASY' | 'NORMAL' | 'DIFFICULT' | 'ONI' | 'EXTRA';

export type Option = string;

/**
 * ☆10 譜面の細分化 tier。taiko.wiki の diffchart (dfc/10) に準拠。
 * 「地力」「個人差」の区別はランク文字列に含める（例: '地力S+'）。
 */
export type Tier = string;

/** プレイ履歴（累計回数） */
export interface History {
  play: number;
  clear: number;
  fullcombo: number;
  dondafulcombo: number;
}

/** プレイの記録（ある時点のスナップショット） */
export interface Record {
  songNumber: number;
  course: Course;
  crown: Crown;
  class: Class;
  score: {
    total: number;
    good: number;
    ok: number;
    ng: number;
    combo: number;
    pound: number;
    options: Option[];
    ranking: number;
  };

  history?: History;
  updatedAt?: number;
}

/** 譜面データ（難易度ごと） */
export interface Level {
  course: Course;
  /** ☆の数。wikiwiki / taiko.wiki 由来。未取得は undefined */
  star?: number;
  /** 譜面ページへのリンク */
  link?: string;
  /** ☆10 の tier。未取得は undefined */
  tier?: Tier;
}

/** 楽曲データ */
export interface Song {
  number: number; // 実質的なID（donderhiroba song_no）
  id?: string; // 楽曲識別の内部値。スクレイピングでは取得できない場合がある
  /** 表示用の曲名（SPEC 拡張: 記録閲覧での表示に必須） */
  title?: string;
  level: Level[];
}

export interface Genre {
  id: string;
  title: string;
  songs: Song['number'][];
}

export const COURSES: Course[] = ['EASY', 'NORMAL', 'DIFFICULT', 'ONI', 'EXTRA'];
