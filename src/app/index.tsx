import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useState } from 'react';
import {
  FlatList,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import {
  DIFFICULTY_KEYS,
  DifficultyFilter,
  toCourses,
  type DifficultyKey,
} from '@/components/ui/DifficultyFilter';
import {
  ClassLabels,
  CourseColors,
  CourseLabels,
  CrownColors,
  CrownImages,
  GenreColorsDark,
} from '@/constants/taiko-colors';
import { Spacing } from '@/constants/theme';
import { buildRecordQuery } from '@/db';
import type { RecordFilter, RecordSort, RecordSortKey } from '@/db/records';
import { useTheme } from '@/hooks/use-theme';
import type { Class, Course, Crown, Genre } from '@/types';

/** buildRecordQuery が返す一覧行（computed cols 込み） */
interface RecordListRow {
  song_number: number;
  song_title: string | null;
  course: Course;
  crown: Crown;
  class: Class;
  score_total: number;
  good: number;
  ok: number;
  ng: number;
  star: number | null;
  tier: string | null;
  updated_at: number;
  total_notes: number;
  achievement: number; // 0.0 ~ 1.0
  /** 素点 = score_total - pound * 100 */
  base_score: number;
  /** カンマ区切りのジャンル ID 文字列 (GROUP_CONCAT) */
  genre_ids: string | null;
}

/** ソートキーの表示ラベル */
const SORT_LABELS: Record<RecordSortKey, string> = {
  updatedAt: '更新日時',
  score: 'スコア',
  baseScore: '素点',
  achievement: '達成率',
  totalNotes: '総ノーツ',
  ranking: 'ランク',
  star: '難易度☆',
  tier: 'Tier',
};

const SORT_KEYS: RecordSortKey[] = [
  'score',
  'baseScore',
  'achievement',
  'totalNotes',
  'ranking',
  'updatedAt',
  'star',
  'tier',
];

/** クリア王冠（記録画面では NO_PLAY は除く） */
const CROWN_OPTIONS: Crown[] = ['PLAYED', 'CLEAR', 'FULL_COMBO', 'DONDAFUL_COMBO'];
const CROWN_LABELS: Record<Crown, string> = {
  NO_PLAY: '未プレイ',
  PLAYED: 'プレイ済',
  CLEAR: 'クリア',
  FULL_COMBO: 'FC',
  DONDAFUL_COMBO: 'DC',
};

/** 極マーク（Class 全8種） */
const CLASS_OPTIONS: Class[] = [
  'NO_MARK',
  'IKI_WHITE',
  'IKI_BRONZE',
  'IKI_SILVER',
  'GOLD_MIYABI',
  'PINK_MIYABI',
  'PURPLE_MIYABI',
  'KIWAMI',
];

/** ジャンル色なし時のフォールバック（ダーク backgroundElement に相当） */
const GENRE_FALLBACK_COLOR = '#212225';

export default function RecordsScreen() {
  const db = useSQLiteContext();
  const theme = useTheme();
  const [rows, setRows] = useState<RecordListRow[]>([]);
  const [genres, setGenres] = useState<Pick<Genre, 'id' | 'title'>[]>([]);

  // ---- フィルタ状態 ----
  const [showFilter, setShowFilter] = useState(false);
  const [titleQuery, setTitleQuery] = useState('');
  const [selectedDifficulties, setSelectedDifficulties] =
    useState<DifficultyKey[]>(DIFFICULTY_KEYS);
  const [selectedGenreId, setSelectedGenreId] = useState<string | undefined>(undefined);
  const [selectedCrowns, setSelectedCrowns] = useState<Crown[]>([]);
  const [selectedClasses, setSelectedClasses] = useState<Class[]>([]);

  // ---- ソート状態 ----
  const [sortKey, setSortKey] = useState<RecordSortKey>('score');
  const [sortDesc, setSortDesc] = useState(true);

  const load = useCallback(async () => {
    const genreRows = await db.getAllAsync<{ id: string; title: string }>(
      'SELECT id, title FROM genres ORDER BY id',
    );
    setGenres(genreRows);

    const courses = toCourses(selectedDifficulties);
    const isAllCourses = courses.length >= 5;

    const filter: RecordFilter = {
      titleQuery: titleQuery.trim() || undefined,
      courses: isAllCourses ? undefined : courses,
      crowns: selectedCrowns.length > 0 ? selectedCrowns : undefined,
      classes: selectedClasses.length > 0 ? selectedClasses : undefined,
      genreId: selectedGenreId,
    };

    const sort: RecordSort = { key: sortKey, desc: sortDesc };
    const { sql, params } = buildRecordQuery(filter, sort);
    const result = await db.getAllAsync<RecordListRow>(sql, ...params);
    setRows(result);
  }, [
    db,
    titleQuery,
    selectedDifficulties,
    selectedGenreId,
    selectedCrowns,
    selectedClasses,
    sortKey,
    sortDesc,
  ]);

  // フォーカス時（他タブから戻った直後）にも最新データを取得する
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  // フィルタ/ソート変更時は即座に再クエリ
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [titleQuery, selectedDifficulties, selectedGenreId, selectedCrowns, selectedClasses, sortKey, sortDesc]);

  const toggleCrown = (c: Crown) =>
    setSelectedCrowns((prev) =>
      prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c],
    );

  const toggleClass = (cl: Class) =>
    setSelectedClasses((prev) =>
      prev.includes(cl) ? prev.filter((x) => x !== cl) : [...prev, cl],
    );

  const toggleSort = (key: RecordSortKey) => {
    if (sortKey === key) {
      setSortDesc((d) => !d);
    } else {
      setSortKey(key);
      setSortDesc(true);
    }
  };

  const hasFilter =
    titleQuery.trim() !== '' ||
    selectedDifficulties.length < DIFFICULTY_KEYS.length ||
    selectedGenreId !== undefined ||
    selectedCrowns.length > 0 ||
    selectedClasses.length > 0;

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView edges={['top']} style={styles.safe}>
        {/* ヘッダー */}
        <View style={styles.headerRow}>
          <View>
            <ThemedText type="subtitle">記録</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {rows.length} 件
            </ThemedText>
          </View>
          <Pressable
            style={[styles.filterToggle, hasFilter && styles.filterToggleActive]}
            onPress={() => setShowFilter((v) => !v)}
          >
            <ThemedText
              type="smallBold"
              style={hasFilter ? styles.filterToggleActiveText : undefined}
            >
              {showFilter ? 'フィルタ ▲' : `フィルタ${hasFilter ? ' ●' : ' ▼'}`}
            </ThemedText>
          </Pressable>
        </View>

        {/* フィルタパネル */}
        {showFilter && (
          <ThemedView type="backgroundElement" style={styles.filterPanel}>
            <ThemedText type="small" themeColor="textSecondary">曲名</ThemedText>
            <TextInput
              style={[styles.searchInput, { color: theme.text, borderColor: theme.textSecondary }]}
              placeholder="曲名で検索…"
              placeholderTextColor={theme.textSecondary}
              value={titleQuery}
              onChangeText={(t) => {
                setTitleQuery(t);
              }}
              onSubmitEditing={load}
              returnKeyType="search"
            />

            <ThemedText type="small" themeColor="textSecondary">難易度</ThemedText>
            <DifficultyFilter
              selected={selectedDifficulties}
              onChange={(v) => {
                setSelectedDifficulties(v);
              }}
            />

            {genres.length > 0 && (
              <>
                <ThemedText type="small" themeColor="textSecondary">ジャンル</ThemedText>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  <View style={styles.chipRow}>
                    <Chip
                      label="全て"
                      active={selectedGenreId === undefined}
                      onPress={() => setSelectedGenreId(undefined)}
                    />
                    {genres.map((g) => (
                      <Chip
                        key={g.id}
                        label={g.title}
                        active={selectedGenreId === g.id}
                        onPress={() =>
                          setSelectedGenreId(selectedGenreId === g.id ? undefined : g.id)
                        }
                      />
                    ))}
                  </View>
                </ScrollView>
              </>
            )}

            <ThemedText type="small" themeColor="textSecondary">クリア王冠</ThemedText>
            <View style={styles.chipRow}>
              {CROWN_OPTIONS.map((c) => (
                <Chip
                  key={c}
                  label={CROWN_LABELS[c]}
                  active={selectedCrowns.includes(c)}
                  color={CrownColors[c]}
                  onPress={() => toggleCrown(c)}
                />
              ))}
            </View>

            <ThemedText type="small" themeColor="textSecondary">極マーク</ThemedText>
            <View style={styles.chipRow}>
              {CLASS_OPTIONS.map((cl) => (
                <Chip
                  key={cl}
                  label={ClassLabels[cl]}
                  active={selectedClasses.includes(cl)}
                  onPress={() => toggleClass(cl)}
                />
              ))}
            </View>

            {hasFilter && (
              <Pressable
                style={styles.resetBtn}
                onPress={() => {
                  setTitleQuery('');
                  setSelectedDifficulties(DIFFICULTY_KEYS);
                  setSelectedGenreId(undefined);
                  setSelectedCrowns([]);
                  setSelectedClasses([]);
                }}
              >
                <ThemedText type="small" themeColor="textSecondary">
                  フィルタをリセット
                </ThemedText>
              </Pressable>
            )}
          </ThemedView>
        )}

        {/* ソートバー */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.sortBar}>
          <View style={styles.chipRow}>
            {SORT_KEYS.map((k) => (
              <SortChip
                key={k}
                label={SORT_LABELS[k]}
                active={sortKey === k}
                desc={sortKey === k ? sortDesc : undefined}
                onPress={() => toggleSort(k)}
              />
            ))}
          </View>
        </ScrollView>

        {/* 記録一覧 */}
        <FlatList
          data={rows}
          keyExtractor={(r) => `${r.song_number}-${r.course}`}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={
            <ThemedText type="small" themeColor="textSecondary" style={styles.empty}>
              {hasFilter
                ? 'フィルタに一致する記録がありません。'
                : 'まだ記録がありません。「取得」タブからデータを取得してください。'}
            </ThemedText>
          }
          renderItem={({ item }) => <Row row={item} />}
        />
      </SafeAreaView>
    </ThemedView>
  );
}

// ---------------------------------------------------------------------------
// Row
// ---------------------------------------------------------------------------

function Row({ row }: { row: RecordListRow }) {
  const achievePct = row.total_notes > 0 ? (row.achievement * 100).toFixed(2) : '—';

  // ジャンル背景色の計算
  const genreIds = row.genre_ids ? row.genre_ids.split(',').filter(Boolean) : [];
  const color1 = GenreColorsDark[genreIds[0]] ?? GENRE_FALLBACK_COLOR;
  const color2 = genreIds.length >= 2 ? (GenreColorsDark[genreIds[1]] ?? GENRE_FALLBACK_COLOR) : color1;
  const isDual = genreIds.length >= 2 && color1 !== color2;

  return (
    <View style={styles.row}>
      {/* ジャンル背景（対角線分割または単色） */}
      {isDual ? (
        <LinearGradient
          colors={[color1, color1, color2, color2]}
          locations={[0, 0.499, 0.501, 1]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
      ) : (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: color1 }]} />
      )}

      {/* 王冠アイコン */}
      {CrownImages[row.crown] ? (
        <Image
          source={CrownImages[row.crown]}
          style={styles.crownImage}
          resizeMode="contain"
        />
      ) : (
        <View style={[styles.crownDot, { backgroundColor: CrownColors[row.crown] }]} />
      )}

      {/* 難易度色バー */}
      <View style={[styles.coursebar, { backgroundColor: CourseColors[row.course] }]} />

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

      <View style={styles.rowRight}>
        <ThemedText type="smallBold">{row.score_total.toLocaleString()}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {achievePct !== '—' ? `${achievePct}%` : '—'}
          {row.total_notes > 0 ? ` / ${row.total_notes}` : ''}
        </ThemedText>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// 共通チップ
// ---------------------------------------------------------------------------

function Chip({
  label,
  active,
  color,
  onPress,
}: {
  label: string;
  active: boolean;
  color?: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.chip, active && (color ? { backgroundColor: color } : styles.chipActive)]}
    >
      <ThemedText type="small" style={active ? styles.chipActiveText : styles.chipInactiveText}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

function SortChip({
  label,
  active,
  desc,
  onPress,
}: {
  label: string;
  active: boolean;
  desc?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={[styles.chip, active && styles.chipActive]}>
      <ThemedText type="small" style={active ? styles.chipActiveText : styles.chipInactiveText}>
        {label}
        {active ? (desc ? ' ↓' : ' ↑') : ''}
      </ThemedText>
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// スタイル
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  container: { flex: 1 },
  safe: { flex: 1, paddingHorizontal: Spacing.three, gap: Spacing.one },

  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    paddingTop: Spacing.two,
  },
  filterToggle: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.two,
    backgroundColor: '#F0F0F3',
    marginBottom: 4,
  },
  filterToggleActive: { backgroundColor: '#e94560' },
  filterToggleActiveText: { color: '#fff' },

  filterPanel: {
    borderRadius: Spacing.two,
    padding: Spacing.three,
    gap: Spacing.two,
    marginBottom: Spacing.one,
  },
  searchInput: {
    borderWidth: 1,
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one,
    fontSize: 14,
  },

  sortBar: { flexGrow: 0, marginBottom: Spacing.one },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.one },
  chip: {
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one,
    borderRadius: 12,
    backgroundColor: '#F0F0F3',
  },
  chipActive: { backgroundColor: '#e94560' },
  chipActiveText: { color: '#fff' },
  chipInactiveText: { color: '#555' },

  resetBtn: {
    alignSelf: 'flex-end',
    paddingVertical: Spacing.one,
  },

  listContent: {
    gap: Spacing.one,
    paddingVertical: Spacing.two,
    paddingBottom: Spacing.six,
  },
  empty: { textAlign: 'center', marginTop: Spacing.five },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.two,
    overflow: 'hidden',
  },
  crownImage: { width: 28, height: 28, flexShrink: 0 },
  crownDot: { width: 10, height: 10, borderRadius: 5, flexShrink: 0 },
  coursebar: { width: 4, height: 32, borderRadius: 2, flexShrink: 0 },
  rowMain: { flex: 1, gap: 2 },
  rowRight: { alignItems: 'flex-end', gap: 2, flexShrink: 0 },
});
