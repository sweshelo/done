import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useRef, useState } from 'react';
import { BackHandler, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView, type WebViewMessageEvent, type WebViewNavigation } from 'react-native-webview';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import {
  DifficultyFilter,
  toCourses,
  type DifficultyKey
} from '@/components/ui/DifficultyFilter';
import { Spacing } from '@/constants/theme';
import { saveGenres, saveRecords, saveSongCatalog } from '@/db';
import { genreTitle } from '@/scrape/genres';
import { INJECT_SCRIPT } from '@/scrape/inject-script';
import type { ScrapeMessage, Target } from '@/scrape/messages';
import type { Course } from '@/types';

// UA は固定しない。強制デスクトップ UA は donderhiroba の PC ログインフローを誘発し、
// モバイルでのカード選択完了が /login.php に誤誘導される原因になる（DESIGN.md §5.2）。
const START_URL = 'https://donderhiroba.jp/index.php';

interface DoneConfig {
  retryTargets?: Target[];
  concurrency?: number;
  /** 取得対象難易度。未指定(undefined)の場合は全難易度を取得する。 */
  difficulties?: Course[];
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
  const [selectedDifficulties, setSelectedDifficulties] =
    useState<DifficultyKey[]>(['ONI']);

  // 取得中フラグ。state は再描画が非同期なので、BackHandler など即時参照用に ref も持つ。
  const runningRef = useRef(false);
  const setRunningState = useCallback((v: boolean) => {
    runningRef.current = v;
    setRunning(v);
  }, []);

  // 取得中は Android の物理戻るを消費し、WebView の戻り遷移で取得が止まるのを防ぐ。
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => runningRef.current);
    return () => sub.remove();
  }, []);

  const inject = useCallback(
    (cfg: DoneConfig) => {
      webRef.current?.injectJavaScript(
        `window.__DONE_CONFIG__=${JSON.stringify(cfg)};\n${INJECT_SCRIPT}\ntrue;`,
      );
    },
    [],
  );

  // ログイン状態は「表示中 URL」で判定する。Web アクセス(probe)判定は無効 URL アクセスで
  // donderhiroba 側の強制ログアウトを誘発したため撤去（ユーザー報告）。
  //   - login.php  → 未ログイン
  //   - index.php  → ログイン済み（カード選択を含むログイン完了後の着地ページ）
  //   - それ以外/外部ドメイン(OAuth 等) → 直近の判定を維持
  const onNavigationStateChange = useCallback((navState: WebViewNavigation) => {
    if (runningRef.current) return; // 取得中はステータスを動かさない
    const url = navState.url;
    if (!url.includes('donderhiroba.jp')) return;
    if (url.includes('login.php')) {
      setLoggedIn(false);
      setStatus('未ログイン — ログインしてください');
    } else if (url.includes('index.php')) {
      setLoggedIn(true);
      setStatus('ログイン済み — 取得できます');
    } else if (url.includes('score_list.php')) {
      const qs = url.split('?')[1] ?? '';
      const genre = new URLSearchParams(qs).get('genre') ?? '1';
      setStatus(`「${genreTitle(Number(genre))}」のスコアのみを取得します`);
    } else if (url.includes('score_detail.php')) {
      setStatus('表示中楽曲のスコアを取得します');
    }
  }, []);

  const onMessage = useCallback(
    async (e: WebViewMessageEvent) => {
      let msg: ScrapeMessage;
      try {
        msg = JSON.parse(e.nativeEvent.data) as ScrapeMessage;
      } catch {
        return;
      }

      switch (msg.type) {
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
          setRunningState(false);
          setProgress(null);
          setStatus(
            `完了 — ${msg.records.length} 件取得 / ${inserted} 件更新` +
              (msg.failedTargets.length ? ` / 失敗 ${msg.failedTargets.length}` : ''),
          );
          break;
        }

        case 'error':
          setRunningState(false);
          setStatus(`エラー: ${msg.message}`);
          break;
      }
    },
    [db, setRunningState],
  );

  const start = useCallback(() => {
    setRunningState(true);
    setFailed([]);
    setProgress({ phase: 'catalog', message: '開始…', current: 0, total: 0 });
    // 全難易度選択中は difficulties を渡さない（全取得）
    const difficulties = toCourses(selectedDifficulties);
    const isAll = difficulties.length >= 5; // EASY/NORMAL/DIFFICULT/ONI/EXTRA = 5
    inject(isAll ? {} : { difficulties });
  }, [inject, selectedDifficulties, setRunningState]);

  const retry = useCallback(() => {
    if (!failed.length) return;
    setRunningState(true);
    setProgress({ phase: 'detail', message: '再試行…', current: 0, total: failed.length });
    inject({ retryTargets: failed });
  }, [failed, inject, setRunningState]);

  // 取得の破棄（中止）: 遷移ロックを解除し、WebView を reload して
  // 実行中の inject ループと未完了 fetch を破棄する。
  const cancel = useCallback(() => {
    setRunningState(false);
    setProgress(null);
    setStatus('中止しました');
    webRef.current?.reload();
  }, [setRunningState]);

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

        {status !== 'このスコアを取得します' && (
          <DifficultyFilter
            selected={selectedDifficulties}
            onChange={setSelectedDifficulties}
          />
        )}
        <View style={styles.buttonRow}>
          {running ? (
            <Button label="中止" onPress={cancel} primary />
          ) : (
            <Button label="取得開始" disabled={!loggedIn} onPress={start} primary />
          )}
          {failed.length > 0 && !running && (
            <Button label={`失敗 ${failed.length} 件を再試行`} onPress={retry} />
          )}
          <Button label="再読込" onPress={() => webRef.current?.reload()} disabled={running} />
        </View>
      </SafeAreaView>

      <View style={styles.webWrap}>
        <WebView
          ref={webRef}
          source={{ uri: START_URL }}
          sharedCookiesEnabled
          thirdPartyCookiesEnabled
          allowsBackForwardNavigationGestures={false}
          onNavigationStateChange={onNavigationStateChange}
          onMessage={onMessage}
          style={styles.web}
        />

        {/* 取得中はオーバーレイでタッチを遮断し、ユーザー操作によるページ遷移を防ぐ。
            ナビゲーションポリシーに干渉しないためログイン POST を壊さない。 */}
        {running && (
          <View style={styles.lockOverlay}>
            <ThemedText type="smallBold" style={styles.lockText}>
              取得中はページ操作できません
            </ThemedText>
          </View>
        )}
      </View>
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
  webWrap: { flex: 1 },
  web: { flex: 1 },
  lockOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.15)',
  },
  lockText: {
    color: '#fff',
    backgroundColor: 'rgba(0,0,0,0.7)',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.two,
    overflow: 'hidden',
  },
});
