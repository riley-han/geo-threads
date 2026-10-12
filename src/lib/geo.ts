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

/**
 * A camera that frames every fence: the middle of their bounding box, zoomed
 * out until the widest side (plus each ring) fits a phone-width map.
 */
export function cameraForFences(fences: Geofence[]): { center: LatLng; zoom: number } | null {
  if (fences.length === 0) return null;
  if (fences.length === 1) {
    const [f] = fences;
    return { center: { latitude: f.latitude, longitude: f.longitude }, zoom: zoomForRadius(f.radiusMeters) };
  }

  const lats = fences.map((f) => f.latitude);
  const lngs = fences.map((f) => f.longitude);
  const south = Math.min(...lats);
  const north = Math.max(...lats);
  const west = Math.min(...lngs);
  const east = Math.max(...lngs);
  const center = { latitude: (south + north) / 2, longitude: (west + east) / 2 };

  const tall = distanceMeters({ latitude: south, longitude: center.longitude }, { latitude: north, longitude: center.longitude });
  const wide = distanceMeters({ latitude: center.latitude, longitude: west }, { latitude: center.latitude, longitude: east });
  const ring = 2 * Math.max(...fences.map((f) => f.radiusMeters));
  const span = Math.max(tall, wide) + ring;

  // Web Mercator: metres per point at zoom z is 156543·cos(lat)/2^z. Fit the
  // span into ~280 points, leaving room for markers at the edges.
  const zoom = Math.log2((156_543 * Math.cos(toRadians(center.latitude)) * 280) / Math.max(span, 50));
  return { center, zoom: Math.max(3, Math.min(17, zoom)) };
}

/** Straight-line length of a route through the points in order. */
export function routeMeters(points: LatLng[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += distanceMeters(points[i - 1], points[i]);
  return total;
}
