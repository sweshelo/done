import { shareAsync } from 'expo-sharing';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { captureRef } from 'react-native-view-shot';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { TodayDiffView } from '@/components/TodayDiffView';
import { Spacing } from '@/constants/theme';
import { getDiffsInRange, getScoreUpdateDays, type ScoreUpdateDay, type TodayDiffRow } from '@/db';
import { useTheme } from '@/hooks/use-theme';
import { SELF_TAIKO_NO } from '@/types';

/** ローカル時間の今日 0:00 のエポック ms。 */
export function startOfToday(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** ローカル時間の翌日 0:00 のエポック ms（今日の差分の排他的上限）。 */
export function startOfTomorrow(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 1);
  return d.getTime();
}

/** エポック ms → ローカル 'YYYY-MM-DD'。 */
function ymd(ms: number): string {
  const d = new Date(ms);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

/** エポック ms → 'M月D日'。 */
function mdLabel(ms: number): string {
  const d = new Date(ms);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

/** エポック ms → 'M/D'（チップ用の短縮表記）。 */
function mdShort(ms: number): string {
  const d = new Date(ms);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

interface DayOption {
  startMs: number;
  endMs: number;
  day: string;
}

interface Props {
  /** 差分の対象プレイヤー。既定=自分。自分以外では共有ボタンを隠す。 */
  taikoNo?: string;
  onClose: () => void;
}

export function TodayDiffModal({ taikoNo = SELF_TAIKO_NO, onClose }: Props) {
  const db = useSQLiteContext();
  const theme = useTheme();
  // 他プレイヤーの差分は共有不可（他人のスコアを誤って共有しないため）。
  const canShare = taikoNo === SELF_TAIKO_NO;
  // TodayDiffView のルート View を直接キャプチャ（リサイズなし＝ネイティブ解像度・全高）
  const viewRef = useRef<View>(null);
  const [days, setDays] = useState<ScoreUpdateDay[]>([]);
  // 既定は今日（従来通り）。チップで過去のスコア更新日に切り替えられる。
  const [selected, setSelected] = useState<DayOption>(() => {
    const start = startOfToday();
    return { startMs: start, endMs: startOfTomorrow(), day: ymd(start) };
  });
  const [rows, setRows] = useState<TodayDiffRow[]>([]);
  const [sharing, setSharing] = useState(false);
  // モーダルが確保した表示領域を onLayout で実測してカード幅を算出する
  const [previewWidth, setPreviewWidth] = useState(0);

  const cardWidth = Math.floor(previewWidth);
  const dateLabel = mdLabel(selected.startMs);

  useEffect(() => {
    getScoreUpdateDays(db, taikoNo).then(setDays);
  }, [db, taikoNo]);

  useEffect(() => {
    getDiffsInRange(db, selected.startMs, selected.endMs, taikoNo).then(setRows);
  }, [db, selected.startMs, selected.endMs, taikoNo]);

  // チップ一覧：スコア更新日（新しい順）。今日が含まれなければ先頭に補完し常に選択可能にする。
  const todayKey = ymd(startOfToday());
  const options = useMemo<DayOption[]>(() => {
    const opts: DayOption[] = days.map((d) => ({ startMs: d.startMs, endMs: d.endMs, day: d.day }));
    if (!opts.some((o) => o.day === todayKey)) {
      opts.unshift({ startMs: startOfToday(), endMs: startOfTomorrow(), day: todayKey });
    }
    return opts;
  }, [days, todayKey]);

  const handleShare = async () => {
    if (!viewRef.current || sharing) return;
    setSharing(true);
    try {
      // 固定 View をリサイズせず直接キャプチャ → ネイティブ解像度・全高で高画質出力
      const uri = await captureRef(viewRef, {
        format: 'png',
        quality: 1,
        result: 'tmpfile',
      });
      await shareAsync(uri, { mimeType: 'image/png', dialogTitle: `${dateLabel}の差分` });
    } finally {
      setSharing(false);
    }
  };

  return (
    <Modal transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <ThemedView type="backgroundElement" style={styles.sheet}>
          <View style={styles.header}>
            <ThemedText type="smallBold" style={styles.title}>
              {dateLabel}の差分
            </ThemedText>
            {canShare && (
              <Pressable
                style={[styles.shareBtn, (sharing || rows.length === 0) && styles.shareBtnDisabled]}
                onPress={handleShare}
                disabled={sharing || rows.length === 0}
              >
                <ThemedText type="smallBold" style={styles.shareBtnText}>
                  {sharing ? '処理中…' : '共有'}
                </ThemedText>
              </Pressable>
            )}
            <Pressable onPress={onClose} style={styles.closeBtn}>
              <ThemedText type="smallBold">✕</ThemedText>
            </Pressable>
          </View>

          {/* 日付チップ（スコア更新日から選択） */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.chipScroll}
            contentContainerStyle={styles.chipRow}
          >
            {options.map((opt) => {
              const active = opt.day === selected.day;
              return (
                <Pressable
                  key={opt.day}
                  onPress={() => setSelected(opt)}
                  style={[
                    styles.chip,
                    { backgroundColor: theme.backgroundSelected },
                    active && styles.chipActive,
                  ]}
                >
                  <ThemedText
                    type="small"
                    style={active ? styles.chipActiveText : undefined}
                  >
                    {opt.day === todayKey ? '今日' : mdShort(opt.startMs)}
                  </ThemedText>
                </Pressable>
              );
            })}
          </ScrollView>

          {rows.length === 0 ? (
            <ThemedText type="small" themeColor="textSecondary" style={styles.empty}>
              {dateLabel}の更新はありません。
            </ThemedText>
          ) : (
            // 縦スクロールプレビュー。キャプチャ対象は内側の TodayDiffView（viewRef）
            <ScrollView
              style={styles.previewScroll}
              contentContainerStyle={styles.previewContent}
              onLayout={(e) => setPreviewWidth(e.nativeEvent.layout.width)}
            >
              {cardWidth > 0 && (
                <TodayDiffView ref={viewRef} rows={rows} dateLabel={dateLabel} width={cardWidth} />
              )}
            </ScrollView>
          )}
        </ThemedView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  sheet: {
    flex: 1,
    maxHeight: '92%',
    borderTopLeftRadius: Spacing.three,
    borderTopRightRadius: Spacing.three,
    paddingBottom: Spacing.four,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: Spacing.three,
    paddingBottom: Spacing.two,
    gap: Spacing.two,
  },
  title: { flex: 1 },
  shareBtn: {
    backgroundColor: '#e94560',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.two,
  },
  shareBtnDisabled: { opacity: 0.4 },
  shareBtnText: { color: '#fff' },
  closeBtn: {
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one,
  },
  chipScroll: { flexGrow: 0 },
  chipRow: {
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.two,
    gap: Spacing.two,
  },
  chip: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one,
    borderRadius: 14,
  },
  chipActive: { backgroundColor: '#e94560' },
  chipActiveText: { color: '#fff' },
  empty: {
    padding: Spacing.three,
    textAlign: 'center',
  },
  previewScroll: { flex: 1 },
  previewContent: { alignItems: 'center' },
});
