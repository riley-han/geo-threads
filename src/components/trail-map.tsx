import { useState } from 'react';
import { Pressable, StyleSheet, View, type LayoutChangeEvent } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Fonts } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { TrailMapProps, TrailMapStopState } from './trail-map.types';

const DOT = 26;
const PAD = 28;

/**
 * Non-iOS stand-in for the Apple Maps route (expo-maps has no web support and
 * Android needs a Google Maps key): the stops drawn to scale on a plain ground
 * and joined in order, so the shape of the route still reads.
 */
export function TrailMap({ stops, onSelectStop }: TrailMapProps) {
  const theme = useTheme();
  const [size, setSize] = useState({ width: 0, height: 0 });

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setSize({ width, height });
  };

  const tint: Record<TrailMapStopState, string> = {
    found: theme.secondary,
    next: theme.accent,
    ahead: theme.primary,
  };
  const ink: Record<TrailMapStopState, string> = {
    found: theme.secondarySoft,
    next: theme.onAccent,
    ahead: theme.onPrimary,
  };

  // Equirectangular is plenty at trail scale; longitude is shrunk by cos(lat)
  // so a square block stays square.
  const lat0 = stops.length ? stops.reduce((n, s) => n + s.fence.latitude, 0) / stops.length : 0;
  const k = Math.cos((lat0 * Math.PI) / 180);
  const xs = stops.map((s) => s.fence.longitude * k);
  const ys = stops.map((s) => -s.fence.latitude);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const spanX = Math.max(...xs) - minX || 1;
  const spanY = Math.max(...ys) - minY || 1;
  const scale = Math.min((size.width - 2 * PAD) / spanX, (size.height - 2 * PAD) / spanY);
  const offX = (size.width - spanX * scale) / 2;
  const offY = (size.height - spanY * scale) / 2;
  const points = stops.map((_, i) =>
    stops.length === 1
      ? { x: size.width / 2, y: size.height / 2 }
      : { x: offX + (xs[i] - minX) * scale, y: offY + (ys[i] - minY) * scale },
  );

  return (
    <View style={[styles.wrap, { backgroundColor: theme.backgroundElement }]} onLayout={onLayout}>
      {size.width > 0
        ? points.slice(1).map((b, i) => {
            const a = points[i];
            const length = Math.hypot(b.x - a.x, b.y - a.y);
            const angle = Math.atan2(b.y - a.y, b.x - a.x);
            return (
              <View
                key={`seg-${i}`}
                style={[
                  styles.segment,
                  {
                    backgroundColor: theme.tint,
                    width: length,
                    left: (a.x + b.x) / 2 - length / 2,
                    top: (a.y + b.y) / 2 - 1.5,
                    transform: [{ rotate: `${angle}rad` }],
                  },
                ]}
              />
            );
          })
        : null}
      {size.width > 0
        ? stops.map((s, i) => (
            <Pressable
              key={s.step}
              onPress={() => onSelectStop?.(s.step)}
              hitSlop={8}
              accessibilityLabel={`Stop ${s.step}, ${s.fence.label}`}
              style={[
                styles.dot,
                {
                  backgroundColor: tint[s.state],
                  left: points[i].x - DOT / 2,
                  top: points[i].y - DOT / 2,
                },
              ]}>
              <ThemedText type="small" style={[styles.dotText, { color: ink[s.state] }]}>
                {s.state === 'found' ? '✓' : s.step}
              </ThemedText>
            </Pressable>
          ))
        : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
  },
  segment: {
    position: 'absolute',
    height: 3,
    borderRadius: 2,
  },
  dot: {
    position: 'absolute',
    width: DOT,
    height: DOT,
    borderRadius: DOT / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dotText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 12,
    lineHeight: 16,
  },
});
