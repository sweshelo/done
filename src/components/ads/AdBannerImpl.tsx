import { useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { BannerAd, BannerAdSize, TestIds } from 'react-native-google-mobile-ads';

import { REAL_BANNER_UNIT_ID } from '@/ads/config';

const UNIT_ID = __DEV__ ? TestIds.BANNER : REAL_BANNER_UNIT_ID;

interface Props {
  size?: BannerAdSize;
}

/**
 * 1枚のバナー広告（実装本体）。react-native-google-mobile-ads を import するため、
 * ADS_AVAILABLE のときだけラッパー（AdBanner.tsx）から require される。
 * ロード失敗時は領域ごと畳んで何も表示しない。
 */
export function AdBannerImpl({ size = BannerAdSize.ANCHORED_ADAPTIVE_BANNER }: Props) {
  const [failed, setFailed] = useState(false);

  if (failed) return null;

  return (
    <View style={styles.container}>
      <BannerAd
        unitId={UNIT_ID}
        size={size}
        requestOptions={{ requestNonPersonalizedAdsOnly: false }}
        onAdFailedToLoad={() => setFailed(true)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: 'center', justifyContent: 'center' },
});
