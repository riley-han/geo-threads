import { AppleMaps } from 'expo-maps';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet } from 'react-native';

import { useTheme } from '@/hooks/use-theme';
import { cameraForFences } from '@/lib/geo';
import type { TrailMapProps, TrailMapStopState } from './trail-map.types';

/**
 * A trail's route: numbered stops joined in order. The camera refits whenever
 * the set of places changes (a stop added, moved or found), and otherwise
 * leaves the person's pan and zoom alone.
 */
export function TrailMap({ stops, onSelectStop }: TrailMapProps) {
  const theme = useTheme();
  const mapRef = useRef<AppleMaps.MapView>(null);
  const fences = stops.map((s) => s.fence);

  const camera = cameraForFences(fences);
  const [initialCamera] = useState(() =>
    camera ? { coordinates: camera.center, zoom: camera.zoom } : undefined,
  );

  const signature = fences.map((f) => `${f.latitude},${f.longitude},${f.radiusMeters}`).join('|');
  const firstSignature = useRef(signature);
  useEffect(() => {
    if (signature === firstSignature.current) return;
    firstSignature.current = signature;
    const next = cameraForFences(fences);
    if (next) mapRef.current?.setCameraPosition({ coordinates: next.center, zoom: next.zoom });
    // `fences` is derived from `signature`; refitting on identity would fight the person's zoom.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  const tint: Record<TrailMapStopState, string> = {
    found: theme.secondary,
    next: theme.accent,
    ahead: theme.primary,
  };

  return (
    <AppleMaps.View
      ref={mapRef}
      style={styles.map}
      cameraPosition={initialCamera}
      markers={stops.map((s) => ({
        id: String(s.step),
        coordinates: { latitude: s.fence.latitude, longitude: s.fence.longitude },
        systemImage: s.state === 'found' ? 'checkmark.circle.fill' : `${s.step}.circle.fill`,
        tintColor: tint[s.state],
        title: s.fence.label,
      }))}
      circles={stops
        .filter((s) => s.state === 'next')
        .map((s) => ({
          id: `ring-${s.step}`,
          center: { latitude: s.fence.latitude, longitude: s.fence.longitude },
          radius: s.fence.radiusMeters,
          color: theme.accentFill,
          lineColor: theme.accent,
          width: 2,
        }))}
      polylines={
        stops.length > 1
          ? [
              {
                id: 'route',
                coordinates: stops.map((s) => ({
                  latitude: s.fence.latitude,
                  longitude: s.fence.longitude,
                })),
                color: theme.tint,
                width: 3,
              },
            ]
          : []
      }
      uiSettings={{ compassEnabled: false, scaleBarEnabled: true, togglePitchEnabled: false }}
      onMarkerClick={({ id }) => {
        const step = Number(id);
        if (Number.isInteger(step)) onSelectStop?.(step);
      }}
    />
  );
}

const styles = StyleSheet.create({
  map: {
    flex: 1,
  },
});
