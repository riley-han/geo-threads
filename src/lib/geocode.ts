import * as Location from 'expo-location';
import { Platform } from 'react-native';

import type { LatLng } from '@/lib/geo';

export type GeocodeResult = LatLng & {
  label: string;
  sublabel?: string;
};

/** expo-location's geocoding is iOS/Android only. */
export const isGeocodingSupported = Platform.OS === 'ios' || Platform.OS === 'android';

const MAX_RESULTS = 5;

/** Android gates geocoding behind foreground location permission; iOS does not. */
async function ensureAndroidPermission(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  const { status } = await Location.requestForegroundPermissionsAsync();
  return status === 'granted';
}

export class GeocodeError extends Error {}

export async function searchAddress(query: string): Promise<GeocodeResult[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  if (!isGeocodingSupported) {
    throw new GeocodeError('Address search is not available on this platform.');
  }

  if (!(await ensureAndroidPermission())) {
    throw new GeocodeError('Location permission is required to search addresses.');
  }

  let matches: Location.LocationGeocodedLocation[];
  try {
    matches = await Location.geocodeAsync(trimmed);
  } catch {
    throw new GeocodeError('Could not reach the geocoder. Check your connection.');
  }

  const top = matches.slice(0, MAX_RESULTS);

  // Reverse geocode each hit so results are distinguishable in the list.
  const labelled = await Promise.all(
    top.map(async (match): Promise<GeocodeResult> => {
      const point = { latitude: match.latitude, longitude: match.longitude };
      try {
        const [address] = await Location.reverseGeocodeAsync(point);
        if (!address) return { ...point, label: trimmed };
        const primary = address.name ?? address.street ?? address.city ?? trimmed;
        const secondary =
          address.formattedAddress ??
          [address.city, address.region, address.country].filter(Boolean).join(', ');
        return {
          ...point,
          label: primary,
          sublabel: secondary && secondary !== primary ? secondary : undefined,
        };
      } catch {
        return { ...point, label: trimmed };
      }
    }),
  );

  return labelled;
}
