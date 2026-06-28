import { useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useState, type ReactNode } from 'react';
import {
  Alert,
  FlatList,
  Image,
  Modal,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AddSongsModal } from '@/components/folders/AddSongsModal';
import { FavoriteSyncModal } from '@/components/folders/FavoriteSyncModal';
import { GradientFill } from '@/components/GradientFill';
import { OptionIcons } from '@/components/OptionIcons';
import { RecordDetailModal } from '@/components/RecordDetailModal';
import { RecordRow, RecordRowStat } from '@/components/RecordRow';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import {
  EMPTY_SONG_SEARCH,
  SongSearchBar,
  type SongSearchState,
} from '@/components/ui/SongSearchBar';
import {
  ClassImages,
  CrownImages,
  crownGradient,
  dualCrownGradient,
  GenreColors,
  LevelImages,
} from '@/constants/taiko-colors';
import { Spacing } from '@/constants/theme';
import {
  createFolder,
  deleteFolder,
  getFolderSongDetails,
  getFolderSongNumbers,
  getSmartFolderRecords,
  listManualFolders,
  parseOptionList,
  renameFolder,
} from '@/db';
import type { FolderRef, FolderSongDetail, ManualFolderRow } from '@/db/folders';
import type { RecordListRow } from '@/db/records';
import { useTheme } from '@/hooks/use-theme';
import { SELF_TAIKO_NO, type Level } from '@/types';

const GENRE_FALLBACK_COLOR = '#212225';
const STAR_FOLDER_COLOR = '#ec73c6';
const ALMOST_FC_NAME = 'もうすぐフルコンボ';
const ALMOST_DC_NAME = 'もうすぐドンだフルコンボ';
const MISMATCH_FC_NAME = '王冠とスコアが異なる曲（フルコンボ）';
const MISMATCH_DC_NAME = '王冠とスコアが異なる曲（ドンダフルコンボ）';
const OPTIONS_NAME = '自己ベストで演奏オプションを使用した曲';
const OPTIONS_FOLDER_COLOR = '#6f7bd6';
/** ドンだーひろばのお気に入りの曲の上限（song_no_1 .. song_no_30）。 */
const FAVORITE_LIMIT = 30;

export default function FoldersScreen() {
  const db = useSQLiteContext();
  const theme = useTheme();

  const [genres, setGenres] = useState<{ id: string; title: string }[]>([]);
  const [manualFolders, setManualFolders] = useState<ManualFolderRow[]>([]);
  const [openFolder, setOpenFolder] = useState<FolderRef | null>(null);
  // 「王冠とスコアが異なる曲」フォルダは対象 0 件のとき一覧に出さないため、件数有無を保持する。
  const [hasMismatchFc, setHasMismatchFc] = useState(false);
  const [hasMismatchDc, setHasMismatchDc] = useState(false);
  // 「自己ベストで演奏オプションを使用した曲」も対象 0 件のとき一覧に出さない。
  const [hasOptions, setHasOptions] = useState(false);

  // 手動フォルダ名の作成 / 改名モーダル
  const [editing, setEditing] = useState<
    { mode: 'create' } | { mode: 'rename'; id: number } | null
  >(null);
  const [nameInput, setNameInput] = useState('');

  const load = useCallback(async () => {
    const [genreRows, manual, mismatchFc, mismatchDc, options] = await Promise.all([
      db.getAllAsync<{ id: string; title: string }>('SELECT id, title FROM genres ORDER BY id'),
      listManualFolders(db),
      getSmartFolderRecords(db, { kind: 'mismatchFc', name: MISMATCH_FC_NAME }),
      getSmartFolderRecords(db, { kind: 'mismatchDc', name: MISMATCH_DC_NAME }),
      getSmartFolderRecords(db, { kind: 'options', name: OPTIONS_NAME }),
    ]);
    setGenres(genreRows);
    setManualFolders(manual);
    setHasMismatchFc(mismatchFc.length > 0);
    setHasMismatchDc(mismatchDc.length > 0);
    setHasOptions(options.length > 0);
  }, [db]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const submitName = async () => {
    const name = nameInput.trim();
    if (!name || !editing) {
      setEditing(null);
      return;
    }
    if (editing.mode === 'create') {
      await createFolder(db, name);
    } else {
      await renameFolder(db, editing.id, name);
    }
    setEditing(null);
    setNameInput('');
    await load();
  };

  const confirmDelete = (folder: ManualFolderRow) => {
    Alert.alert('フォルダを削除', `「${folder.name}」を削除しますか？登録した曲も解除されます。`, [
      { text: 'キャンセル', style: 'cancel' },
      {
        text: '削除する',
        style: 'destructive',
        onPress: async () => {
          await deleteFolder(db, folder.id);
          await load();
        },
      },
    ]);
  };

  const manageFolder = (folder: ManualFolderRow) => {
    Alert.alert(folder.name, undefined, [
      { text: 'キャンセル', style: 'cancel' },
      {
        text: '名前を変更',
        onPress: () => {
          setNameInput(folder.name);
          setEditing({ mode: 'rename', id: folder.id });
        },
      },
      { text: '削除', style: 'destructive', onPress: () => confirmDelete(folder) },
    ]);
  };

  // スマートフォルダ + 手動フォルダを単一リストに並べる
  type ListItem =
    | { type: 'header'; key: string; label: string; action?: () => void; actionLabel?: string }
    | {
        type: 'folder';
        key: string;
        ref: FolderRef;
        /** 単色背景。gradient を指定した場合は無視。 */
        color?: string;
        /** 指定すると対角の金属光沢グラデで背景描画する（クラウン状態色用）。 */
        gradient?: { colors: readonly string[]; locations?: readonly number[] };
        subtitle?: string;
        onLong?: () => void;
      };

  const items: ListItem[] = [];
  items.push({ type: 'header', key: 'h-smart', label: 'スマートフォルダ' });
  items.push({
    type: 'folder',
    key: 'almostFc',
    ref: { kind: 'almostFc', name: ALMOST_FC_NAME },
    gradient: { colors: crownGradient('CLEAR')! },
  });
  items.push({
    type: 'folder',
    key: 'almostDc',
    ref: { kind: 'almostDc', name: ALMOST_DC_NAME },
    gradient: { colors: crownGradient('FULL_COMBO')! },
  });
  items.push({
    type: 'folder',
    key: 'recent',
    ref: { kind: 'recent', name: '最近スコアを更新した曲'},
    color: '#4cbfae'
  })
  // 「王冠とスコアが異なる曲」：対象 0 件なら非表示。背景はクラウン色の対角金属光沢グラデ。
  if (hasMismatchFc) {
    items.push({
      type: 'folder',
      key: 'mismatchFc',
      ref: { kind: 'mismatchFc', name: MISMATCH_FC_NAME },
      gradient: dualCrownGradient('CLEAR', 'FULL_COMBO'),
    });
  }
  if (hasMismatchDc) {
    items.push({
      type: 'folder',
      key: 'mismatchDc',
      ref: { kind: 'mismatchDc', name: MISMATCH_DC_NAME },
      gradient: dualCrownGradient('DONDAFUL_COMBO', 'FULL_COMBO'),
    });
  }
  // 「自己ベストで演奏オプションを使用した曲」：対象 0 件なら非表示。
  if (hasOptions) {
    items.push({
      type: 'folder',
      key: 'options',
      ref: { kind: 'options', name: OPTIONS_NAME },
      color: OPTIONS_FOLDER_COLOR,
    });
  }
  items.push({
    type: 'header',
    key: 'genre',
    label: 'ジャンル'
  })
  for (const g of genres) {
    items.push({
      type: 'folder',
      key: `genre-${g.id}`,
      ref: { kind: 'genre', genreId: g.id, name: g.title },
      color: GenreColors[g.id] ?? GENRE_FALLBACK_COLOR,
    });
  }
  items.push({ type: 'header', key: 'h-star', label: 'むずかしさ' });
  for (let star = 1; star <= 10; star++) {
    items.push({
      type: 'folder',
      key: `star-${star}`,
      ref: { kind: 'star', star, name: `☆${star}` },
      color: STAR_FOLDER_COLOR,
    });
  }
  items.push({
    type: 'header',
    key: 'h-manual',
    label: '手動フォルダ',
    actionLabel: '＋ 新規',
    action: () => {
      setNameInput('');
      setEditing({ mode: 'create' });
    },
  });
  for (const f of manualFolders) {
    items.push({
      type: 'folder',
      key: `manual-${f.id}`,
      ref: { kind: 'manual', id: f.id, name: f.name },
      color: GENRE_FALLBACK_COLOR,
      subtitle: `${f.count} 曲`,
      onLong: () => manageFolder(f),
    });
  }

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView edges={['top']} style={styles.safe}>
        <View style={styles.headerRow}>
          <ThemedText type="subtitle">フォルダ</ThemedText>
        </View>

        <FlatList
          data={items}
          keyExtractor={(it) => it.key}
          contentContainerStyle={styles.listContent}
          renderItem={({ item }) => {
            if (item.type === 'header') {
              return (
                <View style={styles.sectionHeader}>
                  <ThemedText type="small" themeColor="textSecondary">
                    {item.label}
                  </ThemedText>
                  {item.action && (
                    <Pressable
                      onPress={item.action}
                      style={[styles.addBtn, { backgroundColor: theme.backgroundSelected }]}
                    >
                      <ThemedText type="smallBold">{item.actionLabel}</ThemedText>
                    </Pressable>
                  )}
                </View>
              );
            }
            return (
              <Pressable onPress={() => setOpenFolder(item.ref)} onLongPress={item.onLong}>
                <View style={styles.folderRow}>
                  {item.gradient ? (
                    <GradientFill
                      colors={item.gradient.colors}
                      locations={item.gradient.locations}
                      style={StyleSheet.absoluteFill}
                    />
                  ) : (
                    <View style={[StyleSheet.absoluteFill, { backgroundColor: item.color }]} />
                  )}
                  <ThemedText type="smallBold" numberOfLines={1} style={styles.folderName}>
                    {item.ref.name}
                  </ThemedText>
                  {item.subtitle && (
                    <ThemedText type="small" themeColor="textSecondary">
                      {item.subtitle}
                    </ThemedText>
                  )}
                  <ThemedText type="small" themeColor="textSecondary">
                    ›
                  </ThemedText>
                </View>
              </Pressable>
            );
          }}
        />
      </SafeAreaView>

      {openFolder && (
        <FolderDetailModal folder={openFolder} onClose={() => setOpenFolder(null)} />
      )}

      {/* 手動フォルダ 作成/改名 入力 */}
      <Modal visible={editing != null} transparent animationType="fade" onRequestClose={() => setEditing(null)}>
        <Pressable style={styles.inputBackdrop} onPress={() => setEditing(null)} />
        <View style={styles.inputCenter} pointerEvents="box-none">
          <ThemedView type="backgroundElement" style={styles.inputCard}>
            <ThemedText type="smallBold">
              {editing?.mode === 'rename' ? 'フォルダ名を変更' : '新しいフォルダ'}
            </ThemedText>
            <TextInput
              style={[styles.input, { color: theme.text, borderColor: theme.textSecondary }]}
              placeholder="フォルダ名"
              placeholderTextColor={theme.textSecondary}
              value={nameInput}
              onChangeText={setNameInput}
              autoFocus
              returnKeyType="done"
              onSubmitEditing={submitName}
            />
            <View style={styles.inputBtnRow}>
              <Pressable style={styles.inputBtn} onPress={() => setEditing(null)}>
                <ThemedText type="small" themeColor="textSecondary">
                  キャンセル
                </ThemedText>
              </Pressable>
              <Pressable
                style={[styles.inputBtn, { backgroundColor: theme.backgroundSelected }]}
                onPress={submitName}
              >
                <ThemedText type="smallBold">保存</ThemedText>
              </Pressable>
            </View>
          </ThemedView>
        </View>
      </Modal>
    </ThemedView>
  );
}

// ---------------------------------------------------------------------------
// フォルダ内容モーダル
// ---------------------------------------------------------------------------

function FolderDetailModal({ folder, onClose }: { folder: FolderRef; onClose: () => void }) {
  const db = useSQLiteContext();
  const theme = useTheme();
  // スマートフォルダ（もうすぐFC/DC・最近更新・王冠とスコア不一致FC/DC）は記録タブと同じ Row で表示する。
  const isSmart =
    folder.kind === 'almostFc' ||
    folder.kind === 'almostDc' ||
    folder.kind === 'recent' ||
    folder.kind === 'mismatchFc' ||
    folder.kind === 'mismatchDc' ||
    folder.kind === 'options';
  // 「王冠とスコアが異なる曲」はクラウン色の対角金属光沢グラデを背景にする。
  const smartBackground =
    folder.kind === 'mismatchFc'
      ? dualCrownGradient('CLEAR', 'FULL_COMBO')
      : folder.kind === 'mismatchDc'
        ? dualCrownGradient('DONDAFUL_COMBO', 'FULL_COMBO')
        : undefined;
  // フォルダ種別ごとの右側表示。options はスコア＋オプションアイコン、その他は残数/可不可など。
  const smartRowRight = (item: RecordListRow): ReactNode => {
    const score = item.score_total != null ? item.score_total.toLocaleString() : '—';
    switch (folder.kind) {
      case 'almostFc':
        return <RecordRowStat top={`残り不可 ${item.ng ?? '—'}`} bottom={score} />;
      case 'almostDc':
        return <RecordRowStat top={`残り可 ${item.ok ?? '—'}`} bottom={score} />;
      case 'mismatchFc':
        return <RecordRowStat top={`不可 ${item.ng ?? '—'}`} bottom={score} />;
      case 'mismatchDc':
        return <RecordRowStat top={`可 ${item.ok ?? '—'}`} bottom={`不可 ${item.ng ?? '—'}`} />;
      case 'options':
        return (
          <RecordRowStat top={score} bottom={<OptionIcons srcs={parseOptionList(item.options)} />} />
        );
      case 'recent':
        return (
          <RecordRowStat
            top={
              item.updated_at === 0
                ? '初期化'
                : new Date(item.updated_at).toLocaleDateString('ja-JP')
            }
            bottom={score}
          />
        );
      default:
        return <RecordRowStat top={score} />;
    }
  };

  // smart: 記録一覧行（RecordListRow）／genre・manual・star: 難易度別（FolderSongDetail）
  const [smartRows, setSmartRows] = useState<RecordListRow[]>([]);
  const [details, setDetails] = useState<FolderSongDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState<SongSearchState>(EMPTY_SONG_SEARCH);
  const [showAdd, setShowAdd] = useState(false);
  const [selected, setSelected] = useState<{ song_number: number; level: Level } | null>(null);
  // お気に入り反映の対象 song_no（≤30 に整形済み）。null の間はモーダル非表示。
  const [favoriteNos, setFavoriteNos] = useState<number[] | null>(null);

  // フォルダ内容をドンだーひろばのお気に入りへ反映する。30超は警告後に先頭30曲のみ。
  const onReflectFavorite = useCallback(async () => {
    const nos = await getFolderSongNumbers(db, folder);
    if (nos.length === 0) {
      Alert.alert('お気に入りに反映', 'このフォルダには曲がありません。');
      return;
    }
    if (nos.length > FAVORITE_LIMIT) {
      Alert.alert(
        'お気に入りに反映',
        `${nos.length}曲あります。お気に入りは最大${FAVORITE_LIMIT}曲のため、フォルダの先頭${FAVORITE_LIMIT}曲のみ登録します。`,
        [
          { text: 'キャンセル', style: 'cancel' },
          { text: '続ける', onPress: () => setFavoriteNos(nos.slice(0, FAVORITE_LIMIT)) },
        ],
      );
      return;
    }
    setFavoriteNos(nos);
  }, [db, folder]);

  const load = useCallback(async () => {
    setLoading(true);
    if (isSmart) {
      const rows = await getSmartFolderRecords(db, folder);
      setSmartRows(rows);
    } else {
      const rows = await getFolderSongDetails(db, folder);
      setDetails(rows);
    }
    setLoading(false);
  }, [db, folder, isSmart]);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      void load().catch(() => {
        if (active) setLoading(false);
      });
      return () => {
        active = false;
      };
    }, [load]),
  );

  // クライアント側の絞り込み・並べ替え（スコア対象）。
  const q = search.titleQuery.trim().toLowerCase();
  const filteredDetails = (() => {
    let list = details;
    if (q) list = list.filter((d) => (d.title ?? '').toLowerCase().includes(q));
    if (search.minScore != null)
      list = list.filter((d) => d.maxScore != null && d.maxScore >= search.minScore!);
    if (search.scoreSort !== 'none') {
      const dir = search.scoreSort === 'asc' ? 1 : -1;
      list = [...list].sort((a, b) => {
        if (a.maxScore == null && b.maxScore == null) return 0;
        if (a.maxScore == null) return 1; // 未記録は末尾
        if (b.maxScore == null) return -1;
        return (a.maxScore - b.maxScore) * dir;
      });
    }
    return list;
  })();
  const filteredSmart = (() => {
    let list = smartRows;
    if (q) list = list.filter((r) => (r.song_title ?? '').toLowerCase().includes(q));
    if (search.minScore != null)
      list = list.filter((r) => r.score_total != null && r.score_total >= search.minScore!);
    if (search.scoreSort !== 'none') {
      const dir = search.scoreSort === 'asc' ? 1 : -1;
      list = [...list].sort((a, b) => {
        if (a.score_total == null && b.score_total == null) return 0;
        if (a.score_total == null) return 1; // 未記録は末尾
        if (b.score_total == null) return -1;
        return (a.score_total - b.score_total) * dir;
      });
    }
    return list;
  })();
  const visibleCount = isSmart ? filteredSmart.length : filteredDetails.length;

  return (
    <Modal transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <ThemedView type="backgroundElement" style={styles.sheet}>
        <View style={styles.sheetHeader}>
          <ThemedText type="smallBold" numberOfLines={1} style={styles.sheetTitle}>
            {folder.name}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {visibleCount} 曲
          </ThemedText>
          {folder.kind === 'manual' && (
            <Pressable
              onPress={() => setShowAdd(true)}
              style={[styles.addBtn, { backgroundColor: theme.backgroundSelected }]}>
              <ThemedText type="smallBold">＋ 曲を追加</ThemedText>
            </Pressable>
          )}
          <Pressable
            onPress={onReflectFavorite}
            style={[styles.addBtn, { backgroundColor: theme.backgroundSelected }]}>
            <ThemedText type="smallBold">★ お気に入り</ThemedText>
          </Pressable>
          <Pressable onPress={onClose} style={styles.closeBtn}>
            <ThemedText type="smallBold">✕</ThemedText>
          </Pressable>
        </View>

        <View style={styles.searchWrap}>
          <SongSearchBar value={search} onChange={setSearch} />
        </View>

        {isSmart ? (
          <FlatList
            data={filteredSmart}
            keyExtractor={(r) => `${r.song_number}-${r.level}`}
            contentContainerStyle={styles.smartListContent}
            keyboardShouldPersistTaps="handled"
            ListEmptyComponent={
              <ThemedText type="small" themeColor="textSecondary" style={styles.empty}>
                {loading
                  ? '読み込み中…'
                  : folder.kind === 'recent'
                    ? '最近スコアを更新した曲がありません。'
                    : folder.kind === 'options'
                      ? '自己ベストで演奏オプションを使用した曲がありません。'
                      : folder.kind === 'mismatchFc' || folder.kind === 'mismatchDc'
                        ? '条件に合う曲がありません。'
                        : '条件に合う曲がありません。設定の閾値・対象難易度を確認してください。'}
              </ThemedText>
            }
            renderItem={({ item }) => (
              <RecordRow
                row={item}
                rowRight={smartRowRight(item)}
                background={smartBackground}
                onPress={() => setSelected({ song_number: item.song_number, level: item.level })}
              />
            )}
          />
        ) : (
          <FlatList
            data={filteredDetails}
            keyExtractor={(d) => String(d.song_number)}
            contentContainerStyle={styles.songListContent}
            keyboardShouldPersistTaps="handled"
            ListEmptyComponent={
              <ThemedText type="small" themeColor="textSecondary" style={styles.empty}>
                {loading
                  ? '読み込み中…'
                  : details.length === 0
                    ? 'このフォルダにはまだ曲がありません。'
                    : '検索条件に一致する曲がありません。'}
              </ThemedText>
            }
            renderItem={({ item }) => (
              <View style={[styles.detailRow, { borderColor: theme.text + '18' }]}>
                <ThemedText type="smallBold" numberOfLines={1}>
                  {item.title ?? `#${item.song_number}`}
                </ThemedText>
                <View style={styles.levelBadgeRow}>
                  {item.levels.map((lv) => (
                    <LevelBadge
                      key={lv.level}
                      entry={lv}
                      onPress={() => setSelected({ song_number: item.song_number, level: lv.level })}
                    />
                  ))}
                </View>
              </View>
            )}
          />
        )}
      </ThemedView>

      {showAdd && folder.kind === 'manual' && (
        <AddSongsModal
          folderId={folder.id}
          folderName={folder.name}
          onClose={() => {
            setShowAdd(false);
            void load();
          }}
        />
      )}

      {selected && (
        <RecordDetailModal
          songNumber={selected.song_number}
          level={selected.level}
          taikoNo={SELF_TAIKO_NO}
          onClose={() => setSelected(null)}
        />
      )}

      {favoriteNos && (
        <FavoriteSyncModal
          songNumbers={favoriteNos}
          folderName={folder.name}
          onClose={() => setFavoriteNos(null)}
        />
      )}
    </Modal>
  );
}

/** 難易度バッジ：難易度アイコン＋（記録があれば）王冠・極マークを併記。記録なしは淡色・無効。 */
function LevelBadge({
  entry,
  onPress,
}: {
  entry: FolderSongDetail['levels'][number];
  onPress: () => void;
}) {
  const { level, crown, class: cls, hasRecord } = entry;
  return (
    <Pressable
      onPress={onPress}
      disabled={!hasRecord}
      style={[styles.levelBadge, !hasRecord && styles.levelBadgeDim]}>
      <Image source={LevelImages[level]} style={styles.levelIcon} resizeMode="contain" />
      <View style={styles.badgeMarks}>
        {hasRecord && CrownImages[crown] && (
          <Image source={CrownImages[crown]} style={styles.badgeCrown} resizeMode="contain" />
        )}
        {hasRecord && ClassImages[cls] && (
          <Image source={ClassImages[cls]} style={styles.badgeClass} resizeMode="contain" />
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safe: { flex: 1, paddingHorizontal: Spacing.three },
  headerRow: { paddingTop: Spacing.two, paddingBottom: Spacing.one },

  listContent: { gap: Spacing.one, paddingBottom: Spacing.six },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: Spacing.three,
    paddingBottom: Spacing.one,
  },
  addBtn: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one,
    borderRadius: 12,
  },

  folderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    borderRadius: Spacing.two,
    overflow: 'hidden',
  },
  folderName: { flex: 1 },

  // 入力モーダル
  inputBackdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  inputCenter: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.four },
  inputCard: {
    width: '100%',
    maxWidth: 360,
    borderRadius: Spacing.three,
    padding: Spacing.three,
    gap: Spacing.three,
  },
  input: {
    borderWidth: 1,
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.two,
    fontSize: 15,
  },
  inputBtnRow: { flexDirection: 'row', justifyContent: 'flex-end', gap: Spacing.two },
  inputBtn: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.two,
  },

  // フォルダ内容シート
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: {
    borderTopLeftRadius: Spacing.three,
    borderTopRightRadius: Spacing.three,
    maxHeight: '80%',
    paddingBottom: Spacing.six,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    padding: Spacing.three,
    paddingBottom: Spacing.two,
  },
  sheetTitle: { flex: 1 },
  closeBtn: { paddingHorizontal: Spacing.two, paddingVertical: Spacing.one },
  searchWrap: { paddingHorizontal: Spacing.three, paddingBottom: Spacing.two },

  songListContent: { paddingHorizontal: Spacing.three, paddingBottom: Spacing.three },
  // スマートフォルダは記録タブの Row を使うため、記録一覧と同じ行間（gap）を取る。
  smartListContent: {
    gap: Spacing.one,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    paddingBottom: Spacing.three,
  },
  empty: { textAlign: 'center', marginTop: Spacing.five },

  // 難易度別の曲行（genre/manual）
  detailRow: {
    gap: Spacing.one,
    paddingVertical: Spacing.two,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  // アイコン領域を5等分（各 20%）し、難易度アイコンを左詰めで並べる。
  // プレイ状況（王冠/極マーク）はアイコンの下に置き、列幅を変えない。
  levelBadgeRow: { flexDirection: 'row', flexWrap: 'nowrap' },
  levelBadge: {
    width: '20%',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 0,
  },
  levelBadgeDim: { opacity: 0.35 },
  levelIcon: { width: 30, height: 30 },
  badgeMarks: { flexDirection: 'row', alignItems: 'center', gap: 1, height: 18 },
  badgeCrown: { width: 18, height: 18 },
  badgeClass: { width: 16, height: 16 },
});
