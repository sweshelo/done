import { useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useState } from 'react';
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

import { RecordDetailModal } from '@/components/RecordDetailModal';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import {
  CrownColors,
  CrownImages,
  GenreColors,
  LevelColors,
  LevelLabels
} from '@/constants/taiko-colors';
import { Spacing } from '@/constants/theme';
import {
  createFolder,
  deleteFolder,
  getFolderSongs,
  listManualFolders,
  renameFolder,
} from '@/db';
import type { FolderRef, FolderSongRow, ManualFolderRow } from '@/db/folders';
import { useTheme } from '@/hooks/use-theme';
import { SELF_TAIKO_NO } from '@/types';

const GENRE_FALLBACK_COLOR = '#212225';
const ALMOST_FC_NAME = 'もうすぐフルコンボ';
const ALMOST_DC_NAME = 'もうすぐドンだフルコンボ';

export default function FoldersScreen() {
  const db = useSQLiteContext();
  const theme = useTheme();

  const [genres, setGenres] = useState<{ id: string; title: string }[]>([]);
  const [manualFolders, setManualFolders] = useState<ManualFolderRow[]>([]);
  const [openFolder, setOpenFolder] = useState<FolderRef | null>(null);

  // 手動フォルダ名の作成 / 改名モーダル
  const [editing, setEditing] = useState<
    { mode: 'create' } | { mode: 'rename'; id: number } | null
  >(null);
  const [nameInput, setNameInput] = useState('');

  const load = useCallback(async () => {
    const [genreRows, manual] = await Promise.all([
      db.getAllAsync<{ id: string; title: string }>('SELECT id, title FROM genres ORDER BY id'),
      listManualFolders(db),
    ]);
    setGenres(genreRows);
    setManualFolders(manual);
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
    | { type: 'folder'; key: string; ref: FolderRef; color: string; subtitle?: string; onLong?: () => void };

  const items: ListItem[] = [];
  items.push({ type: 'header', key: 'h-smart', label: 'スマートフォルダ' });
  items.push({
    type: 'folder',
    key: 'almostFc',
    ref: { kind: 'almostFc', name: ALMOST_FC_NAME },
    color: CrownColors.CLEAR,
  });
  items.push({
    type: 'folder',
    key: 'almostDc',
    ref: { kind: 'almostDc', name: ALMOST_DC_NAME },
    color: CrownColors.FULL_COMBO,
  });
  for (const g of genres) {
    items.push({
      type: 'folder',
      key: `genre-${g.id}`,
      ref: { kind: 'genre', genreId: g.id, name: g.title },
      color: GenreColors[g.id] ?? GENRE_FALLBACK_COLOR,
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
                  <View style={[StyleSheet.absoluteFill, { backgroundColor: item.color }]} />
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
  const [songs, setSongs] = useState<FolderSongRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<{ song_number: number; level: FolderSongRow['level'] } | null>(null);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      setLoading(true);
      getFolderSongs(db, folder).then((rows) => {
        if (!active) return;
        setSongs(rows);
        setLoading(false);
      });
      return () => {
        active = false;
      };
    }, [db, folder]),
  );

  const isAlmost = folder.kind === 'almostFc' || folder.kind === 'almostDc';
  const remainingLabel = folder.kind === 'almostFc' ? '不可' : '可';

  return (
    <Modal transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <ThemedView type="backgroundElement" style={styles.sheet}>
        <View style={styles.sheetHeader}>
          <ThemedText type="smallBold" numberOfLines={1} style={styles.sheetTitle}>
            {folder.name}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {songs.length} 曲
          </ThemedText>
          <Pressable onPress={onClose} style={styles.closeBtn}>
            <ThemedText type="smallBold">✕</ThemedText>
          </Pressable>
        </View>

        <FlatList
          data={songs}
          keyExtractor={(s, i) => `${s.song_number}-${s.level ?? ''}-${i}`}
          contentContainerStyle={styles.songListContent}
          ListEmptyComponent={
            <ThemedText type="small" themeColor="textSecondary" style={styles.empty}>
              {loading
                ? '読み込み中…'
                : isAlmost
                  ? '条件に合う曲がありません。設定の閾値を確認してください。'
                  : 'このフォルダにはまだ曲がありません。'}
            </ThemedText>
          }
          renderItem={({ item }) => (
            <Pressable
              onPress={() => setSelected({ song_number: item.song_number, level: item.level })}
            >
              <View style={[styles.songRow, { borderColor: theme.text + '18' }]}>
                {item.level && (
                  <View style={[styles.courseBar, { backgroundColor: LevelColors[item.level] }]} />
                )}
                {item.crown && CrownImages[item.crown] && (
                  <Image source={CrownImages[item.crown]} style={styles.songCrown} resizeMode="contain" />
                )}
                <View style={styles.songMain}>
                  <ThemedText type="smallBold" numberOfLines={1}>
                    {item.title ?? `#${item.song_number}`}
                  </ThemedText>
                  {item.level && (
                    <ThemedText type="small" themeColor="textSecondary">
                      {LevelLabels[item.level]}
                    </ThemedText>
                  )}
                </View>
                {isAlmost && item.remaining != null && (
                  <ThemedText type="smallBold">
                    残り{remainingLabel} {item.remaining}
                  </ThemedText>
                )}
              </View>
            </Pressable>
          )}
        />
      </ThemedView>

      {selected && (
        <RecordDetailModal
          songNumber={selected.song_number}
          level={selected.level ?? 'ONI'}
          taikoNo={SELF_TAIKO_NO}
          onClose={() => setSelected(null)}
        />
      )}
    </Modal>
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

  songListContent: { paddingHorizontal: Spacing.three, paddingBottom: Spacing.three },
  empty: { textAlign: 'center', marginTop: Spacing.five },
  songRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.two,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  courseBar: { width: 4, height: 28, borderRadius: 2, flexShrink: 0 },
  songCrown: { width: 28, height: 28, flexShrink: 0 },
  songMain: { flex: 1, gap: 2 },
});
