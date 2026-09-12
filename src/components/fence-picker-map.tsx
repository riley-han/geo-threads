import { forwardRef, useImperativeHandle } from 'react';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Accent, AccentFill, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { formatRadius } from '@/lib/geo';
import type { FencePickerMapHandle, FencePickerMapProps } from './fence-picker-map.types';

/**
 * Non-iOS stand-in for the Apple Maps picker. expo-maps has no web support and
 * Android needs a Google Maps API key, so this renders the fence schematically
 * and leaves center selection to search and the place chips below it.
 */
export const FencePickerMap = forwardRef<FencePickerMapHandle, FencePickerMapProps>(
  function FencePickerMap({ center, radiusMeters }, ref) {
    const theme = useTheme();

    useImperativeHandle(ref, () => ({ focusOn: () => {} }));

    return (
      <View style={[styles.wrap, { backgroundColor: theme.backgroundElement }]}>
        <View style={[styles.ringOuter, { borderColor: Accent }]}>
          <View style={styles.ringInner} />
          <View style={styles.pin} />
        </View>
        <ThemedText type="smallBold">{formatRadius(radiusMeters)} radius</ThemedText>
        <ThemedText type="small" themeColor="textSecondary" style={styles.coords}>
          {center.latitude.toFixed(4)}, {center.longitude.toFixed(4)}
        </ThemedText>
      </View>
    );
  },
);

const styles = StyleSheet.create({
  wrap: {
    height: 260,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
  },
  ringOuter: {
    width: 120,
    height: 120,
    borderRadius: 60,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.two,
  },
  ringInner: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 60,
    backgroundColor: AccentFill,
  },
  pin: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: Accent,
  },
  coords: {
    fontVariant: ['tabular-nums'],
  },
});
