import type { SQLiteDatabase } from 'expo-sqlite';

/**
 * The only local storage left.
 *
 * The background geofencing task runs when the app may be terminated: there is
 * no React tree, no session, and supabase-js has its token refresh deliberately
 * stopped while backgrounded. It therefore cannot ask the server which messages
 * are waiting at a place — so the app mirrors exactly that set here, and the
 * task reads it.
 *
 * This is a cache, not a source of truth. It holds only what a notification
 * needs: which place, who from, and which thread to open. Never message bodies.
 */

export type MirroredMessage = {
  messageId: string;
  conversationId: string;
  /** Denormalised: the task cannot resolve a sender id to a name on its own. */
  senderName: string;
  fenceKey: string;
  fenceLabel: string;
  /** ISO8601, which sorts lexicographically — so the task needs no date parsing. */
  sentAt: string;
};

type Row = {
  message_id: string;
  conversation_id: string;
  sender_name: string;
  fence_key: string;
  fence_label: string;
  sent_at: string;
};

const toMirrored = (row: Row): MirroredMessage => ({
  messageId: row.message_id,
  conversationId: row.conversation_id,
  senderName: row.sender_name,
  fenceKey: row.fence_key,
  fenceLabel: row.fence_label,
  sentAt: row.sent_at,
});

/**
 * Replaces the whole mirror in one transaction.
 *
 * A full replace rather than a diff because the set is small and correctness
 * matters more than write volume: a stale row here means a notification for a
 * message the reader has already unlocked, or one that is no longer theirs.
 */
export async function replaceMirror(
  db: SQLiteDatabase,
  ownerId: string,
  rows: MirroredMessage[],
): Promise<void> {
  await db.withTransactionAsync(async () => {
    await db.runAsync('DELETE FROM pending_fenced');
    for (const r of rows) {
      await db.runAsync(
        `INSERT INTO pending_fenced
           (message_id, conversation_id, sender_name, fence_key, fence_label, sent_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [r.messageId, r.conversationId, r.senderName, r.fenceKey, r.fenceLabel, r.sentAt],
      );
    }
    await db.runAsync(
      'INSERT INTO mirror_meta (id, owner_id) VALUES (1, ?) ' +
        'ON CONFLICT(id) DO UPDATE SET owner_id = excluded.owner_id',
      [ownerId],
    );
  });
}

/** Read by the background task. The region identifier is the fence key. */
export async function loadMirroredForFence(
  db: SQLiteDatabase,
  fenceKey: string,
): Promise<MirroredMessage[]> {
  const rows = await db.getAllAsync<Row>(
    'SELECT * FROM pending_fenced WHERE fence_key = ? ORDER BY sent_at DESC',
    [fenceKey],
  );
  return rows.map(toMirrored);
}

export async function clearMirror(db: SQLiteDatabase): Promise<void> {
  await db.withTransactionAsync(async () => {
    await db.runAsync('DELETE FROM pending_fenced');
    await db.runAsync('UPDATE mirror_meta SET owner_id = NULL WHERE id = 1');
  });
}

/**
 * Who the mirrored rows belong to.
 *
 * The background task cannot check this — it has no session to compare against.
 * The app checks it on sign-in and clears the mirror when it does not match, so
 * a sign-out interrupted before teardown cannot leak the previous account's
 * sender names into a notification.
 */
export async function mirrorOwner(db: SQLiteDatabase): Promise<string | null> {
  const row = await db.getFirstAsync<{ owner_id: string | null }>(
    'SELECT owner_id FROM mirror_meta WHERE id = 1',
  );
  return row?.owner_id ?? null;
}
