import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect } from 'expo-router';
import * as ScreenOrientation from 'expo-screen-orientation';
import { useSQLiteContext } from 'expo-sqlite';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
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

import { ADS_AVAILABLE, ADS_MOCK } from '@/ads/available';
import { LIST_AD_INTERVAL } from '@/ads/config';
import { useInterstitialGate } from '@/ads/useInterstitialGate';
import { AdRow } from '@/components/ads/AdRow';
import { RecordDetailModal } from '@/components/RecordDetailModal';
import { TierExportModal } from '@/components/TierExportModal';
import { TodayDiffModal, startOfToday } from '@/components/TodayDiffModal';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import {
  DIFFICULTY_KEYS,
  DifficultyFilter,
  toLevels,
  type DifficultyKey,
} from '@/components/ui/DifficultyFilter';
import {
  ClassImages,
  ClassLabels,
  LevelColors,
  LevelLabels,
  CrownColors,
  CrownImages,
  resolveGenreColors,
} from '@/constants/taiko-colors';
import { Spacing } from '@/constants/theme';
import { buildRecordQuery, listPlayers } from '@/db';
import type { RecordFilter, RecordSort, RecordSortKey } from '@/db/records';
import { useTheme } from '@/hooks/use-theme';
import { SELF_TAIKO_NO, type Class, type Level, type Crown, type Genre, type Player } from '@/types';

/** buildRecordQuery が返す一覧行（computed cols 込み） */
interface RecordListRow {
  song_number: number;
  song_title: string | null;
  level: Level;
  crown: Crown;
  class: Class;
  // 王冠のみ行（ライバルのスコア欠落）では score 系列が NULL になりうる
  score_total: number | null;
  good: number | null;
  ok: number | null;
  ng: number | null;
  pound: number | null;
  star: number | null;
  tier: string | null;
  updated_at: number;
  total_notes: number | null;
  achievement: number | null; // 0.0 ~ 1.0
  /** 素点 = score_total - pound * 100 */
  base_score: number | null;
  /** カンマ区切りのジャンル ID 文字列 (GROUP_CONCAT) */
  genre_ids: string | null;
  /** 「自分と近い順」ソート時のみ付与される、自分の同譜面スコア */
  self_score?: number | null;
}

/** ソートキーの表示ラベル */
const SORT_LABELS: Record<RecordSortKey, string> = {
  updatedAt: '更新日時',
  score: 'スコア',
  baseScore: '素点',
  achievement: '達成率',
  totalNotes: '総ノーツ',
  // ranking: '全国ランキング',
  star: '☆の数',
  tier: '全良難易度',
  closeToSelf: '自分と近い順',
};

const SORT_KEYS: RecordSortKey[] = [
  'score',
  'baseScore',
  'achievement',
  'totalNotes',
  // 'ranking',
  'updatedAt',
  'star',
  'tier',
  'closeToSelf',
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

/** FlatList の項目。広告 Row はマーカーオブジェクトで表現する。 */
type ListItem = RecordListRow | { __ad: true; id: string };

export default function RecordsScreen() {
  const db = useSQLiteContext();
  const theme = useTheme();
  const [rows, setRows] = useState<RecordListRow[]>([]);
  const [genres, setGenres] = useState<Pick<Genre, 'id' | 'title'>[]>([]);

  // ---- 閲覧プレイヤー（自分 / ライバル） ----
  const [players, setPlayers] = useState<Player[]>([]);
  const [selectedTaikoNo, setSelectedTaikoNo] = useState<string>(SELF_TAIKO_NO);

  // ---- フィルタ状態 ----
  const [showFilter, setShowFilter] = useState(false);
  const [titleQuery, setTitleQuery] = useState('');
  const [selectedDifficulties, setSelectedDifficulties] =
    useState<DifficultyKey[]>(['ONI']);
  const [selectedGenreId, setSelectedGenreId] = useState<string | undefined>(undefined);
  const [selectedCrowns, setSelectedCrowns] = useState<Crown[]>([]);
  const [selectedClasses, setSelectedClasses] = useState<Class[]>([]);

  // ---- ソート状態 ----
  const [sortKey, setSortKey] = useState<RecordSortKey>('score');
  const [sortDesc, setSortDesc] = useState(true);

  // ---- 詳細モーダル ----
  const [selectedRecord, setSelectedRecord] = useState<{ song_number: number; level: Level } | null>(null);

  // ---- ★10 tier 表出力 ----
  const [showTierExport, setShowTierExport] = useState(false);

  // ---- 今日の差分出力 ----
  const [showTodayDiff, setShowTodayDiff] = useState(false);

  // ---- 全画面広告（今日の差分 / ★10表 を閉じた区切りで表示） ----
  // overlay はモック時のみ非 null（ツリーに描画する）。実広告は OS 描画なので null。
  const { maybeShow: maybeShowInterstitial, overlay: interstitialOverlay } = useInterstitialGate();

  const closeTodayDiff = () => {
    setShowTodayDiff(false);
    maybeShowInterstitial();
  };

  const closeTierExport = async () => {
    setShowTierExport(false);
    // ★10表は横画面ロック中。portrait に戻してから全画面広告を出す（横向き表示を防ぐ）。
    await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
    maybeShowInterstitial();
  };

  // 記録一覧に LIST_AD_INTERVAL 行ごとに広告 Row を差し込む（末尾には付けない）。
  // Expo Go など広告非対応環境ではマーカーを挿入しない。
  const listData = useMemo<ListItem[]>(() => {
    if (!ADS_AVAILABLE && !ADS_MOCK) return rows;
    const out: ListItem[] = [];
    rows.forEach((r, i) => {
      out.push(r);
      if ((i + 1) % LIST_AD_INTERVAL === 0 && i < rows.length - 1) {
        out.push({ __ad: true, id: `ad-${i}` });
      }
    });
    return out;
  }, [rows]);

  const load = useCallback(async () => {
    const genreRows = await db.getAllAsync<{ id: string; title: string }>(
      'SELECT id, title FROM genres ORDER BY id',
    );
    setGenres(genreRows);

    const levels = toLevels(selectedDifficulties);
    const isAllLevels = levels.length >= 5;

    const filter: RecordFilter = {
      taikoNo: selectedTaikoNo,
      titleQuery: titleQuery.trim() || undefined,
      levels: isAllLevels ? undefined : levels,
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
    selectedTaikoNo,
    titleQuery,
    selectedDifficulties,
    selectedGenreId,
    selectedCrowns,
    selectedClasses,
    sortKey,
    sortDesc,
  ]);

  // プレイヤー名簿の読み込み（取得タブでライバル追加された直後も反映）
  const loadPlayers = useCallback(async () => {
    const list = await listPlayers(db);
    setPlayers(list);
    // 選択中プレイヤーが削除されていたら自分に戻す
    setSelectedTaikoNo((cur) =>
      list.some((p) => p.taikoNo === cur) ? cur : SELF_TAIKO_NO,
    );
  }, [db]);

  // フォーカス時（他タブから戻った直後）にも最新データ・名簿を取得する
  useFocusEffect(
    useCallback(() => {
      load();
      loadPlayers();
    }, [load, loadPlayers]),
  );

  // フィルタ/ソート変更時は即座に再クエリ
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTaikoNo, titleQuery, selectedDifficulties, selectedGenreId, selectedCrowns, selectedClasses, sortKey, sortDesc]);

  const toggleCrown = (c: Crown) =>
    setSelectedCrowns((prev) =>
      prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c],
    );

  const toggleClass = (cl: Class) =>
    setSelectedClasses((prev) =>
      prev.includes(cl) ? prev.filter((x) => x !== cl) : [...prev, cl],
    );

  // プレイヤー切替。自分に戻したとき「自分と近い順」は無効なのでスコア順へ戻す。
  const selectPlayer = (taiko: string) => {
    setSelectedTaikoNo(taiko);
    if (taiko === SELF_TAIKO_NO && sortKey === 'closeToSelf') {
      setSortKey('score');
      setSortDesc(true);
    }
  };

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
            style={[styles.filterToggle, { backgroundColor: theme.backgroundSelected }]}
            onPress={() => setShowTodayDiff(true)}
          >
            <ThemedText type="smallBold">今日の差分</ThemedText>
          </Pressable>
          <Pressable
            style={[styles.filterToggle, { backgroundColor: theme.backgroundSelected }]}
            onPress={() => setShowTierExport(true)}
          >
            <ThemedText type="smallBold">★10表</ThemedText>
          </Pressable>
          <Pressable
            style={[styles.filterToggle, { backgroundColor: theme.backgroundSelected }, hasFilter && styles.filterToggleActive]}
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

        {/* プレイヤー切替（ライバル登録時のみ表示） */}
        {players.length > 1 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.sortBar}>
            <View style={styles.chipRow}>
              {players.map((p) => (
                <Chip
                  key={p.taikoNo || 'self'}
                  label={p.name}
                  active={selectedTaikoNo === p.taikoNo}
                  onPress={() => selectPlayer(p.taikoNo)}
                />
              ))}
            </View>
          </ScrollView>
        )}

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
            {SORT_KEYS.filter(
              (k) => k !== 'closeToSelf' || selectedTaikoNo !== SELF_TAIKO_NO,
            ).map((k) => (
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
          data={listData}
          keyExtractor={(item) =>
            '__ad' in item ? item.id : `${item.song_number}-${item.level}`
          }
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={
            <ThemedText type="small" themeColor="textSecondary" style={styles.empty}>
              {hasFilter
                ? 'フィルタに一致する記録がありません。'
                : 'まだ記録がありません。「取得」タブからデータを取得してください。'}
            </ThemedText>
          }
          renderItem={({ item }) =>
            '__ad' in item ? (
              <AdRow />
            ) : (
              <Row
                row={item}
                sortKey={sortKey}
                onPress={() => setSelectedRecord({ song_number: item.song_number, level: item.level })}
              />
            )
          }
        />
      </SafeAreaView>

      {selectedRecord && (
        <RecordDetailModal
          songNumber={selectedRecord.song_number}
          level={selectedRecord.level}
          taikoNo={selectedTaikoNo}
          onClose={() => setSelectedRecord(null)}
        />
      )}
      {showTierExport && (
        <TierExportModal taikoNo={selectedTaikoNo} onClose={closeTierExport} />
      )}
      {showTodayDiff && (
        <TodayDiffModal sinceMs={startOfToday()} onClose={closeTodayDiff} />
      )}
      {/* モック全画面広告（Expo Go のみ非 null） */}
      {interstitialOverlay}
    </ThemedView>
  );
}

// ---------------------------------------------------------------------------
// Row
// ---------------------------------------------------------------------------

function Row({
  row,
  sortKey,
  onPress,
}: {
  row: RecordListRow;
  sortKey: RecordSortKey;
  onPress: () => void;
}) {
  const achievePct =
    row.total_notes != null && row.total_notes > 0
      ? ((row.achievement ?? 0) * 100).toFixed(2)
      : '—';
  const fmt = (n: number | null) => (n != null ? n.toLocaleString() : '—');

  // ジャンル背景色の計算
  const { color1, color2, isDual } = resolveGenreColors(row.genre_ids);

  // ソートキーに応じた rowRight 内容
  let rowRightTop: React.ReactNode;
  let rowRightBottom: React.ReactNode;
  switch (sortKey) {
    case 'score':
      rowRightTop = <ThemedText type="smallBold">{fmt(row.score_total)}</ThemedText>;
      rowRightBottom = (
        <View style={styles.rowRightBottomRow}>
          <ThemedText type="small" themeColor="textSecondary">
            {achievePct !== '—' ? `${achievePct}%` : '—'}
          </ThemedText>
          {ClassImages[row.class] && (
            <Image source={ClassImages[row.class]} style={styles.classIcon} resizeMode="contain" />
          )}
        </View>
      );
      break;
    case 'closeToSelf': {
      // 自分とのスコア差分を主表示にする（自分の記録が無い譜面は差分なし）
      const diff =
        row.score_total != null && row.self_score != null ? row.score_total - row.self_score : null;
      rowRightTop = (
        <ThemedText type="smallBold">
          {diff != null ? `${diff >= 0 ? '+' : ''}${diff.toLocaleString()}` : '—'}
        </ThemedText>
      );
      rowRightBottom = (
        <ThemedText type="small" themeColor="textSecondary">
          {fmt(row.score_total)}
        </ThemedText>
      );
      break;
    }
    case 'baseScore':
      rowRightTop = <ThemedText type="smallBold">{fmt(row.base_score)}</ThemedText>;
      rowRightBottom = (
        <ThemedText type="small" themeColor="textSecondary">
          {row.score_total != null && row.base_score != null
            ? `(+ ${(row.score_total - row.base_score).toLocaleString()})`
            : '—'}
        </ThemedText>
      );
      break;
    case 'achievement':
      rowRightTop = (
        <ThemedText type="smallBold">{achievePct !== '—' ? `${achievePct}%` : '—'}</ThemedText>
      );
      rowRightBottom = (
        <ThemedText type="small" themeColor="textSecondary">
          {row.total_notes != null && row.total_notes > 0 ? `${row.good} / ${row.total_notes}` : '—'}
        </ThemedText>
      );
      break;
    case 'updatedAt':
      rowRightTop = (
        <ThemedText type="smallBold">
          {row.updated_at === 0
            ? '初期化'
            : new Date(row.updated_at).toLocaleDateString('ja-JP')}
        </ThemedText>
      );
      rowRightBottom = (
        <ThemedText type="small" themeColor="textSecondary">
          {fmt(row.score_total)}
        </ThemedText>
      );
      break;
    default:
      rowRightTop = <ThemedText type="smallBold">{fmt(row.score_total)}</ThemedText>;
      rowRightBottom = (
        <ThemedText type="small" themeColor="textSecondary">
          {achievePct !== '—' ? `${achievePct}%` : '—'}
          {row.total_notes != null && row.total_notes > 0 ? ` / ${row.total_notes}` : ''}
        </ThemedText>
      );
      break;
  }

  return (
    <Pressable onPress={onPress}>
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
        <View style={[styles.coursebar, { backgroundColor: LevelColors[row.level] }]} />

        <View style={styles.rowMain}>
          <ThemedText type="smallBold" numberOfLines={1}>
            {row.song_title ?? `#${row.song_number}`}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {LevelLabels[row.level]}
            {row.star != null ? ` ★${row.star}` : ''}
            {row.tier ? ` / ${row.tier}` : ''}
          </ThemedText>
        </View>

        <View style={styles.rowRight}>
          {rowRightTop}
          {rowRightBottom}
        </View>
      </View>
    </Pressable>
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
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.chip,
        { backgroundColor: theme.backgroundSelected },
        active && (color ? { backgroundColor: color } : styles.chipActive),
      ]}
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
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={[styles.chip, { backgroundColor: theme.backgroundSelected }, active && styles.chipActive]}
    >
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
  crownImage: { width: 36, height: 36, flexShrink: 0, marginHorizontal: -Spacing.two },
  crownDot: { width: 10, height: 10, borderRadius: 5, flexShrink: 0 },
  coursebar: { width: 4, height: 32, borderRadius: 2, flexShrink: 0 },
  rowMain: { flex: 1, gap: 2 },
  rowRight: { alignItems: 'flex-end', gap: 2, flexShrink: 0 },
  rowRightBottomRow: { flexDirection: 'row', alignItems: 'center', gap: 0 },
  classIcon: { width: 24, height: 24 },
});
