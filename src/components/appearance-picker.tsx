import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAppearance, type AppearancePreference } from '@/store/appearance-store';

const OPTIONS: { value: AppearancePreference; label: string }[] = [
  { value: 'dark', label: 'Dark' },
  { value: 'light', label: 'Light' },
  { value: 'system', label: 'System' },
];

/** Segmented control for the app's appearance. Applies immediately and is remembered on this device. */
export function AppearancePicker() {
  const theme = useTheme();
  const { preference, setPreference } = useAppearance();

  return (
    <View
      accessibilityRole="radiogroup"
      style={[styles.track, { backgroundColor: theme.backgroundSelected }]}>
      {OPTIONS.map((option) => {
        const selected = option.value === preference;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            onPress={() => setPreference(option.value)}
            style={[styles.segment, selected && { backgroundColor: theme.primary }]}>
            <ThemedText
              type={selected ? 'smallBold' : 'small'}
              style={{ color: selected ? theme.onPrimary : theme.textSecondary }}>
              {option.label}
            </ThemedText>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    flexDirection: 'row',
    padding: Spacing.half + 1,
    borderRadius: Radius.medium,
  },
  segment: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: Spacing.two,
    borderRadius: Radius.medium - 3,
  },
});
