import * as Location from 'expo-location';
import { useEffect, type ReactNode } from 'react';

import { fenceKey } from '@/data/types';
import type { Message } from '@/data/types';
import { distanceMeters, type Geofence, type LatLng } from '@/lib/geo';
import { GEOFENCE_TASK } from '@/lib/geofence-task';
import { useLocation } from '@/store/location-store';
import { usePendingFencedMessages } from '@/store/messages-store';

/** iOS monitors at most 20 regions per app; Android allows 100. Stay under both. */
const MAX_REGIONS = 20;

/** Collapses messages sharing a place into one region, keyed by fenceKey. */
function regionsFor(messages: Message[], position: LatLng | null): Location.LocationRegion[] {
  const byKey = new Map<string, Geofence>();
  for (const m of messages) {
    if (m.fence) byKey.set(fenceKey(m.fence), m.fence);
  }

  const fences = [...byKey.entries()];
  if (position) {
    fences.sort(
      ([, a], [, b]) => distanceMeters(position, a) - distanceMeters(position, b),
    );
  }

  return fences.slice(0, MAX_REGIONS).map(([key, fence]) => ({
    identifier: key,
    latitude: fence.latitude,
    longitude: fence.longitude,
    radius: fence.radiusMeters,
    notifyOnEnter: true,
    notifyOnExit: true,
  }));
}

/**
 * Keeps the OS-monitored region set aligned with the messages still awaiting
 * unlock. Re-registers whenever that set or the user's position changes, since
 * "nearest 20" is only meaningful relative to where they are now.
 */
export function GeofenceSync({ children }: { children: ReactNode }) {
  const { access, position } = useLocation();
  const pending = usePendingFencedMessages();

  const signature = regionsFor(pending, position)
    .map((r) => r.identifier)
    .join('|');

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const running = await Location.hasStartedGeofencingAsync(GEOFENCE_TASK).catch(() => false);

      if (access !== 'background') {
        if (running) await Location.stopGeofencingAsync(GEOFENCE_TASK).catch(() => {});
        return;
      }

      const regions = regionsFor(pending, position);
      if (cancelled) return;

      if (regions.length === 0) {
        if (running) await Location.stopGeofencingAsync(GEOFENCE_TASK).catch(() => {});
        return;
      }

      // startGeofencingAsync replaces the whole set, so no stop is needed first.
      await Location.startGeofencingAsync(GEOFENCE_TASK, regions).catch(() => {});
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [access, signature]);

  return <>{children}</>;
}
