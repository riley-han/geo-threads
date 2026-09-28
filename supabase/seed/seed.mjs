/**
 * Seeds test accounts and threads into the linked Supabase project.
 *
 *   npm run db:seed
 *
 * Why a script and not supabase/seed.sql: creating a usable account means
 * creating an auth user, which has to go through GoTrue so passwords are hashed
 * and the on_auth_user_created trigger fires to build the profile row. Inserting
 * into auth.users by hand breaks across GoTrue versions.
 *
 * This runs with the service-role key, which bypasses RLS entirely. It is a
 * development tool and must never be imported by the app. Note it deliberately
 * imports nothing from src/ — src/lib/supabase.ts throws without the
 * EXPO_PUBLIC_ vars and would create a second client.
 *
 * Idempotent: users are looked up by email before creation, and every row it
 * writes has a deterministic id, so re-running updates in place rather than
 * duplicating.
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PASSWORD = 'threads-dev-1234';
const DOMAIN = 'geothreads.test';

const url = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceRoleKey) {
  console.error(`
Missing credentials. Add these to .env.local (gitignored):

  SUPABASE_URL=https://<project-ref>.supabase.co
  SUPABASE_SERVICE_ROLE_KEY=<service role key>

Find the service role key in the dashboard under Project Settings → API Keys.
It bypasses RLS, so it must NEVER carry an EXPO_PUBLIC_ prefix and must never
be imported from anything under src/.
`);
  process.exit(1);
}

// Guard against seeding the wrong project. The CLI records the linked ref when
// you run `supabase link`; if the URL in the environment points somewhere else,
// that is far more likely to be a mistake than an intention.
try {
  const linked = readFileSync(join(HERE, '..', '.temp', 'project-ref'), 'utf8').trim();
  const host = new URL(url).host;
  if (linked && !host.startsWith(`${linked}.`)) {
    console.error(
      `Refusing to run.\n\n  SUPABASE_URL points at : ${host}\n  the linked project is  : ${linked}.supabase.co\n\n` +
        'Fix SUPABASE_URL in .env.local, or re-link with `npx supabase link`.',
    );
    process.exit(1);
  }
} catch {
  // Not linked, or no .temp — fall through and rely on the confirmation below.
}

console.log(`Seeding ${new URL(url).host}\n`);

const admin = createClient(url, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const die = (label, error) => {
  if (!error) return;
  console.error(`\n✗ ${label}: ${error.message ?? error}`);
  process.exit(1);
};

// Deterministic ids, so a second run overwrites rather than duplicates.
const cid = (n) => `000c0000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const mid = (n) => `000e0000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const PEOPLE = [
  { key: 'ada', name: 'Ada Okafor', handle: 'ada' },
  { key: 'miguel', name: 'Miguel Santos', handle: 'miguel' },
  { key: 'priya', name: 'Priya Balachandran', handle: 'priya' },
  { key: 'theo', name: 'Theo Marchetti', handle: 'theo' },
];

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

/** Walks the paginated admin list once, so we can match on email. */
async function existingByEmail() {
  const found = new Map();
  for (let page = 1; ; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    die('listing users', error);
    for (const u of data.users) if (u.email) found.set(u.email.toLowerCase(), u);
    if (data.users.length < 200) break;
  }
  return found;
}

const existing = await existingByEmail();
const ids = {};

for (const person of PEOPLE) {
  const email = `${person.key}@${DOMAIN}`;
  const already = existing.get(email);

  if (already) {
    ids[person.key] = already.id;
    console.log(`  · ${email} already exists`);
    continue;
  }

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    // Without this the account needs an email confirmation that will never
    // arrive — these addresses do not resolve.
    email_confirm: true,
    // Read by the handle_new_user trigger to build the profile row.
    user_metadata: { name: person.name, handle: person.handle },
  });
  die(`creating ${email}`, error);
  ids[person.key] = data.user.id;
  console.log(`  + ${email}`);
}

// The trigger writes the profile, but it suffixes a handle that is already
// taken. Re-assert the intended values so a re-run against a project with
// collisions still lands on the handles used below.
for (const person of PEOPLE) {
  const { error } = await admin
    .from('profiles')
    .update({ name: person.name, handle: person.handle })
    .eq('id', ids[person.key]);
  die(`setting profile for ${person.key}`, error);
}

// ---------------------------------------------------------------------------
// Friendships
//
// One row per pair, requester_id recording who asked. theo → ada is left
// pending so the accept/decline path is reachable on a single device.
// ---------------------------------------------------------------------------

const friendships = [
  { requester_id: ids.ada, addressee_id: ids.miguel, status: 'accepted' },
  { requester_id: ids.ada, addressee_id: ids.priya, status: 'accepted' },
  { requester_id: ids.theo, addressee_id: ids.ada, status: 'pending' },
];

for (const f of friendships) {
  // The unique index is on (least, greatest), which onConflict cannot name, so
  // clear any existing row for the pair first.
  await admin
    .from('friendships')
    .delete()
    .or(
      `and(requester_id.eq.${f.requester_id},addressee_id.eq.${f.addressee_id}),` +
        `and(requester_id.eq.${f.addressee_id},addressee_id.eq.${f.requester_id})`,
    );
  const { error } = await admin.from('friendships').insert(f);
  die('creating friendship', error);
}
console.log(`  + ${friendships.length} friendships`);

// ---------------------------------------------------------------------------
// Conversations
//
// Inserted directly rather than through create_conversation(): that RPC is
// SECURITY INVOKER and raises 'not authenticated' when auth.uid() is null,
// which it is for a service-role client. Every conversation gets a participant
// row for each member — a conversation whose creator is not a participant makes
// the RPC's dedupe miss and create a duplicate thread later.
// ---------------------------------------------------------------------------

const conversations = [
  { id: cid(1), is_group: false, title: null, created_by: ids.ada, members: [ids.ada, ids.miguel] },
  { id: cid(2), is_group: false, title: null, created_by: ids.priya, members: [ids.priya, ids.ada] },
];

for (const c of conversations) {
  const { members, ...row } = c;
  die(
    'creating conversation',
    (await admin.from('conversations').upsert(row, { onConflict: 'id' })).error,
  );
  die(
    'adding participants',
    (
      await admin.from('conversation_participants').upsert(
        // last_read_at stays null so the inbox shows unread dots.
        members.map((user_id) => ({ conversation_id: c.id, user_id, last_read_at: null })),
        { onConflict: 'conversation_id,user_id' },
      )
    ).error,
  );
}
console.log(`  + ${conversations.length} conversations`);

// ---------------------------------------------------------------------------
// Messages
//
// sent_at is set explicitly here only so the seeded threads have a believable
// order; the app never sends it. fence_key is never set — a trigger derives it
// from the coordinates.
// ---------------------------------------------------------------------------

const minutesAgo = (n) => new Date(Date.now() - n * 60_000).toISOString();

const messages = [
  {
    id: mid(1),
    conversation_id: cid(1),
    sender_id: ids.miguel,
    body: 'Are you around this weekend?',
    sent_at: minutesAgo(180),
  },
  {
    id: mid(2),
    conversation_id: cid(1),
    sender_id: ids.ada,
    body: 'Should be — what did you have in mind?',
    sent_at: minutesAgo(174),
  },
  {
    // The fenced one. Ferry Building, matching DEFAULT_POSITION in
    // src/data/places.ts, so the conversation screen's jump pill unlocks it.
    id: mid(3),
    conversation_id: cid(1),
    sender_id: ids.miguel,
    body: 'Left something here for you. Come find it.',
    sent_at: minutesAgo(30),
    fence_latitude: 37.7955,
    fence_longitude: -122.3937,
    fence_radius_meters: 200,
    fence_label: 'Ferry Building',
  },
  {
    id: mid(4),
    conversation_id: cid(2),
    sender_id: ids.priya,
    body: 'That place you mentioned was great, thank you',
    sent_at: minutesAgo(90),
  },
];

die('creating messages', (await admin.from('messages').upsert(messages, { onConflict: 'id' })).error);
console.log(`  + ${messages.length} messages (1 fenced)\n`);

console.log('Done. Sign in as any of:\n');
for (const p of PEOPLE) console.log(`  ${p.key}@${DOMAIN}`);
console.log(`\nPassword for all: ${PASSWORD}`);
console.log('\nada has two friends, one incoming request, two threads, and one locked message.');
