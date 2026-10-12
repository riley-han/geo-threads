import type { Geofence } from '@/lib/geo';

/**
 * How a stop is drawn on the route:
 * - `found`: this viewer has unlocked it;
 * - `next`: the one stop to head for (the only gold mark);
 * - `ahead`: placed but not the focus, as in the builder or the creator's view.
 */
export type TrailMapStopState = 'found' | 'next' | 'ahead';

export type TrailMapStop = { step: number; fence: Geofence; state: TrailMapStopState };

export type TrailMapProps = {
  /** Only stops this viewer may see, in step order. Hidden stops are never passed in. */
  stops: TrailMapStop[];
  onSelectStop?: (step: number) => void;
};
