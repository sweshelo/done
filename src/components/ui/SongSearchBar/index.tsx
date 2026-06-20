/**
 * 楽曲検索バー（制御コンポーネント）。
 * 曲名（部分一致）・最低スコア・スコア並べ替え（なし→降順→昇順）を扱う。
 * フォルダ内絞り込み／手動フォルダへの曲追加の双方で使い回す。
 */
import { StyleSheet, TextInput, View } from 'react-native';

import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type ScoreSort = 'none' | 'desc' | 'asc';

export interface SongSearchState {
  titleQuery: string;
  minScore: number | null;
  scoreSort: ScoreSort;
}

export const EMPTY_SONG_SEARCH: SongSearchState = {
  titleQuery: '',
  minScore: null,
  scoreSort: 'none',
};

interface Props {
  value: SongSearchState;
  onChange: (next: SongSearchState) => void;
}

export function SongSearchBar({ value, onChange }: Props) {
  const theme = useTheme();

  return (
    <View style={styles.container}>
      <TextInput
        style={[styles.titleInput, { color: theme.text, borderColor: theme.textSecondary }]}
        placeholder="曲名で検索…"
        placeholderTextColor={theme.textSecondary}
        value={value.titleQuery}
        onChangeText={(t) => onChange({ ...value, titleQuery: t })}
        returnKeyType="search"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: Spacing.one },
  titleInput: {
    borderWidth: 1,
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one,
    fontSize: 14,
  },
  scoreRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  scoreInput: {
    flex: 1,
    borderWidth: 1,
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one,
    fontSize: 14,
  },
  sortChip: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one + 2,
    borderRadius: 12,
    overflow: 'hidden',
  },
  sortChipActive: { backgroundColor: '#e94560' },
  sortChipActiveText: { color: '#fff' },
});
