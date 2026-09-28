import type { Conversation, Message, Person } from '@/data/types';
import type { Geofence } from '@/lib/geo';

/**
 * Row shapes → domain types. This is the only module that knows the server's
 * column names or its timestamp format, so a schema rename touches one file.
 */

type ProfileFields = {
  id: string;
  name: string;
  handle: string;
  avatar_url: string | null;
};

export type MessageRowWithRefs = {
  id: string;
  conversation_id: string;
  sender_id: string;
  body: string;
  sent_at: string;
  fence_latitude: number | null;
  fence_longitude: number | null;
  fence_radius_meters: number | null;
  fence_label: string | null;
  fence_key?: string | null;
  sender: ProfileFields | null;
  unlocks: { unlocked_at: string }[] | null;
};

export type ConversationRowWithRefs = {
  id: string;
  is_group: boolean;
  title: string | null;
  participants: {
    user_id: string;
    last_read_at: string | null;
    profile: ProfileFields | null;
  }[];
  last_messages: MessageRowWithRefs[];
};

/**
 * Postgres returns microsecond precision (…T03:54:24.123456+00:00), which is
 * outside what the ECMAScript date grammar strictly specifies. Every engine we
 * run on parses it, but guard rather than let a NaN reach a sort comparator,
 * where it would silently scramble the order instead of failing.
 */
export function toEpochMs(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
}

export function toPerson(row: ProfileFields): Person {
  return {
    id: row.id,
    name: row.name,
    handle: row.handle,
    avatarUrl: row.avatar_url,
  };
}

/**
 * A stand-in for a profile the server did not return — a sender whose account
 * was deleted, or an embed that came back null. Rendering something anonymous
 * beats dropping the message, which is what the old contactById lookup did.
 */
function unknownPerson(id: string): Person {
  return { id, name: 'Unknown', handle: 'unknown', avatarUrl: null };
}

function toFence(row: MessageRowWithRefs): Geofence | undefined {
  if (
    row.fence_latitude == null ||
    row.fence_longitude == null ||
    row.fence_radius_meters == null
  ) {
    return undefined;
  }
  return {
    latitude: row.fence_latitude,
    longitude: row.fence_longitude,
    radiusMeters: row.fence_radius_meters,
    label: row.fence_label ?? '',
  };
}

export function toMessage(row: MessageRowWithRefs, myId: string): Message {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    sender: row.sender ? toPerson(row.sender) : unknownPerson(row.sender_id),
    isMine: row.sender_id === myId,
    body: row.body,
    sentAt: toEpochMs(row.sent_at) ?? Date.now(),
    fence: toFence(row),
    // RLS scopes message_unlocks to the caller, so this array can only ever
    // hold this viewer's row.
    unlockedAt: toEpochMs(row.unlocks?.[0]?.unlocked_at),
    status: 'sent',
  };
}

export function toConversation(row: ConversationRowWithRefs, myId: string): Conversation {
  const mine = row.participants.find((p) => p.user_id === myId);
  const myLastReadAt = toEpochMs(mine?.last_read_at);

  const last = row.last_messages[0];
  const lastMessage = last ? toMessage(last, myId) : undefined;

  return {
    id: row.id,
    participants: row.participants
      .filter((p) => p.user_id !== myId && p.profile != null)
      .map((p) => toPerson(p.profile!)),
    isGroup: row.is_group,
    title: row.title ?? undefined,
    // Someone else's message landed after I last looked. My own message never
    // makes a thread unread, however stale last_read_at is.
    unread:
      lastMessage != null &&
      !lastMessage.isMine &&
      (myLastReadAt == null || lastMessage.sentAt > myLastReadAt),
    myLastReadAt,
    lastMessage,
  };
}

/** The display name for a thread — an explicit group title, else the participants. */
export function conversationTitle(conversation: Conversation): string {
  if (conversation.title) return conversation.title;
  if (conversation.participants.length === 0) return 'Just you';
  return conversation.participants.map((p) => p.name).join(', ');
}
