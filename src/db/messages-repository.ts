import type { SQLiteDatabase } from 'expo-sqlite';

import { ME_ID } from '@/data/contacts';
import { fenceKey, type Conversation, type Message } from '@/data/types';
import type { Geofence } from '@/lib/geo';

/**
 * Every SQL statement in the app lives here. Screens and stores talk to these
 * functions, so swapping local storage for a synced backend touches only this file.
 */

type MessageRow = {
  id: string;
  conversation_id: string;
  sender_id: string;
  body: string;
  sent_at: number;
  fence_latitude: number | null;
  fence_longitude: number | null;
  fence_radius: number | null;
  fence_label: string | null;
  unlocked_at: number | null;
};

type ConversationRow = {
  id: string;
  participant_ids: string;
  is_group: number;
  title: string | null;
  unread: number;
};

function toMessage(row: MessageRow): Message {
  const fence: Geofence | undefined =
    row.fence_latitude != null && row.fence_longitude != null && row.fence_radius != null
      ? {
          latitude: row.fence_latitude,
          longitude: row.fence_longitude,
          radiusMeters: row.fence_radius,
          label: row.fence_label ?? '',
        }
      : undefined;

  return {
    id: row.id,
    conversationId: row.conversation_id,
    senderId: row.sender_id,
    body: row.body,
    sentAt: row.sent_at,
    fence,
    unlockedAt: row.unlocked_at,
  };
}

function toConversation(row: ConversationRow): Conversation {
  return {
    id: row.id,
    participantIds: JSON.parse(row.participant_ids) as string[],
    isGroup: row.is_group === 1,
    title: row.title ?? undefined,
    unread: row.unread === 1,
  };
}

export async function loadConversations(db: SQLiteDatabase): Promise<Conversation[]> {
  const rows = await db.getAllAsync<ConversationRow>('SELECT * FROM conversations');
  return rows.map(toConversation);
}

export async function loadMessages(db: SQLiteDatabase): Promise<Message[]> {
  const rows = await db.getAllAsync<MessageRow>('SELECT * FROM messages ORDER BY sent_at ASC');
  return rows.map(toMessage);
}

export async function insertMessage(
  db: SQLiteDatabase,
  message: Omit<Message, 'unlockedAt'>,
): Promise<void> {
  await db.runAsync(
    `INSERT INTO messages
       (id, conversation_id, sender_id, body, sent_at,
        fence_latitude, fence_longitude, fence_radius, fence_label, fence_key, unlocked_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    [
      message.id,
      message.conversationId,
      message.senderId,
      message.body,
      message.sentAt,
      message.fence?.latitude ?? null,
      message.fence?.longitude ?? null,
      message.fence?.radiusMeters ?? null,
      message.fence?.label ?? null,
      message.fence ? fenceKey(message.fence) : null,
    ],
  );
}

export async function insertConversation(
  db: SQLiteDatabase,
  conversation: Conversation,
): Promise<void> {
  await db.runAsync(
    'INSERT INTO conversations (id, participant_ids, is_group, title, unread) VALUES (?, ?, ?, ?, ?)',
    [
      conversation.id,
      JSON.stringify(conversation.participantIds),
      conversation.isGroup ? 1 : 0,
      conversation.title ?? null,
      conversation.unread ? 1 : 0,
    ],
  );
}

export async function markConversationRead(db: SQLiteDatabase, id: string): Promise<void> {
  await db.runAsync('UPDATE conversations SET unread = 0 WHERE id = ?', [id]);
}

export async function markMessageUnlocked(
  db: SQLiteDatabase,
  id: string,
  at: number,
): Promise<void> {
  await db.runAsync('UPDATE messages SET unlocked_at = ? WHERE id = ? AND unlocked_at IS NULL', [
    at,
    id,
  ]);
}

/**
 * Fenced messages the reader has not unlocked yet. This is the set worth
 * monitoring — used by geofence registration and by the background task, which
 * runs with no React state available.
 */
export async function loadPendingFencedMessages(db: SQLiteDatabase): Promise<Message[]> {
  const rows = await db.getAllAsync<MessageRow>(
    `SELECT * FROM messages
      WHERE fence_key IS NOT NULL
        AND unlocked_at IS NULL
        AND sender_id != ?
      ORDER BY sent_at DESC`,
    [ME_ID],
  );
  return rows.map(toMessage);
}

/** Pending messages at one place, for composing an arrival notification. */
export async function loadPendingMessagesForFence(
  db: SQLiteDatabase,
  key: string,
): Promise<Message[]> {
  const rows = await db.getAllAsync<MessageRow>(
    `SELECT * FROM messages
      WHERE fence_key = ?
        AND unlocked_at IS NULL
        AND sender_id != ?
      ORDER BY sent_at DESC`,
    [key, ME_ID],
  );
  return rows.map(toMessage);
}
