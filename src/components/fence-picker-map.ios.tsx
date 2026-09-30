import { AppleMaps } from 'expo-maps';
import { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Brand, Fonts, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { zoomForRadius, type LatLng } from '@/lib/geo';
import type { FencePickerMapHandle, FencePickerMapProps } from './fence-picker-map.types';

export const FencePickerMap = forwardRef<FencePickerMapHandle, FencePickerMapProps>(
  function FencePickerMap({ center, radiusMeters, onMove }, ref) {
    const theme = useTheme();
    const mapRef = useRef<AppleMaps.MapView>(null);

    // Captured once: passing a changing cameraPosition re-frames the map on every
    // render and fights the user's pinch-zoom. Re-targeting goes through the ref.
    const [initialCamera] = useState(() => ({
      coordinates: { latitude: center.latitude, longitude: center.longitude },
      zoom: zoomForRadius(radiusMeters),
    }));

    const currentZoom = useRef(initialCamera.zoom);

    const focusOn = (next: LatLng, zoom?: number) => {
      mapRef.current?.setCameraPosition({
        coordinates: { latitude: next.latitude, longitude: next.longitude },
        zoom: zoom ?? currentZoom.current,
      });
      if (zoom != null) currentZoom.current = zoom;
    };

    useImperativeHandle(ref, () => ({ focusOn }));

    return (
      <View style={styles.wrap}>
        <AppleMaps.View
          ref={mapRef}
          style={styles.map}
          cameraPosition={initialCamera}
          markers={[
            {
              id: 'fence-center',
              coordinates: { latitude: center.latitude, longitude: center.longitude },
              systemImage: 'mappin.circle.fill',
              tintColor: theme.accent,
              title: 'Fence center',
            },
          ]}
          circles={[
            {
              id: 'fence-circle',
              center: { latitude: center.latitude, longitude: center.longitude },
              radius: radiusMeters,
              color: theme.accentFill,
              lineColor: theme.accent,
              width: 2,
            },
          ]}
          uiSettings={{ compassEnabled: true, scaleBarEnabled: true }}
          onCameraMove={({ zoom }) => {
            currentZoom.current = zoom;
          }}
          onMapClick={({ coordinates }) => {
            if (coordinates?.latitude == null || coordinates?.longitude == null) return;
            onMove({ latitude: coordinates.latitude, longitude: coordinates.longitude });
          }}
        />

        <Pressable
          onPress={() => focusOn(center, zoomForRadius(radiusMeters))}
          style={styles.fitButton}
          hitSlop={8}>
          <ThemedText type="small" style={styles.fitText}>
            Fit fence
          </ThemedText>
        </Pressable>

        <View style={styles.hint} pointerEvents="none">
          <ThemedText type="small" style={styles.hintText}>
            Tap the map to move the fence · pinch to zoom
          </ThemedText>
        </View>
      </View>
    );
  },
);

const styles = StyleSheet.create({
  wrap: {
    height: 260,
  },
  map: {
    flex: 1,
  },
  fitButton: {
    position: 'absolute',
    top: Spacing.two,
    right: Spacing.two,
    backgroundColor: Brand.mapLabel,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one,
    borderRadius: 999,
  },
  fitText: {
    color: Brand.onMapLabel,
    fontFamily: Fonts.bodyBold,
  },
  hint: {
    position: 'absolute',
    bottom: Spacing.two,
    alignSelf: 'center',
    backgroundColor: Brand.mapLabel,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one,
    borderRadius: 999,
  },
  hintText: {
    color: Brand.onMapLabel,
  },
});
