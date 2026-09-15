import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Accent, AccentFill, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { HomeMapHeroProps } from './home-map-hero.types';

/** Non-iOS stand-in: expo-maps has no web support and Android needs an API key. */
export function HomeMapHero({ fences }: HomeMapHeroProps) {
  const theme = useTheme();

  return (
    <View style={[styles.wrap, { backgroundColor: theme.backgroundElement }]}>
      <View style={styles.ring}>
        <View style={styles.dot} />
      </View>
      <ThemedText type="small" themeColor="textSecondary">
        {fences.length > 0
          ? `${fences.length} place${fences.length === 1 ? '' : 's'} with something waiting`
          : 'Map view is iOS-only for now'}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
  },
  ring: {
    width: 68,
    height: 68,
    borderRadius: 34,
    borderWidth: 2,
    borderColor: Accent,
    backgroundColor: AccentFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: Accent,
  },
});
