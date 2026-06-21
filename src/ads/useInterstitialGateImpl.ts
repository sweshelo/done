import { useCallback, useEffect } from 'react';
import { useInterstitialAd, TestIds } from 'react-native-google-mobile-ads';

import { INTERSTITIAL_MIN_INTERVAL_MS, REAL_INTERSTITIAL_UNIT_ID } from './config';

const UNIT_ID = __DEV__ ? TestIds.INTERSTITIAL : REAL_INTERSTITIAL_UNIT_ID;

// モジュールスコープに持たせ、モーダルの開閉やマウントを跨いで頻度上限を効かせる。
let lastShownAt = 0;

/**
 * 全画面広告を「区切りの良いタイミングで、頻度上限つきで」出すためのフック（実装本体）。
 * react-native-google-mobile-ads を import するため、ADS_AVAILABLE のときだけ
 * ラッパー（useInterstitialGate.ts）から require される。
 * - 画面マウント時にプリロードし、表示後は次回ぶんを再ロードする。
 * - maybeShow() はロード済み かつ 前回から十分時間が経っているときだけ表示し、
 *   実際に表示したら true を返す。
 */
export function useInterstitialGateImpl() {
  const { isLoaded, isClosed, load, show } = useInterstitialAd(UNIT_ID, {
    requestNonPersonalizedAdsOnly: false,
  });

  useEffect(() => {
    load();
  }, [load]);

  // 表示が閉じたら次回ぶんを先読みしておく
  useEffect(() => {
    if (isClosed) load();
  }, [isClosed, load]);

  const maybeShow = useCallback((): boolean => {
    if (!isLoaded) return false;
    const now = Date.now();
    if (now - lastShownAt < INTERSTITIAL_MIN_INTERVAL_MS) return false;
    lastShownAt = now;
    show();
    return true;
  }, [isLoaded, show]);

  // 実広告は OS が全画面描画するため、ツリーに差し込む overlay は不要（null）。
  return { maybeShow, overlay: null };
}
