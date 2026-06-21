import { useCallback, useState } from 'react';

import { MockInterstitial } from '@/components/ads/MockInterstitial';

import { INTERSTITIAL_MIN_INTERVAL_MS } from './config';

// 実装(useInterstitialGateImpl)と同様にモジュールスコープで頻度上限を保持する。
let lastShownAt = 0;

/**
 * Expo Go 用の全画面広告ゲート（モック）。実広告フックと同じ `{ maybeShow, overlay }` を返す。
 * maybeShow() は同じ頻度上限を尊重しつつモーダルを開き、overlay をツリーに描画して確認できる。
 */
export function useMockInterstitialGate() {
  const [visible, setVisible] = useState(false);

  const maybeShow = useCallback((): boolean => {
    const now = Date.now();
    if (now - lastShownAt < INTERSTITIAL_MIN_INTERVAL_MS) return false;
    lastShownAt = now;
    setVisible(true);
    return true;
  }, []);

  const overlay = <MockInterstitial visible={visible} onClose={() => setVisible(false)} />;

  return { maybeShow, overlay };
}
