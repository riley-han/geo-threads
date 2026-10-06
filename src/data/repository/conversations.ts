import type { Conversation } from '@/data/types';
import { supabase } from '@/lib/supabase';

import { describeError } from './errors';
import { toConversation, type ConversationRowWithRefs } from './mappers';

/**
 * Participants come with their profiles so the inbox can title a thread without
 * a second query, and `last_messages` is the newest single message, which is
 * all the list needs. Both FK hints are required — `conversation_participants`
 * and `messages` each reference `profiles`.
 */
const CONVERSATION_SELECT = `
  id, is_group, title, created_at,
  participants:conversation_participants (
    user_id, last_read_at,
    profile:profiles!conversation_participants_user_id_fkey ( id, name, handle, avatar_url )
  ),
  last_messages:messages (
    id, conversation_id, sender_id, body, sent_at,
    fence_latitude, fence_longitude, fence_radius_meters, fence_label, fence_key,
    sender:profiles!messages_sender_id_fkey ( id, name, handle, avatar_url ),
    unlocks:message_unlocks ( user_id, unlocked_at ),
    reactions:message_reactions ( user_id, emoji ),
    trail_id, trail_step, next_clue,
    trail:trails!messages_trail_id_fkey ( id, title, reveal_mode, step_count )
  )
`;

export async function fetchConversations(
  myId: string,
): Promise<{ conversations: Conversation[]; error: string | null }> {
  const { data, error } = await supabase
    .from('conversations')
    // No filter on the root: the SELECT policy on `conversations` already
    // restricts this to threads I am a participant of. Adding a client-side
    // filter would duplicate the rule in a second place that can drift.
    .select(CONVERSATION_SELECT)
    .order('sent_at', { referencedTable: 'last_messages', ascending: false })
    .limit(1, { referencedTable: 'last_messages' });

  if (error) return { conversations: [], error: describeError(error) };
  return {
    conversations: (data as unknown as ConversationRowWithRefs[]).map((r) =>
      toConversation(r, myId),
    ),
    error: null,
  };
}

export async function fetchConversation(
  id: string,
  myId: string,
): Promise<{ conversation: Conversation | null; error: string | null }> {
  const { data, error } = await supabase
    .from('conversations')
    .select(CONVERSATION_SELECT)
    .eq('id', id)
    .order('sent_at', { referencedTable: 'last_messages', ascending: false })
    .limit(1, { referencedTable: 'last_messages' })
    .maybeSingle();

  if (error) return { conversation: null, error: describeError(error) };
  if (!data) return { conversation: null, error: null };
  return {
    conversation: toConversation(data as unknown as ConversationRowWithRefs, myId),
    error: null,
  };
}

/**
 * Creates a thread, or returns the existing one with identical membership.
 *
 * Goes through the RPC rather than inserting here: the conversation row and its
 * participant rows have to land in one transaction, or a failure partway leaves
 * a thread nobody is in. The RPC is SECURITY INVOKER, so RLS still enforces the
 * friends-only rule — the policy stays the single place that rule lives.
 *
 * Note it matches on membership alone and ignores the title, so reusing a
 * thread silently discards a new one.
 */
export async function createConversation(
  participantIds: string[],
  title?: string,
): Promise<{ id: string | null; error: string | null }> {
  const { data, error } = await supabase.rpc('create_conversation', {
    p_participant_ids: participantIds,
    // '' would violate the 1..120 check constraint; absent is the valid way to
    // say "no title".
    p_title: title?.trim() || undefined,
  });

  if (error) return { id: null, error: describeError(error, 'friend') };
  return { id: data as string, error: null };
}

/** Marking a thread read is an update to your own participant row. */
export async function markConversationRead(
  conversationId: string,
  myId: string,
): Promise<{ readAt: number; error: string | null }> {
  const readAt = Date.now();
  const { error } = await supabase
    .from('conversation_participants')
    .update({ last_read_at: new Date(readAt).toISOString() })
    .eq('conversation_id', conversationId)
    .eq('user_id', myId);

  if (error) return { readAt, error: describeError(error) };
  return { readAt, error: null };
}
