import { useSQLiteContext } from 'expo-sqlite';
import { openBrowserAsync } from 'expo-web-browser';
import { useEffect, useState } from 'react';
import {
  Alert,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';

import { AdBanner } from '@/components/ads/AdBanner';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import {
  ClassImages,
  ClassLabels,
  CrownColors,
  CrownImages,
  LevelColors,
  LevelLabels,
} from '@/constants/taiko-colors';
import { Spacing } from '@/constants/theme';
import { addSongToFolder, getFoldersForSong, listManualFolders, removeSongFromFolder } from '@/db';
import type { ManualFolderRow } from '@/db/folders';
import { useTheme } from '@/hooks/use-theme';
import { SELF_TAIKO_NO, type Class, type Crown, type Level } from '@/types';

interface DetailRow {
  id: number;
  song_title: string | null;
  level: Level;
  crown: Crown;
  class: Class;
  // 王冠のみ行（ライバルのスコア欠落）では score 系列が NULL になりうる
  score_total: number | null;
  good: number | null;
  ok: number | null;
  ng: number | null;
  combo: number | null;
  pound: number | null;
  updated_at: number;
  star: number | null;
  tier: string | null;
  total_notes: number | null;
  achievement: number | null;
  base_score: number | null;
}

interface PlayerScoreRow {
  taiko_no: string;
  name: string;
  score_total: number;
  crown: Crown;
  class: Class;
  good: number | null;
  ok: number | null;
  ng: number | null;
}

interface Props {
  songNumber: number;
  level: Level;
  /** 閲覧プレイヤーの太鼓番（自分=''） */
  taikoNo: string;
  onClose: () => void;
}

function formatDate(updatedAt: number): string {
  if (updatedAt === 0) return '初期化';
  return new Date(updatedAt).toLocaleDateString('ja-JP');
}

export function RecordDetailModal({ songNumber, level, taikoNo, onClose }: Props) {
  const db = useSQLiteContext();
  const theme = useTheme();
  const [history, setHistory] = useState<DetailRow[]>([]);
  const [compareScores, setCompareScores] = useState<PlayerScoreRow[]>([]);
  const [selectedPlayer, setSelectedPlayer] = useState<string | null>(null);

  // 手動フォルダへの登録（曲単位）。自分の閲覧時のみ表示する。
  const [manualFolders, setManualFolders] = useState<ManualFolderRow[]>([]);
  const [songFolderIds, setSongFolderIds] = useState<Set<number>>(new Set());

  useEffect(() => {
    db.getAllAsync<DetailRow>(
      `SELECT r.id, s.title AS song_title, r.level, r.crown, r.class,
              r.score_total, r.good, r.ok, r.ng, r.combo, r.pound, r.updated_at,
              lv.star, lv.tier,
              (r.good + r.ok + r.ng) AS total_notes,
              CASE WHEN (r.good + r.ok + r.ng) > 0
                   THEN CAST(r.good AS REAL) / (r.good + r.ok + r.ng)
                   ELSE 0 END AS achievement,
              (r.score_total - r.pound * 100) AS base_score
       FROM records r
       JOIN songs s ON s.number = r.song_number
       LEFT JOIN charts lv ON lv.song_number = r.song_number AND lv.level = r.level
       WHERE r.taiko_no = ? AND r.song_number = ? AND r.level = ?
       ORDER BY r.updated_at ASC`,
      taikoNo,
      songNumber,
      level,
    ).then(setHistory);
  }, [db, taikoNo, songNumber, level]);

  // 比較用に全プレイヤー（自分＋ライバル）の最新スコア（スコア入り行）を取得する。
  // 表示中の本人もここに含まれ、描画時に強調表示する。
  useEffect(() => {
    db.getAllAsync<PlayerScoreRow>(
      `SELECT r.taiko_no, p.name, r.score_total, r.crown, r.class, r.good, r.ok, r.ng
       FROM records r
       JOIN players p ON p.taiko_no = r.taiko_no
       JOIN (
         SELECT taiko_no, MAX(updated_at) AS mx FROM records
         WHERE song_number = ? AND level = ? AND score_total IS NOT NULL
         GROUP BY taiko_no
       ) m ON m.taiko_no = r.taiko_no AND m.mx = r.updated_at
       WHERE r.song_number = ? AND r.level = ? AND r.score_total IS NOT NULL
       ORDER BY r.score_total DESC`,
      songNumber,
      level,
      songNumber,
      level,
    ).then((rows) => {
      setCompareScores(rows);
      setSelectedPlayer(null);
    });
  }, [db, songNumber, level]);

  // 手動フォルダ一覧と、この曲が属するフォルダを読み込む（自分の閲覧時のみ）。
  // ライバル閲覧時は読み込まず、描画側で taikoNo を見て非表示にする。
  useEffect(() => {
    if (taikoNo !== SELF_TAIKO_NO) return;
    void Promise.all([listManualFolders(db), getFoldersForSong(db, songNumber)]).then(
      ([folders, ids]) => {
        setManualFolders(folders);
        setSongFolderIds(new Set(ids));
      },
    );
  }, [db, taikoNo, songNumber]);

  const toggleFolder = (folderId: number) => {
    const member = songFolderIds.has(folderId);
    // 楽観更新してから DB を反映する
    setSongFolderIds((prev) => {
      const next = new Set(prev);
      if (member) next.delete(folderId);
      else next.add(folderId);
      return next;
    });
    void (member
      ? removeSongFromFolder(db, folderId, songNumber)
      : addSongToFolder(db, folderId, songNumber));
  };

  const sendChallenge = (rivalTaikoNo: string, name: string) => {
    Alert.alert('挑戦状', `${name} に挑戦状を送りますか？`, [
      { text: 'キャンセル', style: 'cancel' },
      {
        text: '送る',
        onPress: () => {
          void openBrowserAsync(
            `https://donderhiroba.jp/challenge_form.php?song_no=${songNumber}&taiko_no=${rivalTaikoNo}`,
          );
        },
      },
    ]);
  };

  if (history.length === 0) return null;

  // 最新行（＝最新の王冠/極マーク）。スコア数値は最新の「スコア入り」行から取る。
  const latest = history[history.length - 1];
  const scoredHistory = history.filter((r) => r.score_total != null);
  const latestScored = scoredHistory.length > 0 ? scoredHistory[scoredHistory.length - 1] : null;
  const achievePct =
    latestScored && latestScored.total_notes != null && latestScored.total_notes > 0
      ? ((latestScored.achievement ?? 0) * 100).toFixed(2)
      : '—';

  // 比較棒グラフ。表示中の本人(taikoNo)のスコアを基準(差の基準)に、全員を同じ最大値で正規化。
  const viewedScore = latestScored?.score_total ?? null;
  const compareMax = Math.max(...compareScores.map((r) => r.score_total), 1);
  // 本人以外に1人でも比較対象がいれば表示する。
  const showRivalCompare = compareScores.some((r) => r.taiko_no !== taikoNo);

  return (
    <Modal transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <ThemedView type="backgroundElement" style={styles.sheet}>
        {/* ヘッダー */}
        <View style={styles.header}>
          <View style={[styles.courseBar, { backgroundColor: LevelColors[latest.level] }]} />
          <View style={styles.headerText}>
            <ThemedText type="smallBold" numberOfLines={1}>
              {latest.song_title ?? `#${songNumber}`}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {LevelLabels[latest.level]}
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
                {latestScored ? latestScored.score_total!.toLocaleString() : '—'}
              </ThemedText>
            </View>

            <View style={styles.statsGrid}>
              <Stat label="良" value={latestScored ? String(latestScored.good) : '—'} />
              <Stat label="可" value={latestScored ? String(latestScored.ok) : '—'} />
              <Stat label="不可" value={latestScored ? String(latestScored.ng) : '—'} />
              <Stat label="最大コンボ" value={latestScored ? String(latestScored.combo) : '—'} />
              <Stat
                label="連打数"
                value={
                  latestScored
                    ? `${latestScored.pound} (+ ${((latestScored.pound ?? 0) * 100).toLocaleString()})`
                    : '—'
                }
              />
              <Stat label="極スコア" value={ClassLabels[latest.class]} />
              <Stat label="達成率" value={achievePct !== '—' ? `${achievePct}%` : '—'} />
              <Stat label="素点" value={latestScored?.base_score != null ? latestScored.base_score.toLocaleString() : '—'} />
              <Stat label="取得日" value={formatDate(latest.updated_at)} />
            </View>
          </View>

          {/* 手動フォルダへの登録（自分の閲覧時のみ） */}
          {taikoNo === SELF_TAIKO_NO && manualFolders.length > 0 && (
            <View style={styles.section}>
              <ThemedText type="small" themeColor="textSecondary" style={styles.sectionLabel}>
                フォルダ
              </ThemedText>
              <View style={styles.folderChipRow}>
                {manualFolders.map((f) => {
                  const member = songFolderIds.has(f.id);
                  return (
                    <Pressable
                      key={f.id}
                      onPress={() => toggleFolder(f.id)}
                      style={[
                        styles.folderChip,
                        { backgroundColor: theme.backgroundSelected },
                        member && styles.folderChipActive,
                      ]}
                    >
                      <ThemedText
                        type="small"
                        style={member ? styles.folderChipActiveText : undefined}
                      >
                        {member ? '✓ ' : ''}
                        {f.name}
                      </ThemedText>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          )}

          {/* 成長グラフ（履歴2件以上で表示。折れ線はスコア入り2件以上のとき描画） */}
          {history.length >= 2 && (
            <View style={styles.section}>
              <ThemedText type="small" themeColor="textSecondary" style={styles.sectionLabel}>
                スコア推移
              </ThemedText>
              {scoredHistory.length >= 2 ? (
                <ScoreLineChart rows={scoredHistory} />
              ) : (
                // スコア入りが足りずグラフを描けないときは、その領域を広告に充てる
                <AdBanner />
              )}

              {/* 履歴一覧 */}
              <View style={styles.historyList}>
                {[...history].reverse().map((r) => {
                  const pct =
                    r.total_notes != null && r.total_notes > 0
                      ? ((r.achievement ?? 0) * 100).toFixed(2)
                      : '—';
                  return (
                    <View key={r.id} style={[styles.historyRow, { borderColor: theme.text + '22' }]}>
                      <ThemedText type="small" themeColor="textSecondary" style={styles.historyDate}>
                        {formatDate(r.updated_at)}
                      </ThemedText>
                      <ThemedText type="smallBold">
                        {r.score_total != null ? r.score_total.toLocaleString() : '—'}
                      </ThemedText>
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

          {/* スコア比較（自分＋ライバル。表示中の本人を強調、ライバルには挑戦状） */}
          {showRivalCompare && (
            <View style={styles.section}>
              <ThemedText type="small" themeColor="textSecondary" style={styles.sectionLabel}>
                スコア比較
              </ThemedText>

              {compareScores.map((r) => {
                const isSelf = r.taiko_no === SELF_TAIKO_NO;
                const isViewed = r.taiko_no === taikoNo;
                const label = isSelf ? '自分' : r.name;
                const notes = (r.good ?? 0) + (r.ok ?? 0) + (r.ng ?? 0);
                const pct = notes > 0 ? (((r.good ?? 0) / notes) * 100).toFixed(2) : null;
                const diff = viewedScore != null && !isViewed ? r.score_total - viewedScore : null;
                const open = selectedPlayer === r.taiko_no;
                return (
                  <View key={r.taiko_no}>
                    <Pressable
                      style={styles.compareRow}
                      onPress={() => setSelectedPlayer((cur) => (cur === r.taiko_no ? null : r.taiko_no))}
                    >
                      <ThemedText
                        type={isViewed ? 'smallBold' : 'small'}
                        style={styles.compareName}
                        numberOfLines={1}
                      >
                        {label}
                      </ThemedText>
                      <View style={styles.compareBarTrack}>
                        <View
                          style={[
                            styles.compareBar,
                            isViewed && styles.compareBarSelf,
                            { width: `${(r.score_total / compareMax) * 100}%`, backgroundColor: CrownColors[r.crown] },
                          ]}
                        />
                      </View>
                      <ThemedText type="smallBold" style={styles.compareScore}>
                        {r.score_total.toLocaleString()}
                      </ThemedText>
                    </Pressable>

                    {open && (
                      <ThemedView type="background" style={styles.compareChip}>
                        <View style={styles.compareChipInfo}>
                          {CrownImages[r.crown] && (
                            <Image source={CrownImages[r.crown]} style={styles.historyIcon} resizeMode="contain" />
                          )}
                          <ThemedText type="small" themeColor="textSecondary">
                            {r.score_total.toLocaleString()}
                            {pct ? ` / ${pct}%` : ''}
                            {diff != null
                              ? `  (本人比 ${diff >= 0 ? '+' : ''}${diff.toLocaleString()})`
                              : ''}
                          </ThemedText>
                        </View>
                        {!isSelf && (
                          <Pressable
                            style={[styles.challengeBtn, { backgroundColor: theme.backgroundSelected }]}
                            onPress={() => sendChallenge(r.taiko_no, r.name)}
                          >
                            <ThemedText type="smallBold">挑戦状</ThemedText>
                          </Pressable>
                        )}
                      </ThemedView>
                    )}
                  </View>
                );
              })}
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

const CHART_HEIGHT = 76;
const CHART_PAD_X = 12;
const CHART_PAD_Y = 14;
const NODE_TOUCH = 16;
const TOOLTIP_WIDTH = 132;

/**
 * スコア推移の折れ線グラフ。ノード(プレイ時点)タップでその時点のツールチップを表示する。
 * react-native-svg を使わず素の View で線分を回転配置して描画する。
 */
function ScoreLineChart({ rows }: { rows: DetailRow[] }) {
  const theme = useTheme();
  const [width, setWidth] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);

  const accent = theme.text === '#ffffff' ? '#e94560' : '#c0392b';
  const n = rows.length;
  const scores = rows.map((r) => r.score_total ?? 0);
  const min = Math.min(...scores);
  const max = Math.max(...scores);
  const usableW = Math.max(width - CHART_PAD_X * 2, 0);
  const usableH = CHART_HEIGHT - CHART_PAD_Y * 2;

  const points = rows.map((r, i) => {
    const x = CHART_PAD_X + (n <= 1 ? usableW / 2 : (i / (n - 1)) * usableW);
    const y =
      max === min
        ? CHART_PAD_Y + usableH / 2
        : CHART_PAD_Y + (1 - ((r.score_total ?? 0) - min) / (max - min)) * usableH;
    return { x, y };
  });

  return (
    <View style={styles.chart} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      {width > 0 && (
        <>
          {/* 線分: 隣接2点を結ぶ細い View を回転配置 */}
          {points.slice(0, -1).map((p, i) => {
            const q = points[i + 1];
            const dx = q.x - p.x;
            const dy = q.y - p.y;
            const len = Math.hypot(dx, dy);
            const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
            return (
              <View
                key={`seg-${rows[i].id}`}
                style={[
                  styles.line,
                  {
                    width: len,
                    left: (p.x + q.x) / 2 - len / 2,
                    top: (p.y + q.y) / 2 - 1,
                    backgroundColor: accent,
                    transform: [{ rotate: `${angle}deg` }],
                  },
                ]}
              />
            );
          })}

          {/* ノード */}
          {points.map((p, i) => (
            <Pressable
              key={rows[i].id}
              onPress={() => setSelected((s) => (s === i ? null : i))}
              style={[styles.nodeTouch, { left: p.x - NODE_TOUCH / 2, top: p.y - NODE_TOUCH / 2 }]}
              hitSlop={6}
            >
              <View
                style={[
                  styles.nodeDot,
                  { borderColor: accent },
                  selected === i && { backgroundColor: accent },
                ]}
              />
            </Pressable>
          ))}

          {/* ツールチップ */}
          {selected != null && (
            <ChartTooltip row={rows[selected]} x={points[selected].x} y={points[selected].y} width={width} />
          )}
        </>
      )}
    </View>
  );
}

function ChartTooltip({ row, x, y, width }: { row: DetailRow; x: number; y: number; width: number }) {
  const pct =
    row.total_notes != null && row.total_notes > 0 ? ((row.achievement ?? 0) * 100).toFixed(2) : null;
  const left = Math.min(Math.max(x - TOOLTIP_WIDTH / 2, 0), Math.max(width - TOOLTIP_WIDTH, 0));
  const above = y > 40;
  const top = above ? y - 44 : y + 14;
  return (
    <ThemedView type="background" style={[styles.tooltip, { left, top, width: TOOLTIP_WIDTH }]}>
      <View style={styles.tooltipHeader}>
        <ThemedText type="small" themeColor="textSecondary">
          {formatDate(row.updated_at)}
        </ThemedText>
        {CrownImages[row.crown] && (
          <Image source={CrownImages[row.crown]} style={styles.tooltipCrown} resizeMode="contain" />
        )}
      </View>
      <ThemedText type="smallBold">
        {row.score_total != null ? row.score_total.toLocaleString() : '—'}
      </ThemedText>
      {pct && (
        <ThemedText type="small" themeColor="textSecondary">
          達成率 {pct}%
        </ThemedText>
      )}
    </ThemedView>
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
    height: CHART_HEIGHT,
    position: 'relative',
  },
  line: {
    position: 'absolute',
    height: 2,
    borderRadius: 1,
  },
  nodeTouch: {
    position: 'absolute',
    width: NODE_TOUCH,
    height: NODE_TOUCH,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nodeDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
    borderWidth: 2,
    backgroundColor: 'transparent',
  },
  tooltip: {
    position: 'absolute',
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one,
    borderRadius: Spacing.two,
    gap: 1,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
    zIndex: 10,
  },
  tooltipHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.one,
  },
  tooltipCrown: { width: 16, height: 16 },

  compareRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.half,
  },
  compareName: { width: 64 },
  compareBarTrack: {
    flex: 1,
    height: 14,
    borderRadius: 4,
    backgroundColor: '#8b8b8b22',
    overflow: 'hidden',
    justifyContent: 'center',
  },
  compareBar: {
    height: 14,
    borderRadius: 4,
    minWidth: 2,
  },
  compareBarSelf: {
    borderWidth: 1.5,
    borderColor: '#ffffff66',
  },
  compareScore: { width: 72, textAlign: 'right' },
  compareChip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one,
    borderRadius: Spacing.two,
    marginBottom: Spacing.one,
  },
  compareChipInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    flex: 1,
  },
  challengeBtn: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one,
    borderRadius: Spacing.two,
  },

  folderChipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.one },
  folderChip: {
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one,
    borderRadius: 12,
  },
  folderChipActive: { backgroundColor: '#e94560' },
  folderChipActiveText: { color: '#fff' },

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
