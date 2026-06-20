import type { Class, Level, Crown, Record as DoneRecord } from '../types';
import type { RawDetailRecord } from './raw-types';

const DIFFICULTY_MAP: { [key: string]: Level } = {
  '1': 'EASY',
  '2': 'NORMAL',
  '3': 'DIFFICULT',
  '4': 'ONI',
  '5': 'EXTRA',
};

export function parseDifficulty(level: string | number): Level {
  return DIFFICULTY_MAP[String(level)] ?? 'ONI';
}

// crown_large_N_640.png の N → Crown
// 詳細ページはプレイ済み楽曲のみ到達可能なため NO_PLAY は存在しない
const CROWN_MAP: Crown[] = ['PLAYED', 'CLEAR', 'FULL_COMBO', 'DONDAFUL_COMBO'];

// best_score_rank_N_640.png の N → Class
const CLASS_MAP: Class[] = [
  'NO_MARK',
  'IKI_WHITE',
  'IKI_BRONZE',
  'IKI_SILVER',
  'GOLD_MIYABI',
  'PINK_MIYABI',
  'PURPLE_MIYABI',
  'KIWAMI',
];

/** crown_large_N_640.png の N を抽出して Crown に変換する */
export function parseCrown(src: string | undefined): Crown {
  const n = src?.match(/crown_large_(\d+)_/)?.[1];
  return CROWN_MAP[Number(n)] ?? 'PLAYED';
}

/** best_score_rank_N_640.png の N を抽出して Class に変換する */
export function parseClass(src: string | undefined): Class {
  const n = src?.match(/best_score_rank_(\d+)_/)?.[1];
  return CLASS_MAP[Number(n) - 1] ?? 'NO_MARK'; // 粋が2から始まるため -1 する
}

/** "123回" のような文字列から数値を取り出す */
export function parseCount(text: string | undefined): number {
  if (!text) return 0;
  const n = parseInt(text.replace(/\D/g, ''), 10);
  return isNaN(n) ? 0 : n;
}

/**
 * 生スクレイプデータを SPEC の Record 型に変換する。
 * genres / title はカタログ側で持つため、ここでは扱わない。
 */
export function toRecord(raw: RawDetailRecord): DoneRecord {
  const hasHistory = raw.playCnt !== undefined;
  // ライバルの詳細ページは同期されておらずスコアが欠落しうる。
  // ハイスコア欄が無い場合は score を持たない記録（王冠のみ判明）として扱う。
  const hasScore = raw.highScore !== undefined && raw.highScore !== '';

  return {
    songNumber: parseInt(raw.id, 10),
    level: parseDifficulty(raw.difficulty),
    crown: parseCrown(raw.crownSrc),
    class: parseClass(raw.classSrc),
    score: hasScore
      ? {
          total: parseCount(raw.highScore),
          good: parseCount(raw.goodCnt),
          ok: parseCount(raw.okCnt),
          ng: parseCount(raw.ngCnt),
          combo: parseCount(raw.comboCnt),
          pound: parseCount(raw.poundCnt),
          options: raw.options,
          ranking: parseCount(raw.ranking),
        }
      : undefined,
    history: hasHistory
      ? {
          play: parseCount(raw.playCnt),
          clear: parseCount(raw.clearCnt),
          fullcombo: parseCount(raw.fullComboCnt),
          dondafulcombo: parseCount(raw.dondafulComboCnt),
        }
      : undefined,
    updatedAt: Date.now(),
  };
}
