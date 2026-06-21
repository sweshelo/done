import { ADS_AVAILABLE } from './available';

/**
 * 起動時に1回だけ呼ぶ広告 SDK 初期化。
 * Expo Go ではネイティブ広告モジュールが無いので、ライブラリは静的 import せず
 * ADS_AVAILABLE のときだけ require する（require しなければ評価されずクラッシュしない）。
 *
 * 1) UMP 同意（EEA/UK）。AdMob コンソールで同意フォームを設定済みなら表示される。
 * 2) iOS ATT（App Tracking Transparency）。Android では即 granted 相当。
 * 3) Mobile Ads SDK 初期化。
 * どの段階で失敗しても広告自体は出せるよう、同意/ATT は握り潰す。
 */
export async function initAds(): Promise<void> {
  if (!ADS_AVAILABLE) return;

  /* eslint-disable @typescript-eslint/no-require-imports -- Expo Go で評価させないため遅延 require */
  const mobileAds = require('react-native-google-mobile-ads').default;
  const { AdsConsent } = require('react-native-google-mobile-ads');
  const { requestTrackingPermissionsAsync } = require('expo-tracking-transparency');
  /* eslint-enable @typescript-eslint/no-require-imports */

  try {
    await AdsConsent.gatherConsent();
  } catch {
    // 同意取得に失敗してもフォールバック（非パーソナライズ）で広告は出す
  }

  try {
    await requestTrackingPermissionsAsync();
  } catch {
    // ATT 不可環境でも続行
  }

  try {
    await mobileAds().initialize();
  } catch {
    // 初期化失敗時は各広告コンポーネント側が描画されないだけ
  }
}
