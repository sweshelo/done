import { LinearGradient } from 'expo-linear-gradient';
import React from 'react';
import { Image, Pressable, StyleSheet, View } from 'react-native';

import { GradientFill } from '@/components/GradientFill';
import { ThemedText } from '@/components/themed-text';
import {
  ClassImages,
  CrownColors,
  CrownImages,
  LevelColors,
  LevelLabels,
  optionImageUri,
  resolveGenreColors,
} from '@/constants/taiko-colors';
import { Spacing } from '@/constants/theme';
import type { RecordListRow, RecordSortKey } from '@/db/records';

/**
 * 記録一覧の 1 行。記録タブとスマートフォルダ（もうすぐFC/DC・最近更新）で共有する。
 * sortKey に応じて右側（rowRight）の主表示を切り替える。
 */
export function RecordRow({
  row,
  sortKey,
  onPress,
  right,
  background,
  optionSrcs,
}: {
  row: RecordListRow;
  sortKey: RecordSortKey;
  onPress: () => void;
  /**
   * 指定時は sortKey に依らず、右側の主表示（top=太字）と副表示（bottom=グレー）を上書きする。
   * もうすぐフォルダ（残数）や「王冠とスコアが異なる曲」（可/不可の数）などフォルダ固有の表示用。
   */
  right?: { top: string; bottom?: string };
  /**
   * 指定時はジャンル背景の代わりに、この対角グラデーション（colors / 任意 locations）を背景に使う。
   * 「王冠とスコアが異なる曲」フォルダなどでクラウンの金属光沢グラデを出す用途。
   */
  background?: { colors: readonly string[]; locations?: readonly number[] };
  /**
   * 指定時は曲名・難易度の下に、演奏オプションのアイコン（本家画像 src の配列）を並べる。
   * 「自己ベストで演奏オプションを使用した曲」フォルダ用。
   */
  optionSrcs?: string[];
}) {
  const achievePct =
    row.total_notes != null && row.total_notes > 0
      ? ((row.achievement ?? 0) * 100).toFixed(2)
      : '—';
  const fmt = (n: number | null) => (n != null ? n.toLocaleString() : '—');

  // 背景色：background 未指定時のジャンル背景（対角分割 or 単色）。
  const { color1, color2, isDual } = resolveGenreColors(row.genre_ids);

  // ソートキーに応じた rowRight 内容
  let rowRightTop: React.ReactNode;
  let rowRightBottom: React.ReactNode;
  if (right) {
    // フォルダ固有の右側表示（残数・可/不可の数など）。
    rowRightTop = <ThemedText type="smallBold">{right.top}</ThemedText>;
    rowRightBottom = right.bottom ? (
      <ThemedText type="small" themeColor="textSecondary">
        {right.bottom}
      </ThemedText>
    ) : null;
  } else {
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
  }

  return (
    <Pressable onPress={onPress}>
      <View style={styles.row}>
        {/* 背景：background 指定時はその対角グラデ、未指定はジャンル背景（対角分割 or 単色）。 */}
        {background ? (
          <GradientFill
            colors={background.colors}
            locations={background.locations}
            style={StyleSheet.absoluteFill}
          />
        ) : isDual ? (
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
          <Image source={CrownImages[row.crown]} style={styles.crownImage} resizeMode="contain" />
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
          {optionSrcs && optionSrcs.length > 0 && (
            <View style={styles.optionIcons}>
              {optionSrcs.map((src) => (
                <Image
                  key={src}
                  source={{ uri: optionImageUri(src) }}
                  style={styles.optionIcon}
                  resizeMode="contain"
                />
              ))}
            </View>
          )}
        </View>

        <View style={styles.rowRight}>
          {rowRightTop}
          {rowRightBottom}
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
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
  optionIcons: { flexDirection: 'row', flexWrap: 'wrap', gap: 2, marginTop: 2 },
  optionIcon: { width: 20, height: 20, borderRadius: 3 },
});
