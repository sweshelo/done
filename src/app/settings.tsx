import * as DocumentPicker from 'expo-document-picker';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import {
  ALMOST_MODE_KEY,
  ALMOST_VALUE_KEY,
  exportDatabase,
  getAlmostConfig,
  importDatabase,
  runMigrations,
  saveStarCounts,
  saveTierData,
  setMeta,
} from '@/db';
import type { AlmostMode } from '@/db/meta';
import { useTheme } from '@/hooks/use-theme';
import { fetchAllSongStars, fetchTierChart } from '@/scrape/taiko-wiki';

export default function SettingsScreen() {
  const db = useSQLiteContext();
  const theme = useTheme();
  const [message, setMessage] = useState<string | null>(null);
  const [starMessage, setStarMessage] = useState<string | null>(null);
  const [starLoading, setStarLoading] = useState(false);
  const [tierMessage, setTierMessage] = useState<string | null>(null);
  const [tierLoading, setTierLoading] = useState(false);
  const [backupMessage, setBackupMessage] = useState<string | null>(null);
  const [exportLoading, setExportLoading] = useState(false);
  const [restoreLoading, setRestoreLoading] = useState(false);

  // 「もうすぐFC/DC」スマートフォルダの判定閾値
  const [almostMode, setAlmostMode] = useState<AlmostMode>('absolute');
  const [almostValue, setAlmostValue] = useState('3');
  const [almostMessage, setAlmostMessage] = useState<string | null>(null);

  useEffect(() => {
    getAlmostConfig(db).then((cfg) => {
      setAlmostMode(cfg.mode);
      setAlmostValue(String(cfg.value));
    });
  }, [db]);

  const saveAlmost = async () => {
    const num = Number(almostValue);
    if (!Number.isFinite(num) || num <= 0) {
      setAlmostMessage('1以上の数値を入力してください。');
      return;
    }
    await setMeta(db, ALMOST_MODE_KEY, almostMode);
    await setMeta(db, ALMOST_VALUE_KEY, String(num));
    setAlmostMessage('保存しました。');
  };

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

  const updateTiers = async () => {
    setTierLoading(true);
    setTierMessage('取得中…');
    try {
      const tiers = await fetchTierChart(10);
      const updated = await saveTierData(db, tiers);
      setTierMessage(`完了 — ${tiers.length} 件取得 / ${updated} 件更新`);
    } catch (e) {
      setTierMessage(`エラー: ${String(e)}`);
    } finally {
      setTierLoading(false);
    }
  };

  const exportDb = async () => {
    setExportLoading(true);
    setBackupMessage(null);
    try {
      await exportDatabase(db);
      setBackupMessage('バックアップファイルを書き出しました。');
    } catch (e) {
      setBackupMessage(`エラー: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setExportLoading(false);
    }
  };

  const importDb = async () => {
    setBackupMessage(null);
    let uri: string;
    try {
      const res = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true });
      if (res.canceled) return;
      uri = res.assets[0].uri;
    } catch (e) {
      setBackupMessage(`エラー: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    Alert.alert(
      'バックアップから復元',
      '現在のローカルデータはすべて、選択したバックアップの内容で置き換えられます。この操作は取り消せません。',
      [
        { text: 'キャンセル', style: 'cancel' },
        {
          text: '復元する',
          style: 'destructive',
          onPress: async () => {
            setRestoreLoading(true);
            try {
              await importDatabase(db, uri);
              setBackupMessage('復元が完了しました。記録タブを開くと反映されます。');
            } catch (e) {
              setBackupMessage(`エラー: ${e instanceof Error ? e.message : String(e)}`);
            } finally {
              setRestoreLoading(false);
            }
          },
        },
      ],
    );
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
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}>
          <ThemedText type="subtitle">設定</ThemedText>

        {/* ★数更新セクション */}
        <ThemedView type="backgroundElement" style={styles.section}>
          <ThemedText type="smallBold">楽曲★数を更新</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            taiko.wiki から難易度★数を取得してローカル DB に保存します。
          </ThemedText>
          <Pressable
            style={[styles.btn, { backgroundColor: theme.backgroundSelected }, starLoading && styles.btnDisabled]}
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

        {/* tier 更新セクション */}
        <ThemedView type="backgroundElement" style={styles.section}>
          <ThemedText type="smallBold">全良難易度表を更新</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            taiko.wiki の全良難易度表を取得して保存します。
          </ThemedText>
          <Pressable
            style={[styles.btn, { backgroundColor: theme.backgroundSelected }, tierLoading && styles.btnDisabled]}
            onPress={updateTiers}
            disabled={tierLoading}>
            <ThemedText type="smallBold">更新する</ThemedText>
          </Pressable>
          {tierMessage && (
            <ThemedText type="small" themeColor="textSecondary">
              {tierMessage}
            </ThemedText>
          )}
        </ThemedView>

        {/* もうすぐFC/DC 閾値セクション */}
        <ThemedView type="backgroundElement" style={styles.section}>
          <ThemedText type="smallBold">もうすぐFC / DC の判定</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            フォルダタブの「もうすぐフルコンボ」「もうすぐドンだフルコンボ」に表示する条件です。
            FCは不可(ng)、DCは可(ok)の残り数がこの閾値以下の曲を集めます。
          </ThemedText>
          <View style={styles.almostRow}>
            <Pressable
              style={[
                styles.modeBtn,
                { backgroundColor: theme.backgroundSelected },
                almostMode === 'absolute' && styles.modeBtnActive,
              ]}
              onPress={() => setAlmostMode('absolute')}>
              <ThemedText type="small" style={almostMode === 'absolute' ? styles.modeBtnActiveText : undefined}>
                個数
              </ThemedText>
            </Pressable>
            <Pressable
              style={[
                styles.modeBtn,
                { backgroundColor: theme.backgroundSelected },
                almostMode === 'percent' && styles.modeBtnActive,
              ]}
              onPress={() => setAlmostMode('percent')}>
              <ThemedText type="small" style={almostMode === 'percent' ? styles.modeBtnActiveText : undefined}>
                ％
              </ThemedText>
            </Pressable>
            <TextInput
              style={[styles.almostInput, { color: theme.text, borderColor: theme.textSecondary }]}
              keyboardType="numeric"
              value={almostValue}
              onChangeText={setAlmostValue}
              returnKeyType="done"
            />
            <ThemedText type="small" themeColor="textSecondary">
              {almostMode === 'percent' ? '% 以下' : '個以下'}
            </ThemedText>
          </View>
          <Pressable
            style={[styles.btn, { backgroundColor: theme.backgroundSelected }]}
            onPress={saveAlmost}>
            <ThemedText type="smallBold">保存する</ThemedText>
          </Pressable>
          {almostMessage && (
            <ThemedText type="small" themeColor="textSecondary">
              {almostMessage}
            </ThemedText>
          )}
        </ThemedView>

        {/* バックアップ / 復元セクション */}
        <ThemedView type="backgroundElement" style={styles.section}>
          <ThemedText type="smallBold">バックアップ / 復元</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            ローカル DB 全体をファイルに書き出し、別端末や再インストール後に取り込めます。
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            復元時は現在のデータが置き換わります。バックアップは同じアプリバージョンで取得したものを使用してください。
          </ThemedText>
          <Pressable
            style={[styles.btn, { backgroundColor: theme.backgroundSelected }, exportLoading && styles.btnDisabled]}
            onPress={exportDb}
            disabled={exportLoading || restoreLoading}>
            <ThemedText type="smallBold">{exportLoading ? '書き出し中…' : 'バックアップを書き出す'}</ThemedText>
          </Pressable>
          <Pressable
            style={[styles.btn, { backgroundColor: theme.backgroundSelected }, restoreLoading && styles.btnDisabled]}
            onPress={importDb}
            disabled={exportLoading || restoreLoading}>
            <ThemedText type="smallBold">{restoreLoading ? '復元中…' : 'バックアップから復元'}</ThemedText>
          </Pressable>
          {backupMessage && (
            <ThemedText type="small" themeColor="textSecondary">
              {backupMessage}
            </ThemedText>
          )}
        </ThemedView>

        {/* デバッグセクション */}
        <ThemedView type="backgroundElement" style={styles.section}>
          <ThemedText type="smallBold">デバッグ</ThemedText>
          <Pressable
            style={styles.dangerBtn}
            onPress={() =>
              Alert.alert('全良難易度表を削除', 'charts テーブルの tier / tier_rank を全て NULL にします。', [
                { text: 'キャンセル', style: 'cancel' },
                {
                  text: '削除する',
                  style: 'destructive',
                  onPress: async () => {
                    try {
                      await db.runAsync('UPDATE charts SET tier = NULL, tier_rank = NULL');
                      setMessage('tier データを削除しました。');
                    } catch (e) {
                      setMessage(`エラー: ${String(e)}`);
                    }
                  },
                },
              ])
            }>
            <ThemedText type="smallBold" style={styles.dangerText}>
              tier データを削除
            </ThemedText>
          </Pressable>
          <Pressable
            style={styles.dangerBtn}
            onPress={() =>
              Alert.alert('★データを削除', 'charts テーブルの star を全て NULL にします。', [
                { text: 'キャンセル', style: 'cancel' },
                {
                  text: '削除する',
                  style: 'destructive',
                  onPress: async () => {
                    try {
                      await db.runAsync('UPDATE charts SET star = NULL');
                      setMessage('★データを削除しました。');
                    } catch (e) {
                      setMessage(`エラー: ${String(e)}`);
                    }
                  },
                },
              ])
            }>
            <ThemedText type="smallBold" style={styles.dangerText}>
              ★データを削除
            </ThemedText>
          </Pressable>
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
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safe: { flex: 1 },
  scrollContent: {
    paddingHorizontal: Spacing.three,
    gap: Spacing.two,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.six,
  },
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
  almostRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  modeBtn: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.two,
  },
  modeBtnActive: { backgroundColor: '#e94560' },
  modeBtnActiveText: { color: '#fff' },
  almostInput: {
    borderWidth: 1,
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one,
    fontSize: 15,
    width: 64,
    textAlign: 'center',
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
