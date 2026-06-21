import type { BannerAdSize } from 'react-native-google-mobile-ads';

import { ADS_AVAILABLE, ADS_MOCK } from '@/ads/available';
import { MockBanner } from '@/components/ads/MockBanner';

interface Props {
  size?: BannerAdSize;
}

/**
 * バナー広告のラッパー。
 * - 実広告可（dev client/本番）: 実装を遅延 require（Expo Go で評価させないため）。
 * - モック（Expo Go の dev）: 純 RN のプレースホルダを描画。
 * - それ以外（本番 web 等）: null。
 * `import type` は実行時 import を生まないので Expo Go でも安全。
 */
export function AdBanner(props: Props) {
  if (ADS_AVAILABLE) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- Expo Go で評価させないため遅延 require
    const Impl = require('./AdBannerImpl').AdBannerImpl;
    return <Impl {...props} />;
  }
  if (ADS_MOCK) return <MockBanner />;
  return null;
}
