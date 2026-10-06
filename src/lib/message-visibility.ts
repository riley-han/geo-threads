import type { Message } from '@/data/types';
import { distanceMeters, isInsideFence, type Geofence, type LatLng } from '@/lib/geo';

/**
 * Whether a message's text may be shown. Every surface that renders message
 * body text must go through this — bubbles, inbox previews and search — so the
 * rule cannot drift between them.
 */
export type MessageVisibility =
  | { kind: 'open' }
  | { kind: 'unlockable'; fence: Geofence }
  | { kind: 'locked'; fence: Geofence; distanceMeters: number }
  /** A trail stop whose window has not opened yet. Being there does not help. */
  | { kind: 'scheduled'; fence: Geofence; opensAt: number }
  /** A trail stop whose window has passed without this viewer unlocking it. */
  | { kind: 'closed'; fence: Geofence; closedAt: number };

/**
 * Whether a message's time window allows unlocking now. Messages without a
 * window are always open. The server enforces this with its own clock; the
 * client uses it to label stops and to keep closed ones out of the geofences.
 */
export function isWithinWindow(message: Message, now: number = Date.now()): boolean {
  return (
    (message.opensAt == null || message.opensAt <= now) &&
    (message.closesAt == null || message.closesAt > now)
  );
}

export function messageVisibility(
  message: Message,
  position: LatLng | null,
  now: number = Date.now(),
): MessageVisibility {
  const fence = message.fence;
  if (!fence || message.unlockedAt != null) return { kind: 'open' };

  if (message.opensAt != null && message.opensAt > now) {
    return { kind: 'scheduled', fence, opensAt: message.opensAt };
  }
  if (message.closesAt != null && message.closesAt <= now) {
    return { kind: 'closed', fence, closedAt: message.closesAt };
  }

  // With no fix yet, fail closed — never reveal on an unknown position.
  if (!position) return { kind: 'locked', fence, distanceMeters: Infinity };

  if (isInsideFence(position, fence)) return { kind: 'unlockable', fence };
  return { kind: 'locked', fence, distanceMeters: distanceMeters(position, fence) };
}
