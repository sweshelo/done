import { LinearGradient } from 'expo-linear-gradient';
import React from 'react';
import { Image, Pressable, StyleSheet, View } from 'react-native';

import { GradientFill } from '@/components/GradientFill';
import { ThemedText } from '@/components/themed-text';
import {
  CrownColors,
  CrownImages,
  LevelColors,
  LevelLabels,
  resolveGenreColors,
} from '@/constants/taiko-colors';
import { Spacing } from '@/constants/theme';
import type { RecordListRow } from '@/db/records';

/**
 * 右側カラムの定番表示（上=太字／下=グレー）。
 * 呼び出し側で rowRight を組み立てる際の共通部品。
 */
export function RecordRowStat({
  top,
  bottom,
}: {
  top: React.ReactNode;
  bottom?: React.ReactNode;
}) {
  return (
    <>
      <ThemedText type="smallBold">{top}</ThemedText>
      {bottom != null ? (
        <ThemedText type="small" themeColor="textSecondary">
          {bottom}
        </ThemedText>
      ) : null}
    </>
  );
}

/**
 * 記録一覧の 1 行。記録タブとスマートフォルダで共有する。
 * 右側カラム（rowRight）の内容は呼び出し側が ReactNode として渡す。
 */
export function RecordRow({
  row,
  onPress,
  rowRight,
  background,
}: {
  row: RecordListRow;
  onPress: () => void;
  /** 右側カラムに描画する要素。画面ごとの主表示（スコア／差分／更新日／オプション等）を渡す。 */
  rowRight?: React.ReactNode;
  /**
   * 指定時はジャンル背景の代わりに、この対角グラデーション（colors / 任意 locations）を背景に使う。
   * 「王冠とスコアが異なる曲」フォルダなどでクラウンの金属光沢グラデを出す用途。
   */
  background?: { colors: readonly string[]; locations?: readonly number[] };
}) {
  // 背景色：background 未指定時のジャンル背景（対角分割 or 単色）。
  const { color1, color2, isDual } = resolveGenreColors(row.genre_ids);

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
        </View>

        <View style={styles.rowRight}>{rowRight}</View>
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
});
