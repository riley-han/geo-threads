import type { Geofence, LatLng } from '@/lib/geo';

export type MapCanvasProps = {
  position: LatLng;
  fences: Geofence[];
  onSelectFence: (index: number) => void;
};
