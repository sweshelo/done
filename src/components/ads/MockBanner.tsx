import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * Expo Go 用のバナー広告プレースホルダ（純 RN・ネイティブ非依存）。
 * 実広告（AdBannerImpl）と同じ枠に収まるサイズで、配置とレイアウトを確認できる。
 */
export function MockBanner() {
  const theme = useTheme();
  return (
    <View style={[styles.banner, { borderColor: theme.textSecondary + '55' }]}>
      <ThemedText type="small" themeColor="textSecondary">
        広告（モック）
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    height: 50,
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderStyle: 'dashed',
    borderRadius: Spacing.one,
  },
});
