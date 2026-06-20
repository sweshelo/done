/**
 * 手動フォルダへ楽曲を追加するモーダル。
 * 全楽曲カタログ（songs テーブル）を曲名/スコアで検索し、各曲をフォルダに追加/解除する。
 */
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useState } from 'react';
import { FlatList, Modal, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import {
  EMPTY_SONG_SEARCH,
  SongSearchBar,
  type SongSearchState,
} from '@/components/ui/SongSearchBar';
import { Spacing } from '@/constants/theme';
import { addSongToFolder, removeSongFromFolder, searchCatalogSongs } from '@/db';
import type { CatalogSongRow } from '@/db/folders';
import { useTheme } from '@/hooks/use-theme';

interface Props {
  folderId: number;
  folderName: string;
  onClose: () => void;
}

export function AddSongsModal({ folderId, folderName, onClose }: Props) {
  const db = useSQLiteContext();
  const theme = useTheme();
  const [search, setSearch] = useState<SongSearchState>(EMPTY_SONG_SEARCH);
  const [results, setResults] = useState<CatalogSongRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    const run = async () => {
      const rows = await searchCatalogSongs(db, {
        titleQuery: search.titleQuery,
        minScore: search.minScore,
        scoreSort: search.scoreSort,
        folderId,
      });
      if (!active) return;
      setResults(rows);
      setLoading(false);
    };
    void run();
    return () => {
      active = false;
    };
  }, [db, folderId, search]);

  const toggle = (row: CatalogSongRow) => {
    const willAdd = !row.in_folder;
    // 楽観更新
    setResults((prev) =>
      prev.map((r) => (r.song_number === row.song_number ? { ...r, in_folder: willAdd } : r)),
    );
    void (willAdd
      ? addSongToFolder(db, folderId, row.song_number)
      : removeSongFromFolder(db, folderId, row.song_number));
  };

  return (
    <Modal transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <ThemedView type="backgroundElement" style={styles.sheet}>
        <View style={styles.header}>
          <View style={styles.headerText}>
            <ThemedText type="smallBold" numberOfLines={1}>
              曲を追加
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
              {folderName}
            </ThemedText>
          </View>
          <Pressable onPress={onClose} style={styles.closeBtn}>
            <ThemedText type="smallBold">完了</ThemedText>
          </Pressable>
        </View>

        <View style={styles.searchWrap}>
          <SongSearchBar value={search} onChange={setSearch} />
        </View>

        <FlatList
          data={results}
          keyExtractor={(r) => String(r.song_number)}
          contentContainerStyle={styles.listContent}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={
            <ThemedText type="small" themeColor="textSecondary" style={styles.empty}>
              {loading ? '読み込み中…' : '一致する曲がありません。'}
            </ThemedText>
          }
          renderItem={({ item }) => (
            <View style={[styles.row, { borderColor: theme.text + '18' }]}>
              <View style={styles.rowMain}>
                <ThemedText type="smallBold" numberOfLines={1}>
                  {item.title ?? `#${item.song_number}`}
                </ThemedText>
              </View>
              <Pressable
                onPress={() => toggle(item)}
                style={[
                  styles.toggleBtn,
                  { backgroundColor: theme.backgroundSelected },
                  item.in_folder && styles.toggleBtnActive,
                ]}>
                <ThemedText type="smallBold" style={item.in_folder ? styles.toggleBtnActiveText : undefined}>
                  {item.in_folder ? '✓ 追加済み' : '＋ 追加'}
                </ThemedText>
              </Pressable>
            </View>
          )}
        />
      </ThemedView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: {
    borderTopLeftRadius: Spacing.three,
    borderTopRightRadius: Spacing.three,
    maxHeight: '85%',
    paddingBottom: Spacing.six,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    padding: Spacing.three,
    paddingBottom: Spacing.two,
  },
  headerText: { flex: 1, gap: 2 },
  closeBtn: { paddingHorizontal: Spacing.two, paddingVertical: Spacing.one },
  searchWrap: { paddingHorizontal: Spacing.three, paddingBottom: Spacing.two },
  listContent: { paddingHorizontal: Spacing.three, paddingBottom: Spacing.three },
  empty: { textAlign: 'center', marginTop: Spacing.five },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.two,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowMain: { flex: 1, gap: 2 },
  toggleBtn: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one + 2,
    borderRadius: 12,
    flexShrink: 0,
  },
  toggleBtnActive: { backgroundColor: '#e94560' },
  toggleBtnActiveText: { color: '#fff' },
});
