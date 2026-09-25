import type { Geofence } from '@/lib/geo';

/**
 * A person as the server knows them — one row of `profiles`.
 *
 * `handle` is bare ('ada'), matching the column, which is lowercased and
 * validated against ^[a-z0-9_]{3,30}$. The '@' belongs to the UI, so render
 * sites add it rather than the data carrying it.
 */
export type Person = {
  id: string;
  name: string;
  handle: string;
  avatarUrl: string | null;
};

export type Message = {
  id: string;
  conversationId: string;
  senderId: string;
  body: string;
  sentAt: number;
  fence?: Geofence;
  /** Set once the reader unlocks it in range; a message stays readable afterwards. */
  unlockedAt: number | null;
};

export type Conversation = {
  id: string;
  participantIds: string[];
  isGroup: boolean;
  title?: string;
  unread: boolean;
};

/** Stable identity for a fence, so messages sharing a place share one monitored region. */
export function fenceKey(fence: Geofence): string {
  return `${fence.latitude.toFixed(5)}:${fence.longitude.toFixed(5)}:${Math.round(fence.radiusMeters)}`;
}
