import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useRef, useState } from 'react';
import { BackHandler, Modal, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView, type WebViewMessageEvent, type WebViewNavigation } from 'react-native-webview';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { TodayDiffModal, startOfToday, startOfTomorrow } from '@/components/TodayDiffModal';
import {
  DIFFICULTY_KEYS,
  DifficultyFilter,
  toLevels,
  type DifficultyKey,
} from '@/components/ui/DifficultyFilter';
import { Spacing } from '@/constants/theme';
import {
  addPlayer,
  getMeta,
  getDiffsInRange,
  listPlayers,
  removePlayer,
  resolveTargetsByTitle,
  saveGenres,
  saveRecords,
  saveSongCatalog,
  setMeta,
  SELF_TAIKO_NO_KEY,
} from '@/db';
import { useTheme } from '@/hooks/use-theme';
import { genreTitle } from '@/scrape/genres';
import { INJECT_SCRIPT } from '@/scrape/inject-script';
import type { ScrapeMessage, Target } from '@/scrape/messages';
import { SELF_TAIKO_NO, type Level, type Player } from '@/types';

// UA は固定しない。強制デスクトップ UA は donderhiroba の PC ログインフローを誘発し、
// モバイルでのカード選択完了が /login.php に誤誘導される原因になる（DESIGN.md §5.2）。
const START_URL = 'https://donderhiroba.jp/index.php';

// index.php の .detail テキスト（例「太鼓番：12345678」）から自分の太鼓番を読み取り
// RN へ通知する小スクリプト。バックスラッシュを使わない正規表現で注入エスケープを回避。
const CAPTURE_SELF_SCRIPT = `(function(){try{var el=document.querySelector('.detail');var t=el?el.textContent:'';var m=t.match(/太鼓番[：:　 ]*([0-9]+)/);if(m){window.ReactNativeWebView.postMessage(JSON.stringify({type:'selfTaikoNo',taikoNo:m[1]}));}}catch(e){}})();true;`;

interface DoneConfig {
  retryTargets?: Target[];
  concurrency?: number;
  /** 取得対象難易度。未指定(undefined)の場合は全難易度を取得する。 */
  difficulties?: Level[];
  /** 取得対象ユーザーの太鼓番。空/未指定=自分。 */
  taikoNo?: string;
  /** 最近プレイ履歴から取得する曲数。 */
  recentSongCount?: number;
}

interface Progress {
  phase: 'catalog' | 'detail' | 'update';
  message: string;
  current: number;
  total: number;
}

export default function CollectScreen() {
  const db = useSQLiteContext();
  const theme = useTheme();
  const webRef = useRef<WebView>(null);

  const [loggedIn, setLoggedIn] = useState<boolean | null>(null);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [status, setStatus] = useState('読み込み中…');
  const [failed, setFailed] = useState<Target[]>([]);
  const [selectedDifficulties, setSelectedDifficulties] =
    useState<DifficultyKey[]>(['ONI']);
  const [isEmpty, setIsEmpty] = useState(false);
  const [showInitMsg, setShowInitMsg] = useState(false);
  const initMsgTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ---- 取込対象プレイヤー（自分 / ライバル） ----
  const [players, setPlayers] = useState<Player[]>([]);
  const [selectedTaikoNo, setSelectedTaikoNo] = useState<string>(SELF_TAIKO_NO);
  // 取得開始時の対象太鼓番を確定し、complete 受信時の保存先に使う
  const importTaikoNoRef = useRef<string>(SELF_TAIKO_NO);

  // 自分の実太鼓番（index.php から自動取得）と、表示中 URL の taiko_no。
  // 「表示中 URL の taiko_no が自分以外」のときだけライバル登録ボタンを出すために使う。
  const [selfTaikoNo, setSelfTaikoNo] = useState<string>('');
  const [currentUrlTaikoNo, setCurrentUrlTaikoNo] = useState<string>('');

  // ---- ライバル追加モーダル ----
  const [showAddRival, setShowAddRival] = useState(false);
  const [rivalTaikoNo, setRivalTaikoNo] = useState('');
  const [rivalName, setRivalName] = useState('');

  // ---- 最近のプレイ履歴から取得する曲数 ----
  const [recentCount, setRecentCount] = useState('20');

  // ---- 取得完了後に自動表示する「今日の差分」モーダル ----
  const [showTodayDiff, setShowTodayDiff] = useState(false);

  const loadPlayers = useCallback(async () => {
    const list = await listPlayers(db);
    setPlayers(list);
    setSelectedTaikoNo((cur) => (list.some((p) => p.taikoNo === cur) ? cur : SELF_TAIKO_NO));
  }, [db]);

  // マウント時にプレイヤー名簿と保存済みの自分の太鼓番を読み込む
  useEffect(() => {
    listPlayers(db).then((list) => {
      setPlayers(list);
      setSelectedTaikoNo((cur) => (list.some((p) => p.taikoNo === cur) ? cur : SELF_TAIKO_NO));
    });
    getMeta(db, SELF_TAIKO_NO_KEY).then((v) => {
      if (v) setSelfTaikoNo(v);
    });
  }, [db]);

  // 取得中フラグ。state は再描画が非同期なので、BackHandler など即時参照用に ref も持つ。
  const runningRef = useRef(false);
  const setRunningState = useCallback((v: boolean) => {
    runningRef.current = v;
    setRunning(v);
  }, []);

  // 初期化フラグ: records が空の状態で開始した取得かどうか
  const isInitialRef = useRef(false);

  // 選択中プレイヤーの records 件数を確認し、空なら初期化モードとして扱う
  useEffect(() => {
    db.getFirstAsync<{ cnt: number }>(
      'SELECT COUNT(*) AS cnt FROM records WHERE taiko_no = ?',
      selectedTaikoNo,
    ).then((row) => setIsEmpty((row?.cnt ?? 0) === 0));
  }, [db, selectedTaikoNo]);

  const showInitMessage = useCallback(() => {
    setShowInitMsg(true);
    if (initMsgTimerRef.current) clearTimeout(initMsgTimerRef.current);
    initMsgTimerRef.current = setTimeout(() => setShowInitMsg(false), 2000);
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
    // 表示中 URL の taiko_no を控える（ライバル登録ボタンの表示判定に使う）
    setCurrentUrlTaikoNo(new URLSearchParams(url.split('?')[1] ?? '').get('taiko_no') ?? '');
    if (url.includes('login.php')) {
      setLoggedIn(false);
      setStatus('この画面のブラウザを操作してドンだーひろばにログインしてください');
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
          setStatus(
            msg.phase === 'update'
              ? 'スコアを更新中…'
              : msg.phase === 'catalog'
                ? '楽曲リストを取得中…'
                : 'スコア詳細を取得中…',
          );
          break;

        case 'catalog':
          await saveGenres(db, msg.genres);
          await saveSongCatalog(db, msg.songs);
          setStatus(`カタログ保存: ${msg.songs.length} 曲`);
          break;

        case 'recentList': {
          // 履歴の曲名+難易度をローカル songs から song_no に逆引きして詳細取得へ。
          const { targets, unresolved } = await resolveTargetsByTitle(db, msg.entries);
          if (targets.length === 0) {
            setRunningState(false);
            setProgress(null);
            setStatus(
              `対象が見つかりませんでした（未解決 ${unresolved.length} 曲）。先に通常取得でカタログを取得してください。`,
            );
            break;
          }
          setStatus(
            `最近のプレイ ${msg.entries.length} 曲 → ${targets.length} 件を照会` +
              (unresolved.length ? ` / 未解決 ${unresolved.length}` : ''),
          );
          setProgress({ phase: 'detail', message: '詳細取得中…', current: 0, total: targets.length });
          inject({ retryTargets: targets, taikoNo: importTaikoNoRef.current });
          break;
        }

        case 'complete': {
          const taikoNo = msg.taikoNo ?? importTaikoNoRef.current;
          const wasInitial = isInitialRef.current;
          const inserted = await saveRecords(db, msg.records, wasInitial, taikoNo);
          if (msg.records.length > 0 && taikoNo === selectedTaikoNo) setIsEmpty(false);
          setFailed(msg.failedTargets);
          setRunningState(false);
          setProgress(null);
          setStatus(
            `完了 — ${msg.records.length} 件取得 / ${inserted} 件更新` +
              (msg.failedTargets.length ? ` / 失敗 ${msg.failedTargets.length}` : ''),
          );
          // 自分の取得（初回全件取得を除く）で当日差分があれば自動でモーダルを開く
          if (taikoNo === SELF_TAIKO_NO && !wasInitial && inserted > 0) {
            const diffs = await getDiffsInRange(db, startOfToday(), startOfTomorrow());
            if (diffs.length > 0) setShowTodayDiff(true);
          }
          break;
        }

        case 'selfTaikoNo':
          if (msg.taikoNo && msg.taikoNo !== selfTaikoNo) {
            setSelfTaikoNo(msg.taikoNo);
            await setMeta(db, SELF_TAIKO_NO_KEY, msg.taikoNo);
          }
          break;

        case 'error':
          setRunningState(false);
          setStatus(`エラー: ${msg.message}`);
          break;
      }
    },
    [db, inject, selectedTaikoNo, selfTaikoNo, setRunningState],
  );

  const start = useCallback(async () => {
    const taikoNo = selectedTaikoNo;
    importTaikoNoRef.current = taikoNo;

    // 当該プレイヤーの records が1件もない場合は初期化として全難易度を取得する
    const countRow = await db.getFirstAsync<{ cnt: number }>(
      'SELECT COUNT(*) AS cnt FROM records WHERE taiko_no = ?',
      taikoNo,
    );
    const isEmpty = (countRow?.cnt ?? 0) === 0;
    isInitialRef.current = isEmpty;

    setRunningState(true);
    setFailed([]);
    setProgress({ phase: 'catalog', message: '開始…', current: 0, total: 0 });

    if (isEmpty) {
      setStatus('初回初期化のため全難易度を取得します');
      inject({ taikoNo });
    } else {
      const difficulties = toLevels(selectedDifficulties);
      const isAll = difficulties.length >= 5;
      inject(isAll ? { taikoNo } : { difficulties, taikoNo });
    }
  }, [db, inject, selectedDifficulties, selectedTaikoNo, setRunningState]);

  // 最近のプレイ履歴から取得（曲数指定）。詳細取得は recentList 受信後の2段目で実行される。
  const startRecent = useCallback(() => {
    const count = Math.max(1, Math.floor(Number(recentCount) || 0));
    importTaikoNoRef.current = selectedTaikoNo;
    // 履歴取得は差分更新（既存の記録に追記）。初期化フラグは立てない。
    isInitialRef.current = false;

    setRunningState(true);
    setFailed([]);
    setProgress({ phase: 'detail', message: '最近のプレイ履歴を取得中…', current: 0, total: 0 });
    setStatus('最近のプレイ履歴を取得中…');
    inject({ recentSongCount: count, taikoNo: selectedTaikoNo });
  }, [inject, recentCount, selectedTaikoNo, setRunningState]);

  const addRival = useCallback(async () => {
    const no = rivalTaikoNo.trim();
    if (!no) return;
    await addPlayer(db, no, rivalName.trim() || no);
    setRivalTaikoNo('');
    setRivalName('');
    setShowAddRival(false);
    await loadPlayers();
    setSelectedTaikoNo(no);
  }, [db, loadPlayers, rivalName, rivalTaikoNo]);

  const deleteRival = useCallback(
    async (taikoNo: string) => {
      await removePlayer(db, taikoNo);
      await loadPlayers();
    },
    [db, loadPlayers],
  );

  // 表示中ユーザー（URL の taiko_no）をライバル登録するモーダルを開く
  const openRegisterCurrent = useCallback(() => {
    setRivalTaikoNo(currentUrlTaikoNo);
    setRivalName('');
    setShowAddRival(true);
  }, [currentUrlTaikoNo]);

  // index.php 読み込み完了時に自分の太鼓番を抽出する
  const onLoadEnd = useCallback((e: { nativeEvent: { url?: string } }) => {
    if ((e.nativeEvent.url ?? '').includes('index.php')) {
      webRef.current?.injectJavaScript(CAPTURE_SELF_SCRIPT);
    }
  }, []);

  // プレイヤーチップ: 取込対象に選択しつつ、そのユーザーのプロフィールへ WebView を遷移させる
  const selectPlayer = useCallback(
    (taikoNo: string) => {
      if (runningRef.current) return;
      setSelectedTaikoNo(taikoNo);
      // 自分: 太鼓番が判明していればプロフィールへ、未判明なら index.php（そこで自動取得される）。
      const url =
        taikoNo === SELF_TAIKO_NO && !selfTaikoNo
          ? 'https://donderhiroba.jp/index.php'
          : `https://donderhiroba.jp/user_profile.php?taiko_no=${encodeURIComponent(
              taikoNo === SELF_TAIKO_NO ? selfTaikoNo : taikoNo,
            )}`;
      webRef.current?.injectJavaScript(`location.href=${JSON.stringify(url)};true;`);
    },
    [selfTaikoNo],
  );

  const retry = useCallback(() => {
    if (!failed.length) return;
    setRunningState(true);
    setProgress({ phase: 'detail', message: '再試行…', current: 0, total: failed.length });
    inject({ retryTargets: failed, taikoNo: importTaikoNoRef.current });
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

  // 表示中 URL の taiko_no が「自分以外」かつ未登録のときだけライバル登録を促す
  const canRegisterCurrent =
    !running &&
    currentUrlTaikoNo !== '' &&
    currentUrlTaikoNo !== selfTaikoNo &&
    !players.some((p) => p.taikoNo === currentUrlTaikoNo);

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

        {/* 取込対象プレイヤー（自分 / ライバル） */}
        <View style={styles.playerRow}>
          {players.map((p) => (
            <Pressable
              key={p.taikoNo || 'self'}
              onPress={() => selectPlayer(p.taikoNo)}
              onLongPress={() => p.taikoNo !== SELF_TAIKO_NO && !running && deleteRival(p.taikoNo)}
              style={[
                styles.playerChip,
                { backgroundColor: theme.backgroundSelected },
                selectedTaikoNo === p.taikoNo && styles.playerChipActive,
                running && styles.filterDisabled,
              ]}>
              <ThemedText
                type="small"
                style={selectedTaikoNo === p.taikoNo ? styles.playerChipActiveText : undefined}>
                {p.name}
              </ThemedText>
            </Pressable>
          ))}
          {canRegisterCurrent && (
            <Pressable
              onPress={openRegisterCurrent}
              style={[styles.playerChip, styles.playerChipRegister]}>
              <ThemedText type="small" style={styles.playerChipActiveText}>
                このユーザをライバルに登録
              </ThemedText>
            </Pressable>
          )}
        </View>
        {selectedTaikoNo !== SELF_TAIKO_NO && (
          <ThemedText type="small" themeColor="textSecondary">
            ライバルのスコアを取得します（太鼓番 {selectedTaikoNo}）。長押しで削除。
          </ThemedText>
        )}

        {status !== 'このスコアを取得します' && (
          <View style={styles.filterWrap}>
            <View style={[isEmpty && styles.filterDisabled]}>
              <DifficultyFilter
                selected={isEmpty ? DIFFICULTY_KEYS : selectedDifficulties}
                onChange={setSelectedDifficulties}
              />
            </View>
            {isEmpty && (
              <Pressable style={StyleSheet.absoluteFill} onPress={showInitMessage} />
            )}
          </View>
        )}
        {showInitMsg && (
          <ThemedView type="backgroundElement" style={styles.initMsgChip}>
            <ThemedText type="small">初回のデータ取得は全件を取得します</ThemedText>
          </ThemedView>
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

        {/* 最近のプレイ履歴から取得（曲数指定）。自分以外を選択中は隠す。 */}
        {selectedTaikoNo === SELF_TAIKO_NO && (
          <View style={styles.recentRow}>
            <ThemedText type="small" themeColor="textSecondary">曲数</ThemedText>
            <TextInput
              style={[styles.recentInput, { color: theme.text, borderColor: theme.textSecondary }]}
              value={recentCount}
              onChangeText={(t) => setRecentCount(t.replace(/[^0-9]/g, ''))}
              keyboardType="number-pad"
              editable={!running}
              maxLength={4}
            />
            <Button label="履歴から取得開始" disabled={!loggedIn || running} onPress={startRecent} />
          </View>
        )}
      </SafeAreaView>

      <View style={styles.webWrap}>
        <WebView
          ref={webRef}
          source={{ uri: START_URL }}
          sharedCookiesEnabled
          thirdPartyCookiesEnabled
          allowsBackForwardNavigationGestures={false}
          onNavigationStateChange={onNavigationStateChange}
          onLoadEnd={onLoadEnd}
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

      {/* ライバル追加モーダル */}
      <Modal
        visible={showAddRival}
        transparent
        animationType="fade"
        onRequestClose={() => setShowAddRival(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setShowAddRival(false)}>
          <Pressable>
            <ThemedView type="backgroundElement" style={styles.modalCard}>
              <ThemedText type="smallBold">ライバルに登録</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                太鼓番 {rivalTaikoNo} のユーザーを登録します。表示名を入力してください。
              </ThemedText>
              <TextInput
                style={[styles.modalInput, { color: theme.text, borderColor: theme.textSecondary }]}
                placeholder="表示名（任意）"
                placeholderTextColor={theme.textSecondary}
                value={rivalName}
                onChangeText={setRivalName}
                autoFocus
              />
              <View style={styles.buttonRow}>
                <Button label="登録" onPress={addRival} disabled={!rivalTaikoNo.trim()} primary />
                <Button label="キャンセル" onPress={() => setShowAddRival(false)} />
              </View>
            </ThemedView>
          </Pressable>
        </Pressable>
      </Modal>

      {/* 取得完了後に当日差分を自動表示 */}
      {showTodayDiff && (
        <TodayDiffModal onClose={() => setShowTodayDiff(false)} />
      )}
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
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={[
        styles.button,
        !primary && { backgroundColor: theme.backgroundSelected },
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
  filterWrap: { position: 'relative' },
  filterDisabled: { opacity: 0.5, pointerEvents: 'none' },
  playerRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.one, alignItems: 'center' },
  playerChip: {
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one,
    borderRadius: 12,
  },
  playerChipActive: { backgroundColor: '#e94560' },
  playerChipActiveText: { color: '#fff' },
  playerChipRegister: { backgroundColor: '#0f9d58' },
  recentRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  recentInput: {
    borderWidth: 1,
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one,
    fontSize: 14,
    minWidth: 64,
    textAlign: 'center',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.three,
  },
  modalCard: {
    borderRadius: Spacing.two,
    padding: Spacing.three,
    gap: Spacing.two,
    width: '100%',
    maxWidth: 360,
  },
  modalInput: {
    borderWidth: 1,
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one,
    fontSize: 14,
  },
  initMsgChip: {
    alignSelf: 'flex-start',
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one,
    borderRadius: 12,
  },
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
