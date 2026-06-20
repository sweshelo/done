import { shareAsync } from 'expo-sharing';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { captureRef } from 'react-native-view-shot';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { TodayDiffView } from '@/components/TodayDiffView';
import { Spacing } from '@/constants/theme';
import { getTodayDiffs, type TodayDiffRow } from '@/db';

/** ローカル時間の今日 0:00 のエポック ms。 */
export function startOfToday(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

interface Props {
  /** 今日の起点（通常 startOfToday()）。これ以降に更新された自分の記録を差分対象にする。 */
  sinceMs: number;
  onClose: () => void;
}

export function TodayDiffModal({ sinceMs, onClose }: Props) {
  const db = useSQLiteContext();
  // TodayDiffView のルート View を直接キャプチャ（リサイズなし＝ネイティブ解像度・全高）
  const viewRef = useRef<View>(null);
  const [rows, setRows] = useState<TodayDiffRow[]>([]);
  const [sharing, setSharing] = useState(false);
  // モーダルが確保した表示領域を onLayout で実測してカード幅を算出する
  const [previewWidth, setPreviewWidth] = useState(0);

  const cardWidth = Math.floor(previewWidth);
  const dateLabel = new Date(sinceMs).toLocaleDateString('ja-JP');

  useEffect(() => {
    getTodayDiffs(db, sinceMs).then(setRows);
  }, [db, sinceMs]);

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
      await shareAsync(uri, { mimeType: 'image/png', dialogTitle: '今日の差分' });
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
              今日の差分
            </ThemedText>
            <Pressable
              style={[styles.shareBtn, (sharing || rows.length === 0) && styles.shareBtnDisabled]}
              onPress={handleShare}
              disabled={sharing || rows.length === 0}
            >
              <ThemedText type="smallBold" style={styles.shareBtnText}>
                {sharing ? '処理中…' : '共有'}
              </ThemedText>
            </Pressable>
            <Pressable onPress={onClose} style={styles.closeBtn}>
              <ThemedText type="smallBold">✕</ThemedText>
            </Pressable>
          </View>

          {rows.length === 0 ? (
            <ThemedText type="small" themeColor="textSecondary" style={styles.empty}>
              本日の更新はありません。
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
  empty: {
    padding: Spacing.three,
    textAlign: 'center',
  },
  previewScroll: { flex: 1 },
  previewContent: { alignItems: 'center' },
});
