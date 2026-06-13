import { useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useState } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { CourseLabels, CrownColors } from '@/constants/taiko-colors';
import { buildRecordQuery } from '@/db';
import type { Class, Course, Crown } from '@/types';

/** buildRecordQuery が返す一覧行 */
interface RecordListRow {
  song_number: number;
  song_title: string | null;
  course: Course;
  crown: Crown;
  class: Class;
  score_total: number;
  star: number | null;
  tier: string | null;
  updated_at: number;
}

export default function RecordsScreen() {
  const db = useSQLiteContext();
  const [rows, setRows] = useState<RecordListRow[]>([]);

  const load = useCallback(async () => {
    // 既定: 各譜面の最新記録を更新日時降順（フィルタ/ソート UI は次フェーズ）
    const { sql, params } = buildRecordQuery({}, { key: 'updatedAt', desc: true });
    const result = await db.getAllAsync<RecordListRow>(sql, ...params);
    setRows(result);
  }, [db]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView edges={['top']} style={styles.safe}>
        <ThemedText type="subtitle">記録</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {rows.length} 件（各譜面の最新記録）
        </ThemedText>

        <FlatList
          data={rows}
          keyExtractor={(r) => `${r.song_number}-${r.course}`}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={
            <ThemedText type="small" themeColor="textSecondary" style={styles.empty}>
              まだ記録がありません。「取得」タブからデータを取得してください。
            </ThemedText>
          }
          renderItem={({ item }) => <Row row={item} />}
        />
      </SafeAreaView>
    </ThemedView>
  );
}

function Row({ row }: { row: RecordListRow }) {
  return (
    <ThemedView type="backgroundElement" style={styles.row}>
      <View style={[styles.crownDot, { backgroundColor: CrownColors[row.crown] }]} />
      <View style={styles.rowMain}>
        <ThemedText type="smallBold" numberOfLines={1}>
          {row.song_title ?? `#${row.song_number}`}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {CourseLabels[row.course]}
          {row.star != null ? ` ★${row.star}` : ''}
          {row.tier ? ` / ${row.tier}` : ''}
        </ThemedText>
      </View>
      <ThemedText type="smallBold">{row.score_total.toLocaleString()}</ThemedText>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safe: { flex: 1, paddingHorizontal: Spacing.three, gap: Spacing.one },
  listContent: { gap: Spacing.one, paddingVertical: Spacing.two, paddingBottom: Spacing.six },
  empty: { textAlign: 'center', marginTop: Spacing.five },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.two,
  },
  crownDot: { width: 12, height: 12, borderRadius: 6 },
  rowMain: { flex: 1, gap: 2 },
});
