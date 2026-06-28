import type { ImageSourcePropType } from 'react-native';

import type { Class, Crown, Level } from '@/types';

/**
 * 太鼓固有のカラースキーム。
 *
 * - 状態色 (Crown) は SPEC.md 指定値。* 付きは光るハイライト演出が望ましい。
 * - 難易度 (Level) / ジャンル背景色は wikiwiki.jp の表に揃える方針だが、
 *   wikiwiki はエージェントから取得不可のためユーザー提供待ち（暫定値）。→ DESIGN.md §8.2
 */

/** Crown（達成状況）の色。SPEC 指定。 */
export const CrownColors: Record<Crown, string> = {
  NO_PLAY: '#444',
  PLAYED: '#888',
  CLEAR: '#ababab',
  FULL_COMBO: '#f3c621',
  DONDAFUL_COMBO: '#f170ff', // または虹色グラデーション
};

/** ハイライト演出（シマー）を行うべき Crown */
export const GLOWING_CROWNS: Crown[] = ['CLEAR', 'FULL_COMBO', 'DONDAFUL_COMBO'];

/** ドンダフルは虹色グラデーション表現も可（演出用） */
export const DONDAFUL_GRADIENT = ['#ff5f6d', '#ffc371', '#f3f34c', '#5cff6b', '#5ce1ff', '#f170ff'];

/**
 * 金属光沢グラデーション（光→ベース→影→光のスイープで光沢を表現）。
 * クラウン状態色を「面」として塗る箇所で単色の代わりに使う。値は初期値（調整可）。
 */
/** 金（フルコンボ） */
export const GOLD_GRADIENT = ['#ffea83', '#F3C621', '#A9810F', '#F3C621', '#FFF1A8'] as const;
/** 銀（クリア）— 濃色テキストの可読性のため明るめ寄り */
export const SILVER_GRADIENT = ['#b6b6b6', '#767676', '#e4e4e4', '#838383'] as const;

/** 金属光沢グラデを持つ Crown のマップ。全良は虹色グラデ。 */
export const CrownGradients: Partial<Record<Crown, readonly string[]>> = {
  CLEAR: SILVER_GRADIENT,
  FULL_COMBO: GOLD_GRADIENT,
  DONDAFUL_COMBO: DONDAFUL_GRADIENT,
};

/** 単一クラウンの金属光沢グラデ stops。グラデ非対象なら null。 */
export function crownGradient(crown: Crown): readonly string[] | null {
  return CrownGradients[crown] ?? null;
}

/**
 * 2 クラウンを対角（start{0,0}/end{1,1}）に並べた合成グラデを返す。
 * group1 を [0, 0.49]、group2 を [0.51, 1] に割り当て、中央でクリスプに分割する。
 * グラデ非対象のクラウンは単色（CrownColors）で 1 stop 扱いにする。
 */
export function dualCrownGradient(
  c1: Crown,
  c2: Crown,
): { colors: string[]; locations: number[] } {
  const g1 = (CrownGradients[c1] ?? [CrownColors[c1]]) as readonly string[];
  const g2 = (CrownGradients[c2] ?? [CrownColors[c2]]) as readonly string[];
  const span = (stops: readonly string[], start: number, end: number): number[] =>
    stops.length === 1
      ? [start]
      : stops.map((_, i) => start + ((end - start) * i) / (stops.length - 1));
  return {
    colors: [...g1, ...g2],
    locations: [...span(g1, 0, 0.49), ...span(g2, 0.51, 1)],
  };
}

/**
 * 難易度（Level）背景色。暫定。wikiwiki 確定後に転記する。
 * 太鼓の一般的な難易度カラーを暫定採用。
 */
export const LevelColors: Record<Level, string> = {
  EASY: '#f02814', // かんたん（暫定）
  NORMAL: '#e7a900', // ふつう（暫定）
  DIFFICULT: '#28a818', // むずかしい（暫定）
  ONI: '#bc1a8d', // おに（暫定）
  EXTRA: '#5a3a9e', // おに裏（暫定）
};

/** 難易度ラベル（日本語） */
export const LevelLabels: Record<Level, string> = {
  EASY: 'かんたん',
  NORMAL: 'ふつう',
  DIFFICULT: 'むずかしい',
  ONI: 'おに',
  EXTRA: 'おに裏',
};

/**
 * 難易度アイコン画像マッパー。
 * 1.png=かんたん(EASY), 2.png=ふつう(NORMAL), 3.png=むずかしい(DIFFICULT),
 * 4.png=おに(ONI), 5.png=裏(EXTRA)。
 * 注: assets/images/level/*.png は難易度アイコン専用。極スコアマークは ClassImages（class/*.png）を使う。
 */
export const LevelImages: Record<Level, ImageSourcePropType> = {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  EASY: require('../../assets/images/level/1.png') as ImageSourcePropType,
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  NORMAL: require('../../assets/images/level/2.png') as ImageSourcePropType,
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  DIFFICULT: require('../../assets/images/level/3.png') as ImageSourcePropType,
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  ONI: require('../../assets/images/level/4.png') as ImageSourcePropType,
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  EXTRA: require('../../assets/images/level/5.png') as ImageSourcePropType,
};

/**
 * ジャンル基準色 (wikiwiki.jp の th 背景色より)。
 * genreId (1..8) → 色。
 */
export const GenreColors: Record<string, string> = {
  '1': '#49d5eb', // ポップス
  '2': '#fe90d2', // アニメ
  '3': '#fdc000', // キッズ
  '4': '#cbcfde', // ボーカロイド
  '5': '#cc8aeb', // ゲームミュージック
  '6': '#ff7028', // ナムコオリジナル
  '7': '#0acc2a', // バラエティ
  '8': '#ded523', // クラシック
};

/**
 * リスト行背景に使うジャンル暗色の輝度係数（0.0 〜 1.0）。
 * 値を大きくするほど明るくなる。
 */
export const GENRE_DARK_FACTOR = 0.5;

/** hex カラーの各チャンネルに係数を乗算して暗くする */
function darkenHex(hex: string, factor: number): string {
  const n = parseInt(hex.replace('#', ''), 16);
  const r = Math.round(((n >> 16) & 0xff) * factor);
  const g = Math.round(((n >> 8) & 0xff) * factor);
  const b = Math.round((n & 0xff) * factor);
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

/**
 * ジャンル背景色（暗色版）。
 * 基準色 × GENRE_DARK_FACTOR で計算する。
 * リスト行の背景などデザイン用途に使用。
 */
export const GenreColorsDark: Record<string, string> = Object.fromEntries(
  Object.entries(GenreColors).map(([id, color]) => [id, darkenHex(color, GENRE_DARK_FACTOR)]),
);

/** ジャンル色なし時のフォールバック（ダーク backgroundElement に相当） */
export const GENRE_FALLBACK_COLOR = '#212225';

/**
 * カンマ区切りのジャンル ID 文字列（GROUP_CONCAT 由来）から行背景色を解決する。
 * 2 ジャンル以上で色が異なる場合は対角グラデーション用に color1/color2 と isDual を返す。
 */
export function resolveGenreColors(genreIds: string | null): {
  color1: string;
  color2: string;
  isDual: boolean;
} {
  const ids = genreIds ? genreIds.split(',').filter(Boolean) : [];
  const color1 = GenreColorsDark[ids[0]] ?? GENRE_FALLBACK_COLOR;
  const color2 = ids.length >= 2 ? (GenreColorsDark[ids[1]] ?? GENRE_FALLBACK_COLOR) : color1;
  return { color1, color2, isDual: ids.length >= 2 && color1 !== color2 };
}

/**
 * 王冠画像マッパー。
 * 0.png=PLAYED, 1.png=CLEAR, 2.png=FULL_COMBO, 3.png=DONDAFUL_COMBO
 * NO_PLAY はプレイ記録に存在しないため省略。
 */
export const CrownImages: Partial<Record<Crown, ImageSourcePropType>> = {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  PLAYED: require('../../assets/images/crown/0.png') as ImageSourcePropType,
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  CLEAR: require('../../assets/images/crown/1.png') as ImageSourcePropType,
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  FULL_COMBO: require('../../assets/images/crown/2.png') as ImageSourcePropType,
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  DONDAFUL_COMBO: require('../../assets/images/crown/3.png') as ImageSourcePropType,
};

/** Class（段位/雅）ラベル */
export const ClassLabels: Record<Class, string> = {
  NO_MARK: '—',
  IKI_WHITE: '粋(白)',
  IKI_BRONZE: '粋(銅)',
  IKI_SILVER: '粋(銀)',
  GOLD_MIYABI: '雅(金)',
  PINK_MIYABI: '雅(桃)',
  PURPLE_MIYABI: '雅(紫)',
  KIWAMI: '極',
};

/**
 * 極マークアイコン画像マッパー。
 * 1.png=IKI_WHITE .. 7.png=KIWAMI。NO_MARK は画像なし。
 */
export const ClassImages: Partial<Record<Class, ImageSourcePropType>> = {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  IKI_WHITE: require('../../assets/images/class/2.png') as ImageSourcePropType,
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  IKI_BRONZE: require('../../assets/images/class/3.png') as ImageSourcePropType,
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  IKI_SILVER: require('../../assets/images/class/4.png') as ImageSourcePropType,
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  GOLD_MIYABI: require('../../assets/images/class/5.png') as ImageSourcePropType,
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  PINK_MIYABI: require('../../assets/images/class/6.png') as ImageSourcePropType,
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  PURPLE_MIYABI: require('../../assets/images/class/7.png') as ImageSourcePropType,
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  KIWAMI: require('../../assets/images/class/8.png') as ImageSourcePropType,
};
