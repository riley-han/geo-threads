export type LatLng = {
  latitude: number;
  longitude: number;
};

export type Geofence = LatLng & {
  radiusMeters: number;
  label: string;
};

const EARTH_RADIUS_M = 6_371_000;

const toRadians = (deg: number) => (deg * Math.PI) / 180;

export function distanceMeters(a: LatLng, b: LatLng): number {
  const dLat = toRadians(b.latitude - a.latitude);
  const dLng = toRadians(b.longitude - a.longitude);
  const lat1 = toRadians(a.latitude);
  const lat2 = toRadians(b.latitude);

  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);

  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

export function isInsideFence(position: LatLng, fence: Geofence): boolean {
  return distanceMeters(position, fence) <= fence.radiusMeters;
}

export function formatDistance(meters: number): string {
  if (meters < 1000) {
    return `${Math.round(meters / 10) * 10} m`;
  }
  return `${(meters / 1000).toFixed(meters < 10_000 ? 1 : 0)} km`;
}

export function formatRadius(meters: number): string {
  return meters < 1000 ? `${meters} m` : `${(meters / 1000).toFixed(1)} km`;
}

/** Zoom level that roughly frames a fence of the given radius. */
export function zoomForRadius(radiusMeters: number): number {
  if (radiusMeters <= 100) return 17;
  if (radiusMeters <= 250) return 16;
  if (radiusMeters <= 500) return 15;
  if (radiusMeters <= 1000) return 14;
  if (radiusMeters <= 2000) return 13;
  return 12;
}
