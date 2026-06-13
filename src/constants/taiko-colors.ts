import type { Class, Course, Crown } from '@/types';

/**
 * 太鼓固有のカラースキーム。
 *
 * - 状態色 (Crown) は SPEC.md 指定値。* 付きは光るハイライト演出が望ましい。
 * - 難易度 (Course) / ジャンル背景色は wikiwiki.jp の表に揃える方針だが、
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
 * 難易度（Course）背景色。暫定。wikiwiki 確定後に転記する。
 * 太鼓の一般的な難易度カラーを暫定採用。
 */
export const CourseColors: Record<Course, string> = {
  EASY: '#f02814', // かんたん（暫定）
  NORMAL: '#e7a900', // ふつう（暫定）
  DIFFICULT: '#28a818', // むずかしい（暫定）
  ONI: '#bc1a8d', // おに（暫定）
  EXTRA: '#5a3a9e', // おに裏（暫定）
};

/** 難易度ラベル（日本語） */
export const CourseLabels: Record<Course, string> = {
  EASY: 'かんたん',
  NORMAL: 'ふつう',
  DIFFICULT: 'むずかしい',
  ONI: 'おに',
  EXTRA: 'おに裏',
};

/** ジャンル背景色。wikiwiki 確定後にジャンルID→色を埋める（暫定で未設定）。 */
export const GenreColors: Record<string, string> = {};

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
