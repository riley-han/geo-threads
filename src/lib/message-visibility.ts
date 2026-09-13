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
  | { kind: 'locked'; fence: Geofence; distanceMeters: number };

export function messageVisibility(message: Message, position: LatLng | null): MessageVisibility {
  const fence = message.fence;
  if (!fence || message.unlockedAt != null) return { kind: 'open' };

  // With no fix yet, fail closed — never reveal on an unknown position.
  if (!position) return { kind: 'locked', fence, distanceMeters: Infinity };

  if (isInsideFence(position, fence)) return { kind: 'unlockable', fence };
  return { kind: 'locked', fence, distanceMeters: distanceMeters(position, fence) };
}
