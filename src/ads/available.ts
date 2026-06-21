import Constants, { ExecutionEnvironment } from 'expo-constants';
import { Platform } from 'react-native';

/**
 * 広告（react-native-google-mobile-ads）が使える実行環境かどうか。
 *
 * Expo Go (= StoreClient) にはネイティブ広告モジュールが含まれないため、
 * そこで広告 SDK を読み込むとクラッシュする。よって Expo Go と web では false にし、
 * 広告関連コードを「実行時に require する」ことで Expo Go では一切評価されないようにする。
 * dev client / 本番ビルドでのみ true になり、広告が表示される。
 */
export const ADS_AVAILABLE =
  Platform.OS !== 'web' &&
  Constants.executionEnvironment !== ExecutionEnvironment.StoreClient;

/**
 * 実広告は使えないが開発中なので「モック広告」を出す環境かどうか（= Expo Go の dev）。
 * これにより Expo Go 上でも広告の配置・タイミング・頻度制御・レイアウトを確認できる。
 * 実広告は描画されないので、最終確認は dev client / 実ビルドで行う。
 */
export const ADS_MOCK = !ADS_AVAILABLE && __DEV__;
