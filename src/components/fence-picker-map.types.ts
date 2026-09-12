import type { LatLng } from '@/lib/geo';

export type FencePickerMapProps = {
  center: LatLng;
  radiusMeters: number;
  onMove: (next: LatLng) => void;
};

export type FencePickerMapHandle = {
  /** Re-center without changing zoom, preserving the user's manual pinch level. */
  focusOn: (center: LatLng) => void;
};
