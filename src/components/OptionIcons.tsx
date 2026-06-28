import { Image, StyleSheet, View } from 'react-native';

import { optionImageUri } from '@/constants/taiko-colors';

/**
 * 演奏オプションのアイコン列（本家ドンだーひろばの画像 src 配列をそのまま並べる）。
 * 記録詳細モーダル（size=28）・スマートフォルダ「自己ベストで演奏オプションを使用した曲」の
 * 右側表示（size=20）など複数箇所で共有する。
 */
export function OptionIcons({ srcs, size = 20 }: { srcs: string[]; size?: number }) {
  if (srcs.length === 0) return null;
  return (
    <View style={styles.row}>
      {srcs.map((src) => (
        <Image
          key={src}
          source={{ uri: optionImageUri(src) }}
          style={{ width: size, height: size, borderRadius: size <= 20 ? 3 : 4 }}
          resizeMode="contain"
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 2 },
});
