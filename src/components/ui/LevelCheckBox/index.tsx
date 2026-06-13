import Checkbox from 'expo-checkbox';
import { Pressable, StyleSheet, Text, View } from 'react-native';

interface LevelCheckBoxProps {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  /** 難易度色など、ラベル左に表示するドット色 */
  color?: string;
}

export const LevelCheckBox = (props: LevelCheckBoxProps) => {
  return (
    <Pressable
      style={styles.container}
      onPress={() => props.onChange(!props.checked)}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: props.checked }}
    >
      <Checkbox
        value={props.checked}
        onValueChange={props.onChange}
        color={props.checked ? (props.color ?? '#e94560') : undefined}
      />
      {props.color && <View style={[styles.dot, { backgroundColor: props.color }]} />}
      <Text style={styles.label}>{props.label}</Text>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  container: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  label: { color: '#fff', fontSize: 12 },
});
