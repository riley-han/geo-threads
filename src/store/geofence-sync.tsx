import * as Location from 'expo-location';
import { useEffect, type ReactNode } from 'react';

import { fenceKey } from '@/data/types';
import type { Message } from '@/data/types';
import { distanceMeters, type Geofence, type LatLng } from '@/lib/geo';
import { GEOFENCE_TASK } from '@/lib/geofence-task';
import { isWithinWindow } from '@/lib/message-visibility';
import { useAuth } from '@/store/auth-store';
import { useLocation } from '@/store/location-store';
import { useInboxState, usePendingFencedMessages } from '@/store/messages-store';

/** iOS monitors at most 20 regions per app; Android allows 100. Stay under both. */
const MAX_REGIONS = 20;

/** Collapses messages sharing a place into one region, keyed by fenceKey. */
function regionsFor(messages: Message[], position: LatLng | null): Location.LocationRegion[] {
  const byKey = new Map<string, Geofence>();
  for (const m of messages) {
    // A stop outside its time window cannot be unlocked, so an arrival alert
    // for it would be a false promise. It rejoins on the next refresh after
    // it opens.
    if (m.fence && isWithinWindow(m)) byKey.set(fenceKey(m.fence), m.fence);
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
  // A boolean, deliberately not the session object: its identity changes on
  // every token auto-refresh, which would re-register the regions on a timer.
  const signedIn = useAuth().session != null;
  // Not just "signed in": pendingFenced is empty while the first fetch is in
  // flight, so acting before it resolves would stop geofencing on every cold
  // start and re-register a moment later — churn, and a window where an
  // arrival goes unnoticed.
  const loaded = useInboxState().state === 'ready';

  const signature = regionsFor(pending, position)
    .map((r) => r.identifier)
    .join('|');

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const running = await Location.hasStartedGeofencingAsync(GEOFENCE_TASK).catch(() => false);

      // Signing out has to tear these down. Regions are registered with the OS,
      // so they outlive the session and would keep firing arrival notifications
      // for the previous user's fenced messages.
      if (access !== 'background' || !signedIn || !loaded) {
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
  }, [access, signature, signedIn, loaded]);

  return <>{children}</>;
}
