import type { LatLng } from '@/lib/geo';

export type FencePickerMapProps = {
  center: LatLng;
  radiusMeters: number;
  onMove: (next: LatLng) => void;
  /**
   * Placing one stop of a trail: the other stops' places (null where not yet
   * chosen) and which one is being placed, so the route draws through `center`.
   */
  route?: { stops: (LatLng | null)[]; index: number };
};

export type FencePickerMapHandle = {
  /** Re-center without changing zoom, preserving the user's manual pinch level. */
  focusOn: (center: LatLng) => void;
};
