import { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { AddressSearch } from '@/components/address-search';
import { FencePickerMap } from '@/components/fence-picker-map';
import type { FencePickerMapHandle } from '@/components/fence-picker-map.types';
import { RadiusSlider } from '@/components/radius-slider';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Fonts, Spacing } from '@/constants/theme';
import {
  DEFAULT_POSITION,
  DEFAULT_RADIUS_M,
  PRESET_PLACES,
  UNNAMED_PLACE,
  nearestPlaceName,
  type Place,
} from '@/data/places';
import { useTheme } from '@/hooks/use-theme';
import { nameForPoint } from '@/lib/geocode';
import { useCurrentPosition } from '@/store/location-store';
import { distanceMeters, formatDistance, type Geofence, type LatLng } from '@/lib/geo';

const describeFromYou = (meters: number) =>
  meters < 50 ? 'Where you are now' : `${formatDistance(meters)} from you`;

type Props = {
  initialFence?: Geofence;
  onConfirm: (fence: Geofence) => void;
  onCancel: () => void;
  /** Header title. */
  title?: string;
  /** The confirm button's label. */
  confirmLabel?: string;
  /** Placing one stop of a trail: every stop's place so far, and which is being placed. */
  route?: { stops: (Geofence | undefined)[]; index: number };
};

/**
 * Choose a place: search, a preset, or a tap on the map, then a radius and a
 * name. Never shows coordinates: people think in places, and the name is what
 * everyone else will see.
 */
export function FencePicker({
  initialFence,
  onConfirm,
  onCancel,
  title = 'Choose a place',
  confirmLabel = 'Attach',
  route,
}: Props) {
  const theme = useTheme();
  const realPosition = useCurrentPosition();
  // Before a fix lands (or without permission) the picker still needs somewhere to start.
  const currentPosition = realPosition ?? DEFAULT_POSITION;
  const previousStop = route && route.index > 0 ? route.stops[route.index - 1] : undefined;

  const [center, setCenter] = useState<LatLng>(
    initialFence
      ? { latitude: initialFence.latitude, longitude: initialFence.longitude }
      : currentPosition,
  );
  const [radius, setRadius] = useState(initialFence?.radiusMeters ?? DEFAULT_RADIUS_M);
  const [label, setLabel] = useState(
    initialFence?.label || nearestPlaceName(initialFence ?? currentPosition),
  );
  // A starting spot without a real name (a new trail stop opened beside the
  // last one, or an old dropped pin) still gets named after where the pin lands.
  const [labelEdited, setLabelEdited] = useState(
    Boolean(initialFence?.label) && initialFence?.label !== UNNAMED_PLACE,
  );

  const mapRef = useRef<FencePickerMapHandle>(null);

  // Reverse geocoding is async; only the latest request may set the name, and
  // typing or choosing a named place cancels any in flight.
  const naming = useRef(0);
  const nameFromAddress = (point: LatLng) => {
    const ticket = ++naming.current;
    void nameForPoint(point).then((name) => {
      if (name && ticket === naming.current) setLabel(name);
    });
  };

  const [startNamed] = useState(() => labelEdited);
  useEffect(() => {
    if (!startNamed) nameFromAddress(center);
    // Once, for the starting spot; later moves name themselves in moveTo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const moveTo = (next: LatLng, placeName?: string) => {
    setCenter(next);
    if (placeName) {
      naming.current++;
      setLabel(placeName);
      setLabelEdited(true);
    } else if (!labelEdited) {
      setLabel(nearestPlaceName(next));
      nameFromAddress(next);
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
        <ThemedText type="smallBold">{title}</ThemedText>
        <Pressable onPress={confirm} hitSlop={10}>
          <ThemedText type="linkPrimary">{confirmLabel}</ThemedText>
        </Pressable>
      </View>

      <FencePickerMap
        ref={mapRef}
        center={center}
        radiusMeters={radius}
        onMove={moveTo}
        route={
          route
            ? { stops: route.stops.map((f) => f ?? null), index: route.index }
            : undefined
        }
      />

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
                    { backgroundColor: active ? theme.accent : theme.backgroundSelected },
                  ]}>
                  <ThemedText
                    type="small"
                    style={
                      active ? [styles.placeChipActive, { color: theme.onAccent }] : undefined
                    }>
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
              naming.current++;
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
          <ThemedText type="small" themeColor="textSecondary" style={styles.whereNote}>
            {[
              previousStop
                ? `${formatDistance(distanceMeters(previousStop, center))} from stop ${route!.index}`
                : null,
              realPosition ? describeFromYou(distanceMeters(realPosition, center)) : null,
            ]
              .filter(Boolean)
              .join(' · ')}
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
    fontFamily: Fonts.bodyBold,
  },
  labelInput: {
    fontFamily: Fonts.body,
    fontSize: 16,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two + 2,
    borderRadius: Spacing.two,
  },
  whereNote: {
    minHeight: 18,
  },
  note: {
    textAlign: 'center',
  },
});
