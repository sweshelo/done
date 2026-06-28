import { LinearGradient } from 'expo-linear-gradient';
import type { ReactNode } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';

/**
 * 対角（左上→右下）の線形グラデーションを敷く薄いラッパ。
 * クラウンの金属光沢グラデ（taiko-colors の CrownGradients / dualCrownGradient）を
 * フォルダ一覧エントリや TierTableView セルなどで共通描画するために使う。
 */
export function GradientFill({
  colors,
  locations,
  style,
  children,
}: {
  colors: readonly string[];
  locations?: readonly number[];
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
}) {
  // expo-linear-gradient は最低 2 色を要求するため、1 色なら複製する。
  const stops = (colors.length >= 2 ? [...colors] : [colors[0], colors[0]]) as [
    string,
    string,
    ...string[],
  ];
  const locs =
    locations && locations.length === stops.length
      ? ([...locations] as [number, number, ...number[]])
      : undefined;
  return (
    <LinearGradient
      colors={stops}
      locations={locs}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={style}
    >
      {children}
    </LinearGradient>
  );
}
