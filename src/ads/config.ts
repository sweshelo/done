/**
 * 広告まわりの定数。react-native-google-mobile-ads は web/Expo Go 非対応なので、
 * このファイルではライブラリを import せず純粋な定数のみを置く。
 * 実行環境の可否判定は `available.ts` の ADS_AVAILABLE に集約している。
 */

/** インタースティシャル（全画面）の最短表示間隔。連続表示はポリシー違反リスク。 */
export const INTERSTITIAL_MIN_INTERVAL_MS = 3 * 60 * 1000;

/** 記録一覧で何行ごとに広告 Row を挿入するか。 */
export const LIST_AD_INTERVAL = 20;

/**
 * 本番用の広告ユニット ID。リリース前にここを AdMob で発行した実 ID へ差し替える。
 * 開発中（__DEV__）は各 native 実装側で Google のテスト ID を使う。
 */
export const REAL_BANNER_UNIT_ID = 'ca-app-pub-1286751178536982/0000000000';
export const REAL_INTERSTITIAL_UNIT_ID = 'ca-app-pub-1286751178536982/0000000000';
