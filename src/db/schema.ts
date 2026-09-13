import * as SQLite from 'expo-sqlite';

import { SEED_CONVERSATIONS, SEED_MESSAGES } from '@/data/seed-conversations';

export const DATABASE_NAME = 'geo-threads.db';

const SCHEMA_VERSION = 1;

/**
 * Runs on every open via SQLiteProvider's onInit. Seeds only on a fresh install —
 * once user_version is stamped, seed data is never re-applied over real messages.
 */
export async function migrateDb(db: SQLite.SQLiteDatabase): Promise<void> {
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  const current = row?.user_version ?? 0;
  if (current >= SCHEMA_VERSION) return;

  if (current === 0) {
    await db.execAsync(`
      PRAGMA journal_mode = WAL;

      CREATE TABLE conversations (
        id TEXT PRIMARY KEY NOT NULL,
        participant_ids TEXT NOT NULL,
        is_group INTEGER NOT NULL,
        title TEXT,
        unread INTEGER NOT NULL
      );

      CREATE TABLE messages (
        id TEXT PRIMARY KEY NOT NULL,
        conversation_id TEXT NOT NULL,
        sender_id TEXT NOT NULL,
        body TEXT NOT NULL,
        sent_at INTEGER NOT NULL,
        fence_latitude REAL,
        fence_longitude REAL,
        fence_radius REAL,
        fence_label TEXT,
        fence_key TEXT,
        unlocked_at INTEGER
      );

      CREATE INDEX idx_messages_conversation ON messages (conversation_id, sent_at);
      CREATE INDEX idx_messages_fence_key ON messages (fence_key);
    `);

    await db.withTransactionAsync(async () => {
      for (const c of SEED_CONVERSATIONS) {
        await db.runAsync(
          'INSERT INTO conversations (id, participant_ids, is_group, title, unread) VALUES (?, ?, ?, ?, ?)',
          [c.id, JSON.stringify(c.participantIds), c.isGroup ? 1 : 0, c.title ?? null, c.unread ? 1 : 0],
        );
      }
      for (const m of SEED_MESSAGES) {
        await db.runAsync(
          `INSERT INTO messages
             (id, conversation_id, sender_id, body, sent_at,
              fence_latitude, fence_longitude, fence_radius, fence_label, fence_key, unlocked_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
          [
            m.id,
            m.conversationId,
            m.senderId,
            m.body,
            m.sentAt,
            m.fence?.latitude ?? null,
            m.fence?.longitude ?? null,
            m.fence?.radiusMeters ?? null,
            m.fence?.label ?? null,
            m.fence ? fenceKeyOf(m.fence) : null,
          ],
        );
      }
    });
  }

  await db.execAsync(`PRAGMA user_version = ${SCHEMA_VERSION}`);
}

// Local copy to keep schema.ts free of a cycle through data/types.
function fenceKeyOf(fence: { latitude: number; longitude: number; radiusMeters: number }): string {
  return `${fence.latitude.toFixed(5)}:${fence.longitude.toFixed(5)}:${Math.round(fence.radiusMeters)}`;
}

/** Opens the database outside React — used by the background geofencing task. */
export async function openDatabase(): Promise<SQLite.SQLiteDatabase> {
  return SQLite.openDatabaseAsync(DATABASE_NAME);
}
