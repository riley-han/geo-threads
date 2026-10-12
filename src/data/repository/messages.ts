import type { Reaction } from '@/data/reactions';
import type { Fix, Geofence } from '@/lib/geo';
import type { Message, Person } from '@/data/types';
import { supabase } from '@/lib/supabase';

import { describeError } from './errors';
import { toEpochMs, toMessage, type MessageRowWithRefs } from './mappers';

/**
 * The sender profile is embedded so no call site has to resolve an id to a
 * name, and `unlocks` comes along so per-viewer unlock state arrives in the
 * same round trip. On your own messages `unlocks` also holds the receipts of
 * finders who share them, which is why it carries `user_id` and the finder's
 * profile. The FK hints are required: `messages` and `message_unlocks` both
 * reference `profiles`, so PostgREST cannot infer either join.
 *
 * A fenced message's text is not on the row: `sealed` holds it, and RLS
 * returns it only to the sender and to readers who have unlocked it. For
 * everyone else it comes back null.
 */
const MESSAGE_SELECT = `
  id, conversation_id, sender_id, body, sent_at,
  fence_latitude, fence_longitude, fence_radius_meters, fence_label, fence_key,
  sender:profiles!messages_sender_id_fkey ( id, name, handle, avatar_url ),
  unlocks:message_unlocks (
    user_id, unlocked_at,
    finder:profiles!message_unlocks_user_id_fkey ( id, name, handle, avatar_url )
  ),
  reactions:message_reactions ( user_id, emoji ),
  sealed:message_sealed ( body, next_clue ),
  trail_id, trail_step, opens_at, closes_at,
  trail:trails!messages_trail_id_fkey ( id, title, reveal_mode, step_count )
`;

export async function fetchMessages(
  conversationId: string,
  myId: string,
): Promise<{ messages: Message[]; error: string | null }> {
  const { data, error } = await supabase
    .from('messages')
    .select(MESSAGE_SELECT)
    .eq('conversation_id', conversationId)
    .order('sent_at', { ascending: true });

  if (error) return { messages: [], error: describeError(error) };
  return {
    messages: (data as unknown as MessageRowWithRefs[]).map((r) => toMessage(r, myId)),
    error: null,
  };
}

/**
 * Fenced messages this viewer has not yet unlocked — the set worth monitoring,
 * and the set mirrored to SQLite for the background task.
 *
 * "Not unlocked by me" is filtered after mapping rather than in the query.
 * PostgREST can filter parents on an empty embedded resource, but the syntax is
 * version-sensitive and a wrong guess is a 400 that takes out the home screen,
 * the map and geofence registration at once. The set is small — every fenced
 * message in your threads — so the round trip is cheap and this cannot break.
 */
export async function fetchPendingFenced(
  myId: string,
): Promise<{ messages: Message[]; error: string | null }> {
  const { data, error } = await supabase
    .from('messages')
    .select(MESSAGE_SELECT)
    .not('fence_key', 'is', null)
    .neq('sender_id', myId)
    .order('sent_at', { ascending: false });

  if (error) return { messages: [], error: describeError(error) };

  const messages = (data as unknown as MessageRowWithRefs[])
    .map((r) => toMessage(r, myId))
    .filter((m) => m.unlockedAt == null);

  return { messages, error: null };
}

/**
 * Sends through `send_message`, the only write path for messages. Returns the
 * server's sent_at; the caller already holds everything else about the row.
 */
export async function createMessage(args: {
  /** Client-generated, so the optimistic row, this insert and the realtime echo share one identity. */
  id: string;
  conversationId: string;
  body: string;
  fence?: Geofence;
}): Promise<{ sentAt: number | null; error: string | null }> {
  const { data, error } = await supabase.rpc('send_message', {
    p_id: args.id,
    p_conversation_id: args.conversationId,
    p_body: args.body,
    p_fence_latitude: args.fence?.latitude,
    p_fence_longitude: args.fence?.longitude,
    p_fence_radius_meters: args.fence?.radiusMeters,
    p_fence_label: args.fence?.label,
  });

  if (error) return { sentAt: null, error: describeError(error, 'message') };
  return { sentAt: toEpochMs(data as string), error: null };
}

export type UnlockResult = 'unlocked' | 'not_here' | 'not_open' | 'closed' | 'too_many';

/**
 * Unlocks by being there. The server measures the distance from `position` to
 * the fence itself, then hands back the sealed text, so a successful unlock
 * needs no refetch to show it.
 */
export async function unlockMessage(
  messageId: string,
  position: Fix,
): Promise<{
  result: UnlockResult | null;
  body: string | null;
  nextClue: string | null;
  error: string | null;
}> {
  const { data, error } = await supabase.rpc('unlock_message', {
    p_message_id: messageId,
    p_latitude: position.latitude,
    p_longitude: position.longitude,
    p_accuracy: position.accuracy ?? undefined,
  });

  if (error) return { result: null, body: null, nextClue: null, error: describeError(error) };
  const r = (data ?? {}) as { status?: UnlockResult; body?: string | null; next_clue?: string | null };
  return { result: r.status ?? null, body: r.body ?? null, nextClue: r.next_clue ?? null, error: null };
}

/**
 * Live inserts on `messages` and `message_unlocks`, and reaction changes. RLS
 * applies to realtime, so this only delivers messages in your threads, your own
 * unlocks, receipts for your messages from finders who share them, and
 * reactions in your threads. Returns the unsubscribe.
 *
 * Rows arrive raw: no embedded sender or finder profile.
 */
export function subscribeToMessageEvents(
  myId: string,
  handlers: {
    onMessage: (row: Record<string, unknown>) => void;
    onUnlock: (row: Record<string, unknown>) => void;
    /** Inserts and updates; a removed reaction arrives as an update to null. */
    onReaction: (row: Record<string, unknown>) => void;
  },
): () => void {
  const channel = supabase
    .channel(`messages:${myId}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, (p) =>
      handlers.onMessage(p.new),
    )
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'message_unlocks' }, (p) =>
      handlers.onUnlock(p.new),
    )
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'message_reactions' }, (p) =>
      handlers.onReaction(p.new),
    )
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'message_reactions' }, (p) =>
      handlers.onReaction(p.new),
    )
    .subscribe();

  return () => {
    void supabase.removeChannel(channel);
  };
}

/** Exposed so realtime can map a raw row with a separately-resolved sender. */
export function messageFromRealtimeRow(
  row: Record<string, unknown>,
  sender: Person,
  myId: string,
): Message {
  return toMessage(
    {
      ...(row as unknown as MessageRowWithRefs),
      sender: {
        id: sender.id,
        name: sender.name,
        handle: sender.handle,
        avatar_url: sender.avatarUrl,
      },
      // A realtime payload carries the row only. Whether *this* viewer has
      // unlocked it is not in there, so treat it as locked; the reducer keeps
      // any unlock already known locally.
      unlocks: [],
      reactions: [],
      // Realtime carries the shared row only, so a fenced message arrives
      // without its text whoever you are.
      sealed: null,
      // A realtime row has no embedded trail. Trail rows are refetched rather
      // than mapped from realtime (see onRemoteMessage), so none arrive here.
      trail: null,
    },
    myId,
  );
}

/**
 * Sets, changes or removes (emoji = null) this viewer's reaction. An upsert on
 * the (message_id, user_id) key, so every case is the same call. Removal is an
 * update to null rather than a delete; see the reactions migration for why.
 */
export async function setReaction(
  messageId: string,
  myId: string,
  emoji: Reaction | null,
): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from('message_reactions')
    .upsert({ message_id: messageId, user_id: myId, emoji }, { onConflict: 'message_id,user_id' });
  return { error: error ? describeError(error) : null };
}
