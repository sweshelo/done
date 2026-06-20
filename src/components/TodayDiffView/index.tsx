import { LinearGradient } from 'expo-linear-gradient';
import { forwardRef } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';

import {
  ClassImages,
  ClassLabels,
  CrownColors,
  CrownImages,
  LevelImages,
  resolveGenreColors
} from '@/constants/taiko-colors';
import { Spacing } from '@/constants/theme';
import type { TodayDiffRow } from '@/db';
import type { Crown } from '@/types';

interface Props {
  rows: TodayDiffRow[];
  /** ヘッダーに出す日付ラベル（例: 2026/06/20） */
  dateLabel: string;
  /** カード幅。プレビュー実測幅に合わせて渡す（プレビュー＝キャプチャ共通）。 */
  width: number;
}

/** 王冠の短縮ラベル（画像が無い NO_PLAY 用フォールバックにも使う） */
const CROWN_SHORT: Record<Crown, string> = {
  NO_PLAY: '未',
  PLAYED: '済',
  CLEAR: 'クリア',
  FULL_COMBO: 'FC',
  DONDAFUL_COMBO: '全良',
};

/** 符号付き差分文字列。0 は ±0。 */
function signed(n: number): string {
  if (n > 0) return `+${n.toLocaleString()}`;
  if (n < 0) return n.toLocaleString();
  return '±0';
}

export const TodayDiffView = forwardRef<View, Props>(({ rows, dateLabel, width }, ref) => (
  // リサイズせず直接キャプチャするためルート View を固定幅・collapsable=false にする
  <View ref={ref} style={[styles.container, { width }]} collapsable={false}>
    <View style={styles.header}>
      <Text style={styles.headerTitle}>今日の差分</Text>
      <Text style={styles.headerMeta}>
        {dateLabel} ・ {rows.length} 件
      </Text>
    </View>
    {rows.map((row) => (
      <DiffCard key={`${row.song_number}-${row.level}`} row={row} />
    ))}
    <Text style={styles.footer}>#太鼓の達人 / done</Text>
  </View>
));

TodayDiffView.displayName = 'TodayDiffView';

function DiffCard({ row }: { row: TodayDiffRow }) {
  const { color1, color2, isDual } = resolveGenreColors(row.genre_ids);
  const isNew = row.before_crown == null; // 今日より前の記録が無い = 本日初記録

  const crownChanged = row.before_crown != null && row.before_crown !== row.crown;
  const classChanged = row.before_class != null && row.before_class !== row.class;

  // スコア差分（before/after どちらかが NULL なら差分なし）
  const scoreDiff =
    row.score_total != null && row.before_score_total != null
      ? row.score_total - row.before_score_total
      : null;

  // 良/可/不可/連打/コンボ の差分行を組み立てる
  const stats: { label: string; after: number | null; before: number | null }[] = [
    { label: '良', after: row.good, before: row.before_good },
    { label: '可', after: row.ok, before: row.before_ok },
    { label: '不可', after: row.ng, before: row.before_ng },
    { label: '連打', after: row.pound, before: row.before_pound },
  ];

  return (
    <View style={styles.card}>
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
      <View style={styles.leftPart}>
        {CrownImages[row.crown] ? (
          <Image source={CrownImages[row.crown]} style={styles.crownImage} resizeMode="contain" />
        ) : (
          <View style={[styles.crownDot, { backgroundColor: CrownColors[row.crown] }]} />
        )}
        {/* 難易度アイコン */}
        <Image source={LevelImages[row.level]} style={styles.levelImage} />
      </View>

      <View style={styles.body}>
        {/* タイトル行 */}
        <View style={styles.titleRow}>
          <Text style={styles.title} numberOfLines={1}>
            {row.song_title ?? `#${row.song_number}`}
          </Text>
          {isNew && <Text style={styles.newBadge}>NEW</Text>}
        </View>

        {/* スコア */}
        <View style={styles.scoreRow}>
          <Text style={styles.scoreLabel}>スコア</Text>
          <Text style={styles.scoreValue}>
            {row.score_total != null ? row.score_total.toLocaleString() : '—'}
          </Text>
          {scoreDiff != null && scoreDiff !== 0 && (
            <Text style={[styles.scoreDiff, scoreDiff > 0 ? styles.up : styles.down]}>
              ({signed(scoreDiff)})
            </Text>
          )}
        </View>

        {/* 良 / 可 / 不可 / 連打 / コンボ */}
        <View style={styles.statsRow}>
          {stats.map((s) => {
            const diff = s.after != null && s.before != null ? s.after - s.before : null;
            return (
              <View key={s.label} style={styles.statItem}>
                <Text style={styles.statLabel}>{s.label}</Text>
                <Text style={styles.statValue}>{s.after != null ? s.after.toLocaleString() : '—'}</Text>
                {diff != null && diff !== 0 && (
                  <Text style={[styles.statDiff, diff > 0 ? styles.up : styles.down]}>
                    {signed(diff)}
                  </Text>
                )}
              </View>
            );
          })}
        </View>

        {/* 王冠 / 極スコア（極マーク）の昇格 */}
        {(crownChanged || classChanged) && (
          <View style={styles.badgeRow}>
            {crownChanged && (
              <View style={styles.badgeItem}>
                <Text style={styles.badgeLabel}>王冠</Text>
                <Text style={styles.badgeText}>
                  {CROWN_SHORT[row.before_crown!]} → {CROWN_SHORT[row.crown]}
                </Text>
              </View>
            )}
            {classChanged && (
              <View style={styles.badgeItem}>
                <Text style={styles.badgeLabel}>極</Text>
                {ClassImages[row.class] && (
                  <Image source={ClassImages[row.class]} style={styles.classIcon} resizeMode="contain" />
                )}
                <Text style={styles.badgeText}>
                  {ClassLabels[row.before_class!]} → {ClassLabels[row.class]}
                </Text>
              </View>
            )}
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#1a1a1a',
    padding: Spacing.two,
    gap: Spacing.two,
  },
  header: {
    paddingHorizontal: Spacing.one,
    paddingBottom: Spacing.one,
  },
  headerTitle: { color: '#ffffff', fontSize: 18, fontWeight: 'bold' },
  headerMeta: { color: '#b0b0b0', fontSize: 12, marginTop: 2 },
  footer: { color: '#777', fontSize: 10, textAlign: 'right', paddingHorizontal: Spacing.one },

  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.two,
    overflow: 'hidden',
  },

  leftPart: { alignItems: 'center', alignContent: 'center' },
  crownImage: { width: 36, height: 30, flexShrink: 0, marginHorizontal: -Spacing.two },
  crownDot: { width: 10, height: 10, borderRadius: 5, flexShrink: 0 },
  levelImage: { width: 30, height: 30, flexShrink: 0 },

  body: { flex: 1, gap: 2 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  title: { color: '#fff', fontSize: 14, fontWeight: 'bold', flexShrink: 1 },
  newBadge: {
    color: '#fff',
    fontSize: 10,
    fontWeight: 'bold',
    backgroundColor: '#e94560',
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 4,
    overflow: 'hidden',
  },
  sub: { color: '#d8d8d8', fontSize: 11 },

  scoreRow: { flexDirection: 'row', alignItems: 'baseline', gap: Spacing.one, marginTop: 2 },
  scoreLabel: { color: '#b8b8b8', fontSize: 11 },
  scoreValue: { color: '#fff', fontSize: 15, fontWeight: 'bold' },
  scoreDiff: { fontSize: 12, fontWeight: 'bold' },

  statsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two, marginTop: 1 },
  statItem: { flexDirection: 'row', alignItems: 'baseline', gap: 3 },
  statLabel: { color: '#a8a8a8', fontSize: 10 },
  statValue: { color: '#eee', fontSize: 11, fontWeight: 'bold' },
  statDiff: { fontSize: 10, fontWeight: 'bold' },

  badgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two, marginTop: 2 },
  badgeItem: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  badgeLabel: { color: '#a8a8a8', fontSize: 10 },
  badgeText: { color: '#ffe08a', fontSize: 11, fontWeight: 'bold' },
  classIcon: { width: 16, height: 16 },

  up: { color: '#5cff8a' },
  down: { color: '#ff7a7a' },
});
