import { AppleMaps } from 'expo-maps';
import { StyleSheet } from 'react-native';

import { useTheme } from '@/hooks/use-theme';
import { zoomForRadius } from '@/lib/geo';
import type { MapCanvasProps } from './map-canvas.types';

export function MapCanvas({ position, fences, onSelectFence }: MapCanvasProps) {
  const theme = useTheme();

  return (
    <AppleMaps.View
      style={StyleSheet.absoluteFill}
      cameraPosition={{
        coordinates: { latitude: position.latitude, longitude: position.longitude },
        zoom: zoomForRadius(2000),
      }}
      markers={fences.map((f, i) => ({
        id: String(i),
        coordinates: { latitude: f.latitude, longitude: f.longitude },
        systemImage: 'lock.fill',
        tintColor: theme.accent,
        title: f.label,
      }))}
      circles={fences.map((f, i) => ({
        id: `c-${i}`,
        center: { latitude: f.latitude, longitude: f.longitude },
        radius: f.radiusMeters,
        color: theme.accentFill,
        lineColor: theme.accent,
        width: 2,
      }))}
      uiSettings={{ compassEnabled: true, scaleBarEnabled: true }}
      onMarkerClick={({ id }) => {
        const index = Number(id);
        if (Number.isInteger(index)) onSelectFence(index);
      }}
    />
  );
}
