import { useState } from 'react';
import { PanResponder, StyleSheet, View, type LayoutChangeEvent } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { RADIUS_STEPS } from '@/data/places';
import { Accent, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { formatRadius } from '@/lib/geo';

const THUMB = 26;

type Props = {
  value: number;
  onChange: (radiusMeters: number) => void;
};

function nearestIndex(value: number): number {
  let best = 0;
  let bestDelta = Infinity;
  RADIUS_STEPS.forEach((step, i) => {
    const delta = Math.abs(step - value);
    if (delta < bestDelta) {
      bestDelta = delta;
      best = i;
    }
  });
  return best;
}

export function RadiusSlider({ value, onChange }: Props) {
  const theme = useTheme();
  const [trackWidth, setTrackWidth] = useState(0);

  const progress = nearestIndex(value) / (RADIUS_STEPS.length - 1);

  const onLayout = (e: LayoutChangeEvent) => setTrackWidth(e.nativeEvent.layout.width);

  // Recreated each render so the handlers close over the current width and callback.
  const emit = (x: number) => {
    if (trackWidth <= 0) return;
    const ratio = Math.max(0, Math.min(1, x / trackWidth));
    onChange(RADIUS_STEPS[Math.round(ratio * (RADIUS_STEPS.length - 1))]);
  };

  const responder = PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: (e) => emit(e.nativeEvent.locationX),
    onPanResponderMove: (e) => emit(e.nativeEvent.locationX),
  });

  const thumbLeft = Math.max(0, progress * trackWidth - THUMB / 2);

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <ThemedText type="small" themeColor="textSecondary">
          Radius
        </ThemedText>
        <ThemedText type="smallBold">{formatRadius(value)}</ThemedText>
      </View>

      <View style={styles.trackArea} onLayout={onLayout} {...responder.panHandlers}>
        <View style={[styles.track, { backgroundColor: theme.backgroundSelected }]}>
          <View style={[styles.fill, { width: `${progress * 100}%` }]} />
        </View>
        <View style={[styles.thumb, { left: thumbLeft, borderColor: theme.background }]} />
      </View>

      <View style={styles.scale}>
        <ThemedText type="small" themeColor="textSecondary" style={styles.scaleLabel}>
          {formatRadius(RADIUS_STEPS[0])}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary" style={styles.scaleLabel}>
          {formatRadius(RADIUS_STEPS[RADIUS_STEPS.length - 1])}
        </ThemedText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    gap: Spacing.two,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
  },
  trackArea: {
    height: THUMB + Spacing.two,
    justifyContent: 'center',
  },
  track: {
    height: 4,
    borderRadius: 2,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    backgroundColor: Accent,
  },
  thumb: {
    position: 'absolute',
    width: THUMB,
    height: THUMB,
    borderRadius: THUMB / 2,
    backgroundColor: Accent,
    borderWidth: 3,
  },
  scale: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  scaleLabel: {
    fontSize: 11,
  },
});
