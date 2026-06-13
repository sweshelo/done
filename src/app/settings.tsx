import { useSQLiteContext } from 'expo-sqlite';
import { useState } from 'react';
import { Alert, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { runMigrations, saveStarCounts } from '@/db';
import { fetchAllSongStars } from '@/scrape/taiko-wiki';

export default function SettingsScreen() {
  const db = useSQLiteContext();
  const [message, setMessage] = useState<string | null>(null);
  const [starMessage, setStarMessage] = useState<string | null>(null);
  const [starLoading, setStarLoading] = useState(false);

  const updateStars = async () => {
    setStarLoading(true);
    setStarMessage('楽曲リストを確認中…');
    try {
      const rows = await db.getAllAsync<{ number: number }>('SELECT number FROM songs');
      if (rows.length === 0) {
        setStarMessage('楽曲データが未取得です。先にデータ取得を実行してください。');
        return;
      }
      const songNumbers = rows.map((r) => r.number);
      setStarMessage(`0 / ${songNumbers.length} 取得中…`);
      const stars = await fetchAllSongStars(songNumbers, 5, (done, total) => {
        setStarMessage(`${done} / ${total} 取得中…`);
      });
      const updated = await saveStarCounts(db, stars);
      setStarMessage(`完了 — ${stars.length} 曲取得 / ${updated} 件更新`);
    } catch (e) {
      setStarMessage(`エラー: ${String(e)}`);
    } finally {
      setStarLoading(false);
    }
  };

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

        {/* ★数更新セクション */}
        <ThemedView type="backgroundElement" style={styles.section}>
          <ThemedText type="smallBold">楽曲★数を更新</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            taiko.wiki から難易度★数を取得してローカル DB に保存します。
          </ThemedText>
          <Pressable
            style={[styles.btn, starLoading && styles.btnDisabled]}
            onPress={updateStars}
            disabled={starLoading}>
            <ThemedText type="smallBold">更新する</ThemedText>
          </Pressable>
          {starMessage && (
            <ThemedText type="small" themeColor="textSecondary">
              {starMessage}
            </ThemedText>
          )}
        </ThemedView>

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
  btn: {
    alignSelf: 'flex-start',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.two,
    backgroundColor: '#F0F0F3',
  },
  btnDisabled: { opacity: 0.4 },
  dangerBtn: {
    alignSelf: 'flex-start',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.two,
    backgroundColor: '#c0392b',
  },
  dangerText: { color: '#fff' },
});
