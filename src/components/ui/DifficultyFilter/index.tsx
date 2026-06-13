/**
 * 難易度チェックボックスのグループ。
 * UI 上は かんたん/ふつう/むずかしい/おに の4択。
 * 「おに」を選択すると ONI と EXTRA(おに裏) の両方が対象になる。
 *
 * value: UI キー 'EASY' | 'NORMAL' | 'DIFFICULT' | 'ONI'
 * toCourses(value): 実際の Course[] に展開するヘルパも export する。
 */
import { StyleSheet, View } from 'react-native';

import { CourseColors, CourseLabels } from '@/constants/taiko-colors';
import type { Course } from '@/types';

import { LevelCheckBox } from '../LevelCheckBox';

/** UI で操作する難易度キー（おに裏は「おに」に統合） */
export type DifficultyKey = 'EASY' | 'NORMAL' | 'DIFFICULT' | 'ONI';

export const DIFFICULTY_KEYS: DifficultyKey[] = ['EASY', 'NORMAL', 'DIFFICULT', 'ONI'];

/** UI キー → 実 Course[] へ展開（おに = ONI + EXTRA） */
export function toCourses(keys: DifficultyKey[]): Course[] {
  const set = new Set<Course>();
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

/** Course[] → UI キーに逆変換（EXTRA は ONI 扱い） */
export function toKeys(courses: Course[]): DifficultyKey[] {
  const set = new Set<DifficultyKey>();
  for (const c of courses) {
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
  EASY: CourseLabels.EASY,
  NORMAL: CourseLabels.NORMAL,
  DIFFICULT: CourseLabels.DIFFICULT,
  ONI: `${CourseLabels.ONI}(裏含)`,
};

const UI_COLORS: Record<DifficultyKey, string> = {
  EASY: CourseColors.EASY,
  NORMAL: CourseColors.NORMAL,
  DIFFICULT: CourseColors.DIFFICULT,
  ONI: CourseColors.ONI,
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
