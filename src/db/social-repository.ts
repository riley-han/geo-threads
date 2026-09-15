import type { SQLiteDatabase } from 'expo-sqlite';

/** SQL for the social graph. Mirrors the messages-repository seam. */

export type FriendStatus = 'pending_out' | 'pending_in' | 'accepted';

export type Friendship = {
  contactId: string;
  status: FriendStatus;
  updatedAt: number;
};

export type MyProfile = {
  name: string;
  handle: string;
};

type FriendshipRow = { contact_id: string; status: string; updated_at: number };

export async function loadFriendships(db: SQLiteDatabase): Promise<Friendship[]> {
  const rows = await db.getAllAsync<FriendshipRow>('SELECT * FROM friendships');
  return rows.map((r) => ({
    contactId: r.contact_id,
    status: r.status as FriendStatus,
    updatedAt: r.updated_at,
  }));
}

export async function upsertFriendship(
  db: SQLiteDatabase,
  contactId: string,
  status: FriendStatus,
  updatedAt: number,
): Promise<void> {
  await db.runAsync(
    `INSERT INTO friendships (contact_id, status, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(contact_id) DO UPDATE SET status = excluded.status, updated_at = excluded.updated_at`,
    [contactId, status, updatedAt],
  );
}

export async function deleteFriendship(db: SQLiteDatabase, contactId: string): Promise<void> {
  await db.runAsync('DELETE FROM friendships WHERE contact_id = ?', [contactId]);
}

export async function loadProfile(db: SQLiteDatabase): Promise<MyProfile> {
  const row = await db.getFirstAsync<MyProfile>('SELECT name, handle FROM profile WHERE id = 1');
  return row ?? { name: 'You', handle: '@you' };
}

export async function saveProfile(db: SQLiteDatabase, profile: MyProfile): Promise<void> {
  await db.runAsync('UPDATE profile SET name = ?, handle = ? WHERE id = 1', [
    profile.name,
    profile.handle,
  ]);
}
