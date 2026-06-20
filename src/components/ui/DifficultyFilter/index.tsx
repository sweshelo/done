/**
 * 難易度チェックボックスのグループ。
 * UI 上は かんたん/ふつう/むずかしい/おに の4択。
 * 「おに」を選択すると ONI と EXTRA(おに裏) の両方が対象になる。
 *
 * value: UI キー 'EASY' | 'NORMAL' | 'DIFFICULT' | 'ONI'
 * toLevels(value): 実際の Level[] に展開するヘルパも export する。
 */
import { StyleSheet, View } from 'react-native';

import { LevelColors, LevelLabels } from '@/constants/taiko-colors';
import type { Level } from '@/types';

import { LevelCheckBox } from '../LevelCheckBox';

/** UI で操作する難易度キー（おに裏は「おに」に統合） */
export type DifficultyKey = 'EASY' | 'NORMAL' | 'DIFFICULT' | 'ONI';

export const DIFFICULTY_KEYS: DifficultyKey[] = ['EASY', 'NORMAL', 'DIFFICULT', 'ONI'];

/** UI キー → 実 Level[] へ展開（おに = ONI + EXTRA） */
export function toLevels(keys: DifficultyKey[]): Level[] {
  const set = new Set<Level>();
  for (const k of keys) {
    if (k === 'ONI') {
      set.add('ONI');
      set.add('EXTRA');
    } else {
      set.add(k);
    }
  }
  return [...set];
}

/** Level[] → UI キーに逆変換（EXTRA は ONI 扱い） */
export function toKeys(levels: Level[]): DifficultyKey[] {
  const set = new Set<DifficultyKey>();
  for (const c of levels) {
    if (c === 'EXTRA') set.add('ONI');
    else set.add(c as DifficultyKey);
  }
  return [...set];
}

interface DifficultyFilterProps {
  selected: DifficultyKey[];
  onChange: (selected: DifficultyKey[]) => void;
}

const UI_LABELS: Record<DifficultyKey, string> = {
  EASY: LevelLabels.EASY,
  NORMAL: LevelLabels.NORMAL,
  DIFFICULT: LevelLabels.DIFFICULT,
  ONI: `${LevelLabels.ONI}(裏含)`,
};

const UI_COLORS: Record<DifficultyKey, string> = {
  EASY: LevelColors.EASY,
  NORMAL: LevelColors.NORMAL,
  DIFFICULT: LevelColors.DIFFICULT,
  ONI: LevelColors.ONI,
};

export function DifficultyFilter({ selected, onChange }: DifficultyFilterProps) {
  const toggle = (key: DifficultyKey) => {
    if (selected.includes(key)) {
      onChange(selected.filter((k) => k !== key));
    } else {
      onChange([...selected, key]);
    }
  };

  return (
    <View style={styles.row}>
      {DIFFICULTY_KEYS.map((key) => (
        <LevelCheckBox
          key={key}
          label={UI_LABELS[key]}
          checked={selected.includes(key)}
          onChange={() => toggle(key)}
          color={UI_COLORS[key]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
