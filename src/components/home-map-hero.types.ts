import type { Geofence, LatLng } from '@/lib/geo';

export type HomeMapHeroProps = {
  position: LatLng;
  fences: Geofence[];
};
