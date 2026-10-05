// Push Edge Function: turns database inserts into Expo push notifications.
//
// Invoked by Database Webhooks (see supabase/README.md → Push):
//   - INSERT on public.messages          → every other participant
//   - INSERT on public.message_unlocks   → the message's sender, if the finder
//                                          shares receipts
//   - INSERT on public.message_reactions → the message's author, at most one
//                                          reaction push per 5 minutes
//
// Message pushes go to recipients only and unlock pushes to senders only, so
// neither duplicates the finder's local arrival alert from the geofence task.
//
// Runs with the service role, which bypasses RLS, so every audience below is
// derived explicitly from participants and the receipt setting — never from
// what the webhook payload claims beyond the inserted row.

import { createClient } from 'jsr:@supabase/supabase-js@2';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
/** Expo accepts at most 100 messages per request. */
const EXPO_BATCH = 100;
const PREVIEW_LENGTH = 140;
/** Quoted message text in a reaction push is shorter: it sits after the emoji. */
const REACTION_PREVIEW_LENGTH = 60;
/** Several reactions to one author within this window become one push. */
const REACTION_WINDOW_SECONDS = 5 * 60;
/** Must match MESSAGES_CHANNEL in src/lib/notifications.ts. */
const ANDROID_CHANNEL = 'messages';

type WebhookPayload = {
  type: 'INSERT' | 'UPDATE' | 'DELETE';
  table: string;
  schema: string;
  record: Record<string, unknown> | null;
};

type MessageRecord = {
  id: string;
  conversation_id: string;
  sender_id: string;
  body: string;
  fence_latitude: number | null;
  fence_label: string | null;
};

type UnlockRecord = { message_id: string; user_id: string };

type ReactionRecord = { message_id: string; user_id: string; emoji: string | null };

type ExpoMessage = {
  to: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  sound: 'default';
  channelId: string;
};

type ExpoTicket = { status: 'ok' | 'error'; details?: { error?: string } };

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false } },
);

Deno.serve(async (req) => {
  const secret = Deno.env.get('PUSH_WEBHOOK_SECRET');
  if (!secret || req.headers.get('x-webhook-secret') !== secret) {
    return new Response('unauthorized', { status: 401 });
  }

  let payload: WebhookPayload;
  try {
    payload = await req.json();
  } catch {
    return new Response('bad payload', { status: 400 });
  }
  if (payload.type !== 'INSERT' || payload.schema !== 'public' || !payload.record) {
    return Response.json({ skipped: 'not an insert' });
  }

  try {
    const messages =
      payload.table === 'messages'
        ? await forNewMessage(payload.record as unknown as MessageRecord)
        : payload.table === 'message_unlocks'
          ? await forUnlock(payload.record as unknown as UnlockRecord)
          : payload.table === 'message_reactions'
            ? await forReaction(payload.record as unknown as ReactionRecord)
            : [];

    const sent = await send(messages);
    return Response.json({ sent });
  } catch (e) {
    console.error(e);
    return new Response('push failed', { status: 500 });
  }
});

/** A new message: push every participant except the sender. */
async function forNewMessage(message: MessageRecord): Promise<ExpoMessage[]> {
  const [{ data: participants }, { data: conversation }, sender] = await Promise.all([
    supabase
      .from('conversation_participants')
      .select('user_id')
      .eq('conversation_id', message.conversation_id)
      .neq('user_id', message.sender_id),
    supabase
      .from('conversations')
      .select('is_group, title')
      .eq('id', message.conversation_id)
      .maybeSingle(),
    profileName(message.sender_id),
  ]);

  const recipientIds = (participants ?? []).map((p) => p.user_id as string);
  if (recipientIds.length === 0) return [];

  const title =
    conversation?.is_group && conversation.title ? `${sender} · ${conversation.title}` : sender;

  // A fenced message's text never goes on a lock screen: the reader is not at
  // the place yet. Same rule as notifyArrival in src/lib/notifications.ts.
  const isFenced = message.fence_latitude != null;
  const body = isFenced
    ? `Left you a message at ${message.fence_label || 'a place'}`
    : truncate(message.body, PREVIEW_LENGTH);

  return toExpoMessages(recipientIds, {
    title,
    body,
    data: { conversationId: message.conversation_id, kind: 'message' },
  });
}

/** Someone unlocked a message: tell its sender, if the finder shares receipts. */
async function forUnlock(unlock: UnlockRecord): Promise<ExpoMessage[]> {
  const [{ data: message }, { data: finder }] = await Promise.all([
    supabase
      .from('messages')
      .select('id, conversation_id, sender_id, fence_label')
      .eq('id', unlock.message_id)
      .maybeSingle(),
    supabase
      .from('profiles')
      .select('name, share_unlock_receipts')
      .eq('id', unlock.user_id)
      .maybeSingle(),
  ]);

  if (!message || !finder) return [];
  if (message.sender_id === unlock.user_id) return [];
  // The same rule RLS enforces for reads: opted out means the sender learns nothing.
  if (!finder.share_unlock_receipts) return [];

  const place = message.fence_label || 'the place you picked';
  return toExpoMessages([message.sender_id as string], {
    title: 'Found it',
    body: `${finder.name} found your message at ${place}`,
    data: { conversationId: message.conversation_id, kind: 'receipt' },
  });
}

/**
 * Someone reacted: tell the message's author, collapsed so a burst of
 * reactions is one push. Only inserts arrive here, so changing a reaction (an
 * update) never pushes. The later reactions in a burst still show live in the
 * app through realtime.
 */
async function forReaction(reaction: ReactionRecord): Promise<ExpoMessage[]> {
  if (!reaction.emoji) return [];

  const { data: message } = await supabase
    .from('messages')
    .select('id, conversation_id, sender_id, body, fence_latitude, fence_label')
    .eq('id', reaction.message_id)
    .maybeSingle();
  if (!message || message.sender_id === reaction.user_id) return [];

  // Atomic: of several reactions landing at once, exactly one claims the slot.
  const { data: claimed, error } = await supabase.rpc('claim_push_slot', {
    p_recipient_id: message.sender_id,
    p_kind: 'reaction',
    p_window_seconds: REACTION_WINDOW_SECONDS,
  });
  if (error) throw error;
  if (!claimed) return [];

  const reactor = await profileName(reaction.user_id);
  // A fenced message's text stays off the lock screen here too, even though
  // the reactor has read it: the author's lock screen is not the place.
  const body =
    message.fence_latitude != null
      ? `Reacted ${reaction.emoji} to your message at ${message.fence_label || 'a place'}`
      : `Reacted ${reaction.emoji} to “${truncate(message.body as string, REACTION_PREVIEW_LENGTH)}”`;

  return toExpoMessages([message.sender_id as string], {
    title: reactor,
    body,
    data: { conversationId: message.conversation_id, kind: 'reaction' },
  });
}

async function profileName(id: string): Promise<string> {
  const { data } = await supabase.from('profiles').select('name').eq('id', id).maybeSingle();
  return (data?.name as string | undefined) ?? 'Someone';
}

async function toExpoMessages(
  userIds: string[],
  content: Pick<ExpoMessage, 'title' | 'body' | 'data'>,
): Promise<ExpoMessage[]> {
  const { data: tokens, error } = await supabase
    .from('push_tokens')
    .select('token')
    .in('user_id', userIds);
  if (error) throw error;

  return (tokens ?? []).map((t) => ({
    to: t.token as string,
    ...content,
    sound: 'default',
    channelId: ANDROID_CHANNEL,
  }));
}

/**
 * Sends in batches and prunes tokens Expo reports as DeviceNotRegistered — the
 * app was uninstalled or the token rolled, and it will never work again.
 * Tickets come back in the same order as the messages sent.
 */
async function send(messages: ExpoMessage[]): Promise<number> {
  const dead: string[] = [];

  for (let i = 0; i < messages.length; i += EXPO_BATCH) {
    const batch = messages.slice(i, i + EXPO_BATCH);
    const res = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...(Deno.env.get('EXPO_ACCESS_TOKEN')
          ? { Authorization: `Bearer ${Deno.env.get('EXPO_ACCESS_TOKEN')}` }
          : {}),
      },
      body: JSON.stringify(batch),
    });

    if (!res.ok) {
      console.error('expo push failed', res.status, await res.text());
      continue;
    }

    const { data: tickets } = (await res.json()) as { data: ExpoTicket[] };
    tickets.forEach((ticket, j) => {
      if (ticket.status === 'error' && ticket.details?.error === 'DeviceNotRegistered') {
        dead.push(batch[j].to);
      }
    });
  }

  if (dead.length > 0) {
    await supabase.from('push_tokens').delete().in('token', dead);
  }
  return messages.length - dead.length;
}

function truncate(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`;
}
