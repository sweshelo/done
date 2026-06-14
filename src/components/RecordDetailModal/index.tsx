import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useState } from 'react';
import {
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import {
  ClassImages,
  ClassLabels,
  CourseColors,
  CourseLabels,
  CrownColors,
  CrownImages,
} from '@/constants/taiko-colors';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { Class, Course, Crown } from '@/types';

interface DetailRow {
  id: number;
  song_title: string | null;
  course: Course;
  crown: Crown;
  class: Class;
  score_total: number;
  good: number;
  ok: number;
  ng: number;
  combo: number;
  pound: number;
  updated_at: number;
  star: number | null;
  tier: string | null;
  total_notes: number;
  achievement: number;
  base_score: number;
}

interface Props {
  songNumber: number;
  course: Course;
  onClose: () => void;
}

function formatDate(updatedAt: number): string {
  if (updatedAt === 0) return '初期化';
  return new Date(updatedAt).toLocaleDateString('ja-JP');
}

export function RecordDetailModal({ songNumber, course, onClose }: Props) {
  const db = useSQLiteContext();
  const theme = useTheme();
  const [history, setHistory] = useState<DetailRow[]>([]);

  useEffect(() => {
    db.getAllAsync<DetailRow>(
      `SELECT r.id, s.title AS song_title, r.course, r.crown, r.class,
              r.score_total, r.good, r.ok, r.ng, r.combo, r.pound, r.updated_at,
              lv.star, lv.tier,
              (r.good + r.ok + r.ng) AS total_notes,
              CASE WHEN (r.good + r.ok + r.ng) > 0
                   THEN CAST(r.good AS REAL) / (r.good + r.ok + r.ng)
                   ELSE 0 END AS achievement,
              (r.score_total - r.pound * 100) AS base_score
       FROM records r
       JOIN songs s ON s.number = r.song_number
       LEFT JOIN levels lv ON lv.song_number = r.song_number AND lv.course = r.course
       WHERE r.song_number = ? AND r.course = ?
       ORDER BY r.updated_at ASC`,
      songNumber,
      course,
    ).then(setHistory);
  }, [db, songNumber, course]);

  if (history.length === 0) return null;

  const latest = history[history.length - 1];
  const achievePct =
    latest.total_notes > 0 ? (latest.achievement * 100).toFixed(2) : '—';
  const maxScore = Math.max(...history.map((r) => r.score_total));

  return (
    <Modal transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <ThemedView type="backgroundElement" style={styles.sheet}>
        {/* ヘッダー */}
        <View style={styles.header}>
          <View style={[styles.courseBar, { backgroundColor: CourseColors[latest.course] }]} />
          <View style={styles.headerText}>
            <ThemedText type="smallBold" numberOfLines={1}>
              {latest.song_title ?? `#${songNumber}`}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {CourseLabels[latest.course]}
              {latest.star != null ? ` ★${latest.star}` : ''}
              {latest.tier ? ` / ${latest.tier}` : ''}
            </ThemedText>
          </View>
          <Pressable onPress={onClose} style={styles.closeBtn}>
            <ThemedText type="smallBold">✕</ThemedText>
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.content}>
          {/* 最新記録 詳細 */}
          <View style={styles.section}>
            <View style={styles.detailRow}>
              {CrownImages[latest.crown] ? (
                <Image source={CrownImages[latest.crown]} style={styles.crownImg} resizeMode="contain" />
              ) : (
                <View style={[styles.crownDot, { backgroundColor: CrownColors[latest.crown] }]} />
              )}
              {ClassImages[latest.class] && (
                <Image source={ClassImages[latest.class]} style={styles.classImg} resizeMode="contain" />
              )}
              <ThemedText type="smallBold" style={styles.scoreLabel}>
                {latest.score_total.toLocaleString()}
              </ThemedText>
            </View>

            <View style={styles.statsGrid}>
              <Stat label="良" value={String(latest.good)} />
              <Stat label="可" value={String(latest.ok)} />
              <Stat label="不可" value={String(latest.ng)} />
              <Stat label="最大コンボ" value={String(latest.combo)} />
              <Stat label="連打数" value={`${latest.pound} (+ ${(latest.pound * 100).toLocaleString()})`} />
              <Stat label="極スコア" value={ClassLabels[latest.class]} />
              <Stat label="達成率" value={achievePct !== '—' ? `${achievePct}%` : '—'} />
              <Stat label="素点" value={latest.base_score.toLocaleString()} />
              <Stat label="取得日" value={formatDate(latest.updated_at)} />
            </View>
          </View>

          {/* 成長グラフ（履歴2件以上のとき） */}
          {history.length >= 2 && (
            <View style={styles.section}>
              <ThemedText type="small" themeColor="textSecondary" style={styles.sectionLabel}>
                スコア推移
              </ThemedText>
              <View style={styles.chart}>
                {history.map((r) => (
                  <View key={r.id} style={styles.barWrap}>
                    <View
                      style={[
                        styles.bar,
                        {
                          height: maxScore > 0 ? (r.score_total / maxScore) * 60 : 0,
                          backgroundColor: theme.text === '#ffffff' ? '#e94560' : '#c0392b',
                        },
                      ]}
                    />
                  </View>
                ))}
              </View>

              {/* 履歴一覧 */}
              <View style={styles.historyList}>
                {[...history].reverse().map((r) => {
                  const pct = r.total_notes > 0 ? (r.achievement * 100).toFixed(2) : '—';
                  return (
                    <View key={r.id} style={[styles.historyRow, { borderColor: theme.text + '22' }]}>
                      <ThemedText type="small" themeColor="textSecondary" style={styles.historyDate}>
                        {formatDate(r.updated_at)}
                      </ThemedText>
                      <ThemedText type="smallBold">{r.score_total.toLocaleString()}</ThemedText>
                      <ThemedText type="small" themeColor="textSecondary">
                        {pct !== '—' ? `${pct}%` : '—'}
                      </ThemedText>
                      {CrownImages[r.crown] && (
                        <Image source={CrownImages[r.crown]} style={styles.historyIcon} resizeMode="contain" />
                      )}
                    </View>
                  );
                })}
              </View>
            </View>
          )}
        </ScrollView>
      </ThemedView>
    </Modal>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <ThemedText type="small" themeColor="textSecondary">{label}</ThemedText>
      <ThemedText type="smallBold">{value}</ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  sheet: {
    borderTopLeftRadius: Spacing.three,
    borderTopRightRadius: Spacing.three,
    maxHeight: '80%',
    paddingBottom: Spacing.six,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    padding: Spacing.three,
    paddingBottom: Spacing.two,
  },
  courseBar: {
    width: 4,
    height: 36,
    borderRadius: 2,
    flexShrink: 0,
  },
  headerText: { flex: 1, gap: 2 },
  closeBtn: {
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one,
  },
  content: {
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.three,
    gap: Spacing.three,
  },
  section: { gap: Spacing.two },
  sectionLabel: { marginBottom: 2 },

  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  crownImg: { width: 28, height: 28 },
  crownDot: { width: 10, height: 10, borderRadius: 5 },
  classImg: { width: 20, height: 20 },
  scoreLabel: { fontSize: 20 },

  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  stat: {
    minWidth: '30%',
    gap: 1,
  },

  chart: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    height: 60,
    gap: 2,
  },
  barWrap: { flex: 1, justifyContent: 'flex-end', height: 60 },
  bar: { borderRadius: 2 },

  historyList: { gap: Spacing.one },
  historyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.one,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  historyDate: { flex: 1 },
  historyIcon: { width: 18, height: 18 },
});
