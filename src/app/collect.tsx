import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { saveGenres, saveRecords, saveSongCatalog } from '@/db';
import { INJECT_SCRIPT } from '@/scrape/inject-script';
import type { ScrapeMessage, Target } from '@/scrape/messages';

// 本家 PC 版を安定して得るためデスクトップ Chrome の UA を固定する（DESIGN.md §5.2）
const PC_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const START_URL = 'https://donderhiroba.jp/index.php';

interface DoneConfig {
  mode: 'probe' | 'scrape';
  retryTargets?: Target[];
  concurrency?: number;
}

interface Progress {
  phase: 'catalog' | 'detail';
  message: string;
  current: number;
  total: number;
}

export default function CollectScreen() {
  const db = useSQLiteContext();
  const webRef = useRef<WebView>(null);

  const [loggedIn, setLoggedIn] = useState<boolean | null>(null);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [status, setStatus] = useState('読み込み中…');
  const [failed, setFailed] = useState<Target[]>([]);

  const inject = useCallback((cfg: DoneConfig) => {
    webRef.current?.injectJavaScript(
      `window.__DONE_CONFIG__=${JSON.stringify(cfg)};\n${INJECT_SCRIPT}\ntrue;`,
    );
  }, []);

  const onLoadEnd = useCallback(
    (e: { nativeEvent: { url: string } }) => {
      // donderhiroba 上にいるときだけログイン状態をプローブする
      if (e.nativeEvent.url.includes('donderhiroba.jp') && !running) {
        inject({ mode: 'probe' });
      }
    },
    [inject, running],
  );

  const onMessage = useCallback(
    async (e: WebViewMessageEvent) => {
      let msg: ScrapeMessage;
      try {
        msg = JSON.parse(e.nativeEvent.data) as ScrapeMessage;
      } catch {
        return;
      }

      switch (msg.type) {
        case 'session':
          setLoggedIn(msg.loggedIn);
          setStatus(msg.loggedIn ? 'ログイン済み — 取得できます' : '未ログイン — ログインしてください');
          break;

        case 'progress':
          setProgress({
            phase: msg.phase,
            message: msg.message,
            current: msg.current,
            total: msg.total,
          });
          setStatus(msg.phase === 'catalog' ? '楽曲リストを取得中…' : 'スコア詳細を取得中…');
          break;

        case 'catalog':
          await saveGenres(db, msg.genres);
          await saveSongCatalog(db, msg.songs);
          setStatus(`カタログ保存: ${msg.songs.length} 曲`);
          break;

        case 'complete': {
          const inserted = await saveRecords(db, msg.records);
          setFailed(msg.failedTargets);
          setRunning(false);
          setProgress(null);
          setStatus(
            `完了 — ${msg.records.length} 件取得 / ${inserted} 件更新` +
              (msg.failedTargets.length ? ` / 失敗 ${msg.failedTargets.length}` : ''),
          );
          break;
        }

        case 'error':
          setRunning(false);
          setStatus(`エラー: ${msg.message}`);
          break;
      }
    },
    [db],
  );

  const start = useCallback(() => {
    setRunning(true);
    setFailed([]);
    setProgress({ phase: 'catalog', message: '開始…', current: 0, total: 0 });
    inject({ mode: 'scrape' });
  }, [inject]);

  const retry = useCallback(() => {
    if (!failed.length) return;
    setRunning(true);
    setProgress({ phase: 'detail', message: '再試行…', current: 0, total: failed.length });
    inject({ mode: 'scrape', retryTargets: failed });
  }, [failed, inject]);

  const pct =
    progress && progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0;

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView edges={['top']} style={styles.header}>
        <ThemedText type="smallBold">{status}</ThemedText>

        {progress && (
          <View style={styles.progressWrap}>
            <ThemedText type="small" numberOfLines={1}>
              {progress.current} / {progress.total} — {progress.message}
            </ThemedText>
            <View style={styles.barBg}>
              <View style={[styles.barFill, { width: `${pct}%` }]} />
            </View>
          </View>
        )}

        <View style={styles.buttonRow}>
          <Button label="取得開始" disabled={!loggedIn || running} onPress={start} primary />
          {failed.length > 0 && !running && (
            <Button label={`失敗 ${failed.length} 件を再試行`} onPress={retry} />
          )}
          <Button label="再読込" onPress={() => webRef.current?.reload()} disabled={running} />
        </View>
      </SafeAreaView>

      <WebView
        ref={webRef}
        source={{ uri: START_URL }}
        userAgent={PC_USER_AGENT}
        sharedCookiesEnabled
        thirdPartyCookiesEnabled
        onLoadEnd={onLoadEnd}
        onMessage={onMessage}
        style={styles.web}
      />
    </ThemedView>
  );
}

function Button({
  label,
  onPress,
  disabled,
  primary,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  primary?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={[
        styles.button,
        primary && styles.buttonPrimary,
        disabled && styles.buttonDisabled,
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
  progressWrap: { gap: Spacing.one },
  barBg: {
    height: 7,
    borderRadius: 4,
    backgroundColor: '#0f3460',
    overflow: 'hidden',
  },
  barFill: { height: '100%', borderRadius: 4, backgroundColor: '#e94560' },
  buttonRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  button: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.two,
    backgroundColor: '#F0F0F3',
  },
  buttonPrimary: { backgroundColor: '#e94560' },
  buttonPrimaryText: { color: '#fff' },
  buttonDisabled: { opacity: 0.4 },
  web: { flex: 1 },
});
