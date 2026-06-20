/**
 * フォルダの曲をドンだーひろばのお気に入り（最大30曲）へ反映するモーダル。
 *
 * 自動 POST（ajax/myfavorite_song.php）はレスポンスが不正（HTML 返却）で不安定だったため、
 * song_no を付与した favorite_song_select.php?song_no_1=… へ遷移し、フォームが埋まった状態の
 * 公式ページをユーザーに表示する方式を採用。最終的な登録はページ内の登録ボタンで行ってもらう。
 *
 * WebView は取得タブと Cookie ジャーを共有する（sharedCookiesEnabled）ため、
 * ログイン済みであればそのままフォームが開く。未ログイン時はログイン後に「曲をセット」で再遷移。
 */
import { useCallback, useMemo, useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView, type WebViewNavigation } from 'react-native-webview';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

const BASE_URL = 'https://donderhiroba.jp/favorite_song_select.php';

interface Props {
  /** 反映する song_no 配列（呼び出し側で最大30に整形済み・並び順保持）。 */
  songNumbers: number[];
  folderName: string;
  onClose: () => void;
}

type Phase = 'loading' | 'login' | 'ready';

/** song_no を query に付与した favorite_song_select.php の URL を組み立てる。 */
function buildPrefilledUrl(songNumbers: number[]): string {
  const params = new URLSearchParams();
  songNumbers.forEach((no, i) => params.set(`song_no_${i + 1}`, String(no)));
  return `${BASE_URL}?${params.toString()}`;
}

export function FavoriteSyncModal({ songNumbers, folderName, onClose }: Props) {
  const webRef = useRef<WebView>(null);
  const targetUrl = useMemo(() => buildPrefilledUrl(songNumbers), [songNumbers]);
  const [phase, setPhase] = useState<Phase>('loading');

  const message =
    phase === 'login'
      ? 'ドンだーひろばにログイン後、「曲をセット」を押してください。'
      : phase === 'ready'
        ? `「${folderName}」の${songNumbers.length}曲をフォームにセットしました。ページ内の「設定」ボタンで反映してください。`
        : 'ドンだーひろばを読み込み中…';

  const onNavigationStateChange = useCallback((navState: WebViewNavigation) => {
    const url = navState.url;
    if (!url.includes('donderhiroba.jp')) return;
    setPhase(url.includes('login.php') ? 'login' : url.includes('favorite_song_select.php') ? 'ready' : 'loading');
  }, []);

  // 未ログインから復帰した場合などに、曲をセットした URL へ再遷移する。
  const reopenPrefilled = useCallback(() => {
    webRef.current?.injectJavaScript(`location.href=${JSON.stringify(targetUrl)};true;`);
  }, [targetUrl]);

  return (
    <Modal transparent animationType="slide" onRequestClose={onClose}>
      <ThemedView style={styles.container}>
        <SafeAreaView edges={['top']} style={styles.header}>
          <View style={styles.headerRow}>
            <ThemedText type="smallBold" numberOfLines={1} style={styles.headerTitle}>
              お気に入りに反映
            </ThemedText>
            <Pressable onPress={onClose} style={styles.closeBtn}>
              <ThemedText type="smallBold">閉じる</ThemedText>
            </Pressable>
          </View>

          <ThemedText type="small" themeColor="textSecondary">
            {message}
          </ThemedText>

          <View style={styles.buttonRow}>
            <Button label="曲をセット" onPress={reopenPrefilled} primary />
            <Button label="再読込" onPress={() => webRef.current?.reload()} />
          </View>
        </SafeAreaView>

        <View style={styles.webWrap}>
          <WebView
            ref={webRef}
            source={{ uri: targetUrl }}
            sharedCookiesEnabled
            thirdPartyCookiesEnabled
            onNavigationStateChange={onNavigationStateChange}
            style={styles.web}
          />
        </View>
      </ThemedView>
    </Modal>
  );
}

function Button({
  label,
  onPress,
  primary,
}: {
  label: string;
  onPress: () => void;
  primary?: boolean;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.button,
        !primary && { backgroundColor: theme.backgroundSelected },
        primary && styles.buttonPrimary,
      ]}>
      <ThemedText type="smallBold" style={primary ? styles.buttonPrimaryText : undefined}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.two,
    gap: Spacing.two,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  headerTitle: { flex: 1 },
  closeBtn: { paddingHorizontal: Spacing.two, paddingVertical: Spacing.one },
  buttonRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  button: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.two,
    backgroundColor: '#F0F0F3',
  },
  buttonPrimary: { backgroundColor: '#e94560' },
  buttonPrimaryText: { color: '#fff' },
  webWrap: { flex: 1 },
  web: { flex: 1 },
});
