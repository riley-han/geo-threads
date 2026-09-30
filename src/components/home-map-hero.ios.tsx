import { AppleMaps } from 'expo-maps';
import { StyleSheet, View } from 'react-native';

import { useTheme } from '@/hooks/use-theme';
import { zoomForRadius } from '@/lib/geo';
import type { HomeMapHeroProps } from './home-map-hero.types';

export function HomeMapHero({ position, fences }: HomeMapHeroProps) {
  const theme = useTheme();

  return (
    <View style={styles.wrap} pointerEvents="none">
      <AppleMaps.View
        style={styles.map}
        cameraPosition={{
          coordinates: { latitude: position.latitude, longitude: position.longitude },
          zoom: fences.length > 0 ? zoomForRadius(2000) : 15,
        }}
        markers={fences.map((f, i) => ({
          id: `fence-${i}`,
          coordinates: { latitude: f.latitude, longitude: f.longitude },
          systemImage: 'lock.fill',
          tintColor: theme.accent,
          title: f.label,
        }))}
        circles={fences.map((f, i) => ({
          id: `circle-${i}`,
          center: { latitude: f.latitude, longitude: f.longitude },
          radius: f.radiusMeters,
          color: theme.accentFill,
          lineColor: theme.accent,
          width: 1,
        }))}
        uiSettings={{
          compassEnabled: false,
          scaleBarEnabled: false,
          myLocationButtonEnabled: false,
          togglePitchEnabled: false,
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
  },
  map: {
    flex: 1,
  },
});
