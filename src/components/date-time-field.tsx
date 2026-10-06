import { DateTimePicker } from '@expo/ui/community/datetime-picker';
import { useState } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTheme } from '@/hooks/use-theme';
import { formatMoment } from '@/lib/format-moment';

type Props = {
  /** Shown before the value once set, e.g. "Opens". */
  label: string;
  /** The link shown while empty, e.g. "Set an opening time". */
  setLabel: string;
  value: Date | null;
  onChange: (next: Date | null) => void;
  /** Where the picker starts when first set. */
  suggest: () => Date;
  minimumDate?: Date;
};

/**
 * An optional date and time. Empty, it is a "Set …" link. Set, it shows the
 * picker (inline on iOS; on Android a dialog, which has to be unmounted once
 * it reports back) and a "Remove" link.
 */
export function DateTimeField({ label, setLabel, value, onChange, suggest, minimumDate }: Props) {
  const theme = useTheme();
  const scheme = useColorScheme();
  const [dialogOpen, setDialogOpen] = useState(false);

  if (value == null) {
    return (
      <Pressable onPress={() => onChange(suggest())} hitSlop={6} style={styles.link}>
        <ThemedText type="small" themeColor="tint">
          {setLabel}
        </ThemedText>
      </Pressable>
    );
  }

  return (
    <View style={styles.row}>
      <ThemedText type="small" themeColor="textSecondary" style={styles.label}>
        {label}
      </ThemedText>

      {Platform.OS === 'ios' ? (
        <DateTimePicker
          value={value}
          mode="datetime"
          display="compact"
          minimumDate={minimumDate}
          accentColor={theme.tint}
          themeVariant={scheme === 'dark' ? 'dark' : 'light'}
          onValueChange={(_, date) => onChange(date)}
        />
      ) : (
        <>
          <Pressable onPress={() => setDialogOpen(true)} hitSlop={6}>
            <ThemedText type="small" themeColor="tint">
              {formatMoment(value.getTime())}
            </ThemedText>
          </Pressable>
          {dialogOpen ? (
            <DateTimePicker
              value={value}
              mode="datetime"
              presentation="dialog"
              minimumDate={minimumDate}
              accentColor={theme.tint}
              onValueChange={(_, date) => {
                setDialogOpen(false);
                onChange(date);
              }}
              onDismiss={() => setDialogOpen(false)}
            />
          ) : null}
        </>
      )}

      <Pressable onPress={() => onChange(null)} hitSlop={6}>
        <ThemedText type="small" themeColor="textSecondary">
          Remove
        </ThemedText>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  link: {
    alignSelf: 'flex-start',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  label: {
    minWidth: 52,
  },
});
