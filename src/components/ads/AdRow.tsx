import { StyleSheet } from 'react-native';

import { ADS_AVAILABLE, ADS_MOCK } from '@/ads/available';
import { AdBanner } from '@/components/ads/AdBanner';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * 記録一覧に差し込む広告 Row。通常 Row（ジャンル色）と明確に区別できるよう
 * 破線枠つきのニュートラルなカードにし、「広告」ラベルを必ず表示する（ポリシー要件）。
 */
export function AdRow() {
  const theme = useTheme();
  // 実広告もモックも無い環境（本番 web 等）では枠ごと出さない。
  // モック時は内側の AdBanner がモックバナーを描画する。
  if (!ADS_AVAILABLE && !ADS_MOCK) return null;
  return (
    <ThemedView
      type="backgroundElement"
      style={[styles.row, { borderColor: theme.textSecondary + '40' }]}
    >
      <ThemedText type="small" themeColor="textSecondary" style={styles.badge}>
        広告
      </ThemedText>
      <AdBanner />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  row: {
    borderRadius: Spacing.two,
    borderWidth: 1,
    borderStyle: 'dashed',
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.two,
    gap: Spacing.one,
    alignItems: 'center',
  },
  badge: { alignSelf: 'flex-start' },
});
