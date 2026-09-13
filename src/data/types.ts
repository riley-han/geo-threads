import type { Geofence } from '@/lib/geo';

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
