import { useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { AddressSearch } from '@/components/address-search';
import { FencePickerMap } from '@/components/fence-picker-map';
import type { FencePickerMapHandle } from '@/components/fence-picker-map.types';
import { RadiusSlider } from '@/components/radius-slider';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Accent, Spacing } from '@/constants/theme';
import {
  DEFAULT_POSITION,
  DEFAULT_RADIUS_M,
  PRESET_PLACES,
  nearestPlaceName,
  type Place,
} from '@/data/places';
import { useTheme } from '@/hooks/use-theme';
import { useCurrentPosition } from '@/store/location-store';
import type { Geofence, LatLng } from '@/lib/geo';

type Props = {
  initialFence?: Geofence;
  onConfirm: (fence: Geofence) => void;
  onCancel: () => void;
};

export function FencePicker({ initialFence, onConfirm, onCancel }: Props) {
  const theme = useTheme();
  // Before a fix lands (or without permission) the picker still needs somewhere to start.
  const currentPosition = useCurrentPosition() ?? DEFAULT_POSITION;

  const [center, setCenter] = useState<LatLng>(
    initialFence
      ? { latitude: initialFence.latitude, longitude: initialFence.longitude }
      : currentPosition,
  );
  const [radius, setRadius] = useState(initialFence?.radiusMeters ?? DEFAULT_RADIUS_M);
  const [label, setLabel] = useState(initialFence?.label ?? nearestPlaceName(currentPosition));
  const [labelEdited, setLabelEdited] = useState(Boolean(initialFence));

  const mapRef = useRef<FencePickerMapHandle>(null);

  const moveTo = (next: LatLng, placeName?: string) => {
    setCenter(next);
    if (placeName) {
      setLabel(placeName);
      setLabelEdited(true);
    } else if (!labelEdited) {
      setLabel(nearestPlaceName(next));
    }
  };

  /** Move the pin *and* re-frame the map — for deliberate jumps, not map taps. */
  const jumpTo = (next: LatLng, placeName?: string) => {
    moveTo(next, placeName);
    mapRef.current?.focusOn(next);
  };

  const confirm = () => {
    onConfirm({
      latitude: center.latitude,
      longitude: center.longitude,
      radiusMeters: radius,
      label: label.trim() || nearestPlaceName(center),
    });
  };

  return (
    <ThemedView style={styles.root}>
      <View style={styles.header}>
        <Pressable onPress={onCancel} hitSlop={10}>
          <ThemedText type="linkPrimary">Cancel</ThemedText>
        </Pressable>
        <ThemedText type="smallBold">Add geofence</ThemedText>
        <Pressable onPress={confirm} hitSlop={10}>
          <ThemedText type="linkPrimary" style={styles.confirm}>
            Attach
          </ThemedText>
        </Pressable>
      </View>

      <FencePickerMap ref={mapRef} center={center} radiusMeters={radius} onMove={moveTo} />

      <ScrollView
        style={styles.body}
        contentContainerStyle={styles.bodyContent}
        keyboardShouldPersistTaps="handled">
        <AddressSearch
          onSelect={(result) =>
            jumpTo({ latitude: result.latitude, longitude: result.longitude }, result.label)
          }
        />

        <View style={styles.section}>
          <ThemedText type="small" themeColor="textSecondary">
            Places
          </ThemedText>
          <View style={styles.placeRow}>
            <Pressable
              onPress={() => jumpTo(currentPosition)}
              style={[styles.placeChip, { backgroundColor: theme.backgroundSelected }]}>
              <ThemedText type="small">Where I am</ThemedText>
            </Pressable>
            {PRESET_PLACES.map((place: Place) => {
              const active = place.name === label;
              return (
                <Pressable
                  key={place.name}
                  onPress={() => jumpTo(place, place.name)}
                  style={[
                    styles.placeChip,
                    { backgroundColor: active ? Accent : theme.backgroundSelected },
                  ]}>
                  <ThemedText type="small" style={active ? styles.placeChipActive : undefined}>
                    {place.name}
                  </ThemedText>
                </Pressable>
              );
            })}
          </View>
        </View>

        <View style={styles.section}>
          <RadiusSlider value={radius} onChange={setRadius} />
        </View>

        <View style={styles.section}>
          <ThemedText type="small" themeColor="textSecondary">
            Name
          </ThemedText>
          <TextInput
            value={label}
            onChangeText={(t) => {
              setLabel(t);
              setLabelEdited(true);
            }}
            placeholder="Where is this?"
            placeholderTextColor={theme.textSecondary}
            style={[
              styles.labelInput,
              { color: theme.text, backgroundColor: theme.backgroundSelected },
            ]}
          />
          <ThemedText type="small" themeColor="textSecondary" style={styles.coords}>
            {center.latitude.toFixed(5)}, {center.longitude.toFixed(5)}
          </ThemedText>
        </View>

        {Platform.OS !== 'ios' ? (
          <ThemedText type="small" themeColor="textSecondary" style={styles.note}>
            The interactive map is iOS-only for now — use search or a place chip to set the center.
          </ThemedText>
        ) : null}
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.three,
  },
  confirm: {
    fontWeight: '700',
  },
  body: {
    flex: 1,
  },
  bodyContent: {
    padding: Spacing.four,
    gap: Spacing.four,
  },
  section: {
    gap: Spacing.two,
  },
  placeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  placeChip: {
    paddingVertical: Spacing.one + 2,
    paddingHorizontal: Spacing.three,
    borderRadius: 999,
  },
  placeChipActive: {
    color: '#ffffff',
    fontWeight: '600',
  },
  labelInput: {
    fontSize: 16,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two + 2,
    borderRadius: Spacing.two,
  },
  coords: {
    fontVariant: ['tabular-nums'],
  },
  note: {
    textAlign: 'center',
  },
});
