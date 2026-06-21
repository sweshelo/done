import { Modal, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';

interface Props {
  visible: boolean;
  onClose: () => void;
}

/**
 * Expo Go 用の全画面広告プレースホルダ（純 RN・ネイティブ非依存）。
 * 実広告（OS 描画のインタースティシャル）の代わりに、出現タイミングと
 * 「閉じる」操作の挙動を Expo Go 上で確認するためのもの。
 */
export function MockInterstitial({ visible, onClose }: Props) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <ThemedView type="backgroundElement" style={styles.card}>
          <ThemedText type="subtitle">全画面広告（モック）</ThemedText>
          <ThemedText type="small" themeColor="textSecondary" style={styles.note}>
            Expo Go ではモック表示です。実機 / dev client では実際のテスト広告が表示されます。
          </ThemedText>
          <Pressable style={styles.closeBtn} onPress={onClose}>
            <ThemedText type="smallBold" style={styles.closeText}>
              閉じる
            </ThemedText>
          </Pressable>
        </ThemedView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.four,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  card: {
    width: '100%',
    alignItems: 'center',
    gap: Spacing.three,
    padding: Spacing.four,
    borderRadius: Spacing.three,
  },
  note: { textAlign: 'center' },
  closeBtn: {
    backgroundColor: '#e94560',
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.two,
  },
  closeText: { color: '#fff' },
});
