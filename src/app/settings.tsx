import { useSQLiteContext } from 'expo-sqlite';
import { useState } from 'react';
import { Alert, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { runMigrations } from '@/db';

export default function SettingsScreen() {
  const db = useSQLiteContext();
  const [message, setMessage] = useState<string | null>(null);

  const resetDb = () => {
    Alert.alert(
      'DBを初期化',
      'ローカルに保存された全ての記録・楽曲データが削除されます。この操作は取り消せません。',
      [
        { text: 'キャンセル', style: 'cancel' },
        {
          text: '削除する',
          style: 'destructive',
          onPress: async () => {
            try {
              // user_version を 0 にリセットしてから migration を再実行（DROP→CREATE）
              await db.execAsync('PRAGMA user_version = 0;');
              await runMigrations(db);
              setMessage('DBを初期化しました。');
            } catch (e) {
              setMessage(`エラー: ${String(e)}`);
            }
          },
        },
      ],
    );
  };

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView edges={['top']} style={styles.safe}>
        <ThemedText type="subtitle">設定</ThemedText>

        {/* デバッグセクション */}
        <ThemedView type="backgroundElement" style={styles.section}>
          <ThemedText type="smallBold">デバッグ</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            ローカル DB を削除して初期状態に戻します。
          </ThemedText>
          <Pressable style={styles.dangerBtn} onPress={resetDb}>
            <ThemedText type="smallBold" style={styles.dangerText}>
              DB を初期化（全データ削除）
            </ThemedText>
          </Pressable>
          {message && (
            <ThemedText type="small" themeColor="textSecondary">
              {message}
            </ThemedText>
          )}
        </ThemedView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safe: { flex: 1, paddingHorizontal: Spacing.three, gap: Spacing.two, paddingTop: Spacing.two },
  section: {
    borderRadius: Spacing.two,
    padding: Spacing.three,
    gap: Spacing.two,
  },
  dangerBtn: {
    alignSelf: 'flex-start',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.two,
    backgroundColor: '#c0392b',
  },
  dangerText: { color: '#fff' },
});
