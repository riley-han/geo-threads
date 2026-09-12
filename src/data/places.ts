import { distanceMeters, type LatLng } from '@/lib/geo';

/** Default simulated position — Ferry Building, San Francisco. */
export const DEFAULT_POSITION: LatLng = {
  latitude: 37.7955,
  longitude: -122.3937,
};

export type Place = LatLng & { name: string };

export const PRESET_PLACES: Place[] = [
  { name: 'Ferry Building', latitude: 37.7955, longitude: -122.3937 },
  { name: 'Pier 39', latitude: 37.8087, longitude: -122.4098 },
  { name: 'Dolores Park', latitude: 37.7596, longitude: -122.4269 },
  { name: 'Golden Gate Park', latitude: 37.7694, longitude: -122.4862 },
  { name: 'Twin Peaks', latitude: 37.7544, longitude: -122.4477 },
  { name: 'Oracle Park', latitude: 37.7786, longitude: -122.3893 },
];

export const RADIUS_STEPS = [50, 100, 200, 350, 500, 1000, 2000, 5000] as const;

export const DEFAULT_RADIUS_M = 200;

/** Beyond this, a preset's name is misleading — fall back to coordinates. */
const NAME_MATCH_RADIUS_M = 2000;

export function nearestPlaceName(point: LatLng): string {
  let best = PRESET_PLACES[0];
  let bestDistance = Infinity;
  for (const place of PRESET_PLACES) {
    const distance = distanceMeters(point, place);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = place;
    }
  }
  if (bestDistance > NAME_MATCH_RADIUS_M) {
    return `${point.latitude.toFixed(3)}, ${point.longitude.toFixed(3)}`;
  }
  return best.name;
}
