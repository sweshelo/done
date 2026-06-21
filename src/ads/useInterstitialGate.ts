import type { ReactNode } from 'react';

import { ADS_AVAILABLE, ADS_MOCK } from './available';
import { useMockInterstitialGate } from './useMockInterstitialGate';

interface InterstitialGate {
  /** ロード済み かつ 頻度上限内なら全画面広告を表示し true を返す。 */
  maybeShow: () => boolean;
  /** モック時のみ非 null。consumer はこれをツリーに描画する（実広告は OS 描画なので null）。 */
  overlay: ReactNode;
}

/**
 * 全画面広告フックのラッパー。
 * - 実広告可（dev client/本番）: 実装を遅延 require（Expo Go で評価させないため）。
 * - モック（Expo Go の dev）: モックゲートを使用。
 * - それ以外: no-op。
 *
 * ADS_AVAILABLE / ADS_MOCK はセッション内で不変なので、分岐してもフック順序は
 * 全レンダーで一定（実害なし、rules-of-hooks のみ抑止）。
 */
export function useInterstitialGate(): InterstitialGate {
  if (ADS_AVAILABLE) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- Expo Go で評価させないため遅延 require
    return require('./useInterstitialGateImpl').useInterstitialGateImpl();
  }
  if (ADS_MOCK) {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    return useMockInterstitialGate();
  }
  return { maybeShow: () => false, overlay: null };
}
