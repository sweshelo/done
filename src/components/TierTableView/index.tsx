import { LinearGradient } from 'expo-linear-gradient';
import { forwardRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { LevelColors, DONDAFUL_GRADIENT } from '@/constants/taiko-colors';
import { Spacing } from '@/constants/theme';
import type { Level, Crown } from '@/types';

export interface TierTableRow {
  song_number: number;
  song_title: string;
  level: Level;
  crown: Crown | null;
  tier: string;
  tier_rank: number;
}

interface Props {
  rows: TierTableRow[];
  /** セル幅（横長長方形のベース）。10 列を横画面幅に fit させた値が渡される。 */
  cellWidth: number;
  /** コンテナの確定幅。floor 由来の右側余白を出さないため明示する。 */
  tableWidth: number;
}

function crownToBg(crown: Crown | null): string {
  switch (crown) {
    case 'DONDAFUL_COMBO':
      return '#f170ff'; // 実際は LinearGradient を使用
    case 'FULL_COMBO':
      return '#f3c621';
    case 'CLEAR':
      return '#e3f6ff';
    default:
      return '#8b8b8b'; // 未プレイ / 記録なし
  }
}

export const TierTableView = forwardRef<View, Props>(({ rows, cellWidth, tableWidth }, ref) => {
  const grouped = rows.reduce<Map<number, { tier: string; items: TierTableRow[] }>>(
    (acc, row) => {
      if (!acc.has(row.tier_rank)) acc.set(row.tier_rank, { tier: row.tier, items: [] });
      acc.get(row.tier_rank)!.items.push(row);
      return acc;
    },
    new Map(),
  );
  const sections = [...grouped.entries()].sort(([a], [b]) => a - b);

  return (
    <View ref={ref} style={[styles.container, { width: tableWidth }]} collapsable={false}>
      {sections.map(([rank, { tier, items }]) => (
        <View key={rank} style={styles.section}>
          <View style={styles.tierLabelRow}>
            <View style={styles.tierAccent} />
            <Text style={styles.tierLabel}>{tier}</Text>
          </View>
          <View style={styles.cellGrid}>
            {items.map((row) => (
              <SongCell key={`${row.song_number}-${row.level}`} row={row} width={cellWidth} />
            ))}
          </View>
        </View>
      ))}
    </View>
  );
});

TierTableView.displayName = 'TierTableView';

function SongCell({ row, width }: { row: TierTableRow; width: number }) {
  const textColor = LevelColors[row.level];
  // 横長長方形（width > height）
  const cellStyle = {
    width,
    height: Math.round(width * 0.45),
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.one,
    paddingVertical: Spacing.half,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    overflow: 'hidden' as const,
  };
  const textEl = (
    <Text numberOfLines={2} style={[styles.cellText, { color: textColor }]}>
      {row.song_title}
    </Text>
  );

  if (row.crown === 'DONDAFUL_COMBO') {
    return (
      <LinearGradient
        colors={DONDAFUL_GRADIENT as [string, string, ...string[]]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={cellStyle}
      >
        {textEl}
      </LinearGradient>
    );
  }

  return <View style={[cellStyle, { backgroundColor: crownToBg(row.crown) }]}>{textEl}</View>;
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#1a1a1a',
    padding: Spacing.two,
    gap: Spacing.two,
  },
  section: { gap: Spacing.one },
  tierLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#2d2d2d',
    borderRadius: Spacing.one,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one,
    gap: Spacing.one,
    alignSelf: 'flex-start',
  },
  tierAccent: {
    width: 3,
    height: 12,
    borderRadius: 2,
    backgroundColor: '#e94560',
  },
  tierLabel: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: 'bold',
  },
  cellGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 2,
  },
  cellText: {
    fontSize: 10,
    fontWeight: 'bold',
    textAlign: 'center',
    lineHeight: 12,
  },
});
