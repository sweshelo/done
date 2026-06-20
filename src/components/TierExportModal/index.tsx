import * as ScreenOrientation from 'expo-screen-orientation';
import { shareAsync } from 'expo-sharing';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { captureRef } from 'react-native-view-shot';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { TierTableView, type TierTableRow } from '@/components/TierTableView';
import { Spacing } from '@/constants/theme';
import type { Level, Crown } from '@/types';

const CELLS_PER_ROW = 10;
const CELL_GAP = 2;

interface DbRow {
  song_number: number;
  song_title: string;
  level: Level;
  tier: string;
  tier_rank: number;
  crown: Crown | null;
}

interface Props {
  /** 王冠を反映する閲覧プレイヤーの太鼓番（自分=''） */
  taikoNo: string;
  onClose: () => void;
}

export function TierExportModal({ taikoNo, onClose }: Props) {
  const db = useSQLiteContext();
  // TierTableView のルート View を直接キャプチャ（リサイズなし＝ネイティブ解像度・全高）
  const tableRef = useRef<View>(null);
  const [rows, setRows] = useState<TierTableRow[]>([]);
  const [sharing, setSharing] = useState(false);
  // useWindowDimensions はノッチ/レターボックス領域を含む物理画面幅を返すため、
  // 実際にモーダルが確保した表示領域を onLayout で実測してセル幅を算出する。
  const [previewWidth, setPreviewWidth] = useState(0);

  // 表示中のみ横画面にロックし、閉じたら portrait に戻す
  useEffect(() => {
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE);
    return () => {
      ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
    };
  }, []);

  // 実測したプレビュー幅に 10 列を fit させる（プレビュー＝キャプチャ共通）
  const containerPadding = Spacing.two;
  const cellWidth = Math.floor(
    (previewWidth - containerPadding * 2 - CELL_GAP * (CELLS_PER_ROW - 1)) / CELLS_PER_ROW,
  );
  // floor 由来の端数を含めずコンテンツ幅ちょうどに確定
  const tableWidth =
    containerPadding * 2 + cellWidth * CELLS_PER_ROW + CELL_GAP * (CELLS_PER_ROW - 1);

  useEffect(() => {
    db.getAllAsync<DbRow>(
      `SELECT s.number AS song_number, s.title AS song_title,
              lv.level, lv.tier, lv.tier_rank,
              latest.crown
       FROM charts lv
       JOIN songs s ON s.number = lv.song_number
       LEFT JOIN (
         SELECT r.song_number, r.level, r.crown
         FROM records r
         INNER JOIN (
           SELECT song_number, level, MAX(updated_at) AS mx
           FROM records WHERE taiko_no = ? GROUP BY song_number, level
         ) m ON m.song_number = r.song_number AND m.level = r.level AND m.mx = r.updated_at
         WHERE r.taiko_no = ?
       ) latest ON latest.song_number = lv.song_number AND latest.level = lv.level
       WHERE lv.star = 10 AND lv.tier IS NOT NULL
       ORDER BY lv.tier_rank ASC, lv.song_number ASC`,
      taikoNo,
      taikoNo,
    ).then((dbRows) => {
      setRows(
        dbRows.map((r) => ({
          song_number: r.song_number,
          song_title: r.song_title,
          level: r.level,
          crown: r.crown,
          tier: r.tier,
          tier_rank: r.tier_rank,
        })),
      );
    });
  }, [db, taikoNo]);

  const handleShare = async () => {
    if (!tableRef.current || sharing) return;
    setSharing(true);
    try {
      // 固定 View をリサイズせず直接キャプチャ → ネイティブ解像度・全高で高画質出力
      const uri = await captureRef(tableRef, {
        format: 'png',
        quality: 1,
        result: 'tmpfile',
      });
      await shareAsync(uri, { mimeType: 'image/png', dialogTitle: '☆10 難易度表' });
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
              ☆10 難易度表
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
              ☆10 の tier データがありません。「全良難易度」ソートで取得した後に利用できます。
            </ThemedText>
          ) : (
            // 縦スクロールプレビュー。キャプチャ対象は内側の TierTableView（tableRef）
            <ScrollView
              style={styles.previewScroll}
              contentContainerStyle={styles.previewContent}
              onLayout={(e) => setPreviewWidth(e.nativeEvent.layout.width)}
            >
              {cellWidth > 0 && (
                <TierTableView
                  ref={tableRef}
                  rows={rows}
                  cellWidth={cellWidth}
                  tableWidth={tableWidth}
                />
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
  // 端数ぶんの幅をシート両端へ均等に振り、表を中央寄せ（右側だけの余白を解消）
  previewContent: { alignItems: 'center' },
});
