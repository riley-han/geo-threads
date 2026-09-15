import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Accent, AccentFill, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { MapCanvasProps } from './map-canvas.types';

/** Non-iOS stand-in: expo-maps has no web support and Android needs an API key. */
export function MapCanvas({ fences }: MapCanvasProps) {
  const theme = useTheme();

  return (
    <View style={[StyleSheet.absoluteFill, styles.wrap, { backgroundColor: theme.backgroundElement }]}>
      <View style={styles.ring}>
        <View style={styles.dot} />
      </View>
      <ThemedText type="small" themeColor="textSecondary" style={styles.note}>
        {fences.length} locked place{fences.length === 1 ? '' : 's'} — the interactive map is
        iOS-only for now.
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.six,
  },
  ring: {
    width: 96,
    height: 96,
    borderRadius: 48,
    borderWidth: 2,
    borderColor: Accent,
    backgroundColor: AccentFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: Accent,
  },
  note: {
    textAlign: 'center',
  },
});
