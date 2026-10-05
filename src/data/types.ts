import type { Reaction } from '@/data/reactions';
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
  /** The full profile, so nothing downstream has to resolve an id to a name. */
  sender: Person;
  /** Resolved once, in the mapper, from the signed-in user's id. */
  isMine: boolean;
  body: string;
  /** Epoch ms. The server stores timestamptz; the mapper is the only converter. */
  sentAt: number;
  fence?: Geofence;
  /**
   * When *this viewer* unlocked it, epoch ms. Per-reader: two people in a group
   * thread arrive at the same fenced message at different times, so this comes
   * from `message_unlocks`, not from a column on the message.
   */
  unlockedAt: number | null;
  /**
   * Who has found this message, oldest first. Only ever filled on your own
   * fenced messages: RLS lets a sender read unlocks of their message, and only
   * for finders who share receipts (profiles.share_unlock_receipts).
   */
  foundBy: FoundBy[];
  /** Current reactions, one per person at most. Removed reactions are absent. */
  reactions: MessageReaction[];
  /** 'sending' until the insert lands, so an optimistic row is distinguishable. */
  status: 'sent' | 'sending' | 'failed';
};

/** One receipt: a finder and when they unlocked, epoch ms (minute precision). */
export type FoundBy = { person: Person; at: number };

export type MessageReaction = { emoji: Reaction; personId: string };

export type Conversation = {
  id: string;
  /**
   * Everyone except you. The server's `conversation_participants` includes you;
   * the mapper strips you out, so a 1:1 thread has exactly one participant and
   * the title does not greet you by your own name.
   */
  participants: Person[];
  /** From `conversations.is_group`, never from participants.length — after the
   *  self-strip those disagree. */
  isGroup: boolean;
  title?: string;
  /** Derived per viewer: a message you have not read arrived after last_read_at. */
  unread: boolean;
  myLastReadAt: number | null;
  /**
   * The newest message, fetched with the conversation so the inbox can render a
   * preview without loading every thread's history.
   */
  lastMessage?: Message;
};

/** Stable identity for a fence, so messages sharing a place share one monitored region. */
export function fenceKey(fence: Geofence): string {
  return `${fence.latitude.toFixed(5)}:${fence.longitude.toFixed(5)}:${Math.round(fence.radiusMeters)}`;
}
