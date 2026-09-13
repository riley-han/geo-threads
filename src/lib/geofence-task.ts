import { LocationGeofencingEventType, type LocationRegion } from 'expo-location';
import * as TaskManager from 'expo-task-manager';

import { loadPendingMessagesForFence } from '@/db/messages-repository';
import { openDatabase } from '@/db/schema';
import { notifyArrival } from '@/lib/notifications';

export const GEOFENCE_TASK = 'geo-threads-geofence';

type GeofenceEvent = {
  eventType: LocationGeofencingEventType;
  region: LocationRegion;
};

/**
 * Defined at module scope — the OS may relaunch a terminated app straight into
 * this task, so it must exist before any React tree renders. It reads SQLite
 * directly for the same reason: there is no store to consult on a cold start.
 */
TaskManager.defineTask<GeofenceEvent>(GEOFENCE_TASK, async ({ data, error }) => {
  if (error || !data) return;
  if (data.eventType !== LocationGeofencingEventType.Enter) return;

  const key = data.region.identifier;
  if (!key) return;

  try {
    const db = await openDatabase();
    const pending = await loadPendingMessagesForFence(db, key);
    if (pending.length === 0) return;
    await notifyArrival(pending, pending[0].fence?.label ?? 'this place');
  } catch {
    // A failed alert must never crash a background task.
  }
});
