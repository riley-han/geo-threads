import * as SQLite from 'expo-sqlite';

export const DATABASE_NAME = 'geo-threads.db';

const SCHEMA_VERSION = 3;

/**
 * Runs on every open via SQLiteProvider's onInit.
 *
 * Since v3 this database holds no application data. Conversations, messages,
 * friendships and profiles all live in Postgres, scoped to the signed-in user
 * by row level security. What remains is a mirror of the fenced messages still
 * awaiting arrival, because the background geofencing task has no session and
 * cannot query the server — see src/db/fence-mirror.ts.
 */
export async function migrateDb(db: SQLite.SQLiteDatabase): Promise<void> {
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  const current = row?.user_version ?? 0;
  if (current >= SCHEMA_VERSION) return;

  await db.execAsync(`
    PRAGMA journal_mode = WAL;

    -- Dropped rather than left in place. The server owns this data now, and
    -- tables that still exist invite someone to read from them.
    DROP TABLE IF EXISTS messages;
    DROP TABLE IF EXISTS conversations;
    DROP TABLE IF EXISTS friendships;
    DROP TABLE IF EXISTS profile;

    CREATE TABLE IF NOT EXISTS pending_fenced (
      message_id      TEXT PRIMARY KEY NOT NULL,
      conversation_id TEXT NOT NULL,
      sender_name     TEXT NOT NULL,
      fence_key       TEXT NOT NULL,
      fence_label     TEXT NOT NULL,
      sent_at         TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_pending_fenced_key ON pending_fenced (fence_key);

    CREATE TABLE IF NOT EXISTS mirror_meta (
      id       INTEGER PRIMARY KEY CHECK (id = 1),
      owner_id TEXT
    );
  `);

  await db.runAsync('INSERT OR IGNORE INTO mirror_meta (id, owner_id) VALUES (1, NULL)');
  await db.execAsync(`PRAGMA user_version = ${SCHEMA_VERSION}`);
}

/**
 * Opens the database outside React — used by the background geofencing task.
 *
 * Deliberately does not run migrateDb. On a first-ever launch straight into the
 * task the mirror may not exist yet; the task's own catch swallows that and
 * skips one notification, which is a better trade than running a migration
 * from a headless context with a few seconds of OS budget.
 */
export async function openDatabase(): Promise<SQLite.SQLiteDatabase> {
  return SQLite.openDatabaseAsync(DATABASE_NAME);
}
