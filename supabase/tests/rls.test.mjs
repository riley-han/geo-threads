// RLS behaviour tests for the Geo Threads schema.
//
// Runs the real migrations against Postgres compiled to WASM (PGlite), so this
// needs no Docker and no network — `npm run db:test`. The point is not that the
// SQL parses; it is that a signed-in user can do exactly what they should and
// nothing more. Each check switches Postgres role to `authenticated` and sets
// the JWT claim, which is what PostgREST does per request, because RLS is
// bypassed for a table owner and would otherwise pass vacuously.
//
// What is stubbed: the `auth` schema, the `anon`/`authenticated` roles,
// `auth.uid()`, and the realtime publication — everything a hosted project
// provides. Grants mirror a hosted project's defaults, so `anon` being blocked
// below is RLS doing the work, not a missing grant.

import { PGlite } from '@electric-sql/pglite';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const MIGRATIONS = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

const db = await PGlite.create();
// Mirror what a hosted Supabase project provides: the auth schema, the two
// roles, auth.uid(), USAGE on auth for authenticated, and the default table
// grants on public (RLS, not grants, is the gate there).
await db.exec(`
  create schema auth;
  create table auth.users (id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb default '{}'::jsonb);
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create role anon; create role authenticated; create role service_role bypassrls;
  grant usage on schema auth to anon, authenticated, service_role;
  create publication supabase_realtime;
`);
for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort()) {
  try {
    await db.exec(readFileSync(join(MIGRATIONS, file), 'utf8'));
  } catch (e) {
    console.error(`\n\x1b[31mmigration ${file} failed:\x1b[0m ${e.message}`);
    process.exit(1);
  }
}
// Only what a hosted project provides *before* our migrations run. Table
// privileges are deliberately NOT granted here: the migrations must grant them
// themselves, or this suite passes against a schema the real app cannot read —
// which is exactly what happened the first time round.
await db.exec(`grant usage on schema public to anon, authenticated;`);

let pass = 0, fail = 0;
const ok  = (m) => { console.log(`  \x1b[32m✔\x1b[0m ${m}`); pass++; };
const bad = (m) => { console.log(`  \x1b[31m✘ ${m}\x1b[0m`); fail++; };
const msg = (e) => (e?.message ?? String(e)).split('\n')[0].slice(0, 70);

async function asUser(uid, fn) {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${uid}',false);`);
  try { return await fn(); } finally { await db.exec(`reset role;`); }
}
// An operation that must be refused: either it errors, or RLS filters it to 0 rows.
const denied = async (label, thunk) => {
  try {
    const r = await thunk();
    const n = Array.isArray(r?.rows) ? r.rows.length : 0;
    n === 0 ? ok(`${label} — blocked`) : bad(`${label} — LEAKED ${n} row(s)`);
  } catch (e) { ok(`${label} — blocked (${msg(e)})`); }
};
// An operation that must succeed.
const allowed = async (label, thunk) => {
  try { const r = await thunk(); ok(label); return r; }
  catch (e) { bad(`${label} — UNEXPECTEDLY BLOCKED (${msg(e)})`); }
};

// Messages and unlocks are written only through functions (see the hardening
// migration). These are the calls the client makes.
const send = async (convo, body, fence = null) => {
  const id = randomUUID();
  await db.query(`select public.send_message($1,$2,$3,$4,$5,$6,$7)`,
    [id, convo, body, fence?.[0] ?? null, fence?.[1] ?? null, fence?.[2] ?? null, fence?.[3] ?? null]);
  return id;
};
const unlock = async (messageId, lat, lng, accuracy = null) =>
  (await db.query(`select public.unlock_message($1,$2,$3,$4) as r`, [messageId, lat, lng, accuracy])).rows[0].r;
// An unlock that must come back with this status (it is a result, not an error).
const unlockIs = async (label, status, messageId, lat, lng = -122.4, accuracy = null) => {
  try {
    const r = await unlock(messageId, lat, lng, accuracy);
    r?.status === status ? ok(label) : bad(`${label} — got ${r?.status}`);
    return r;
  } catch (e) { bad(`${label} — threw (${msg(e)})`); }
};

console.log('\n\x1b[1m── signup trigger ──\x1b[0m');
await db.exec(`insert into auth.users (email, raw_user_meta_data) values
  ('alice@example.com','{"name":"Alice Nguyen","handle":"alice"}'),
  ('bob@example.com','{"name":"Bob Ito"}'),
  ('carol@example.com','{}'),
  ('alice2@example.com','{"name":"Alice Two","handle":"alice"}');`);
const profs = (await db.query(`select p.handle, p.name from public.profiles p join auth.users u on u.id=p.id order by u.email`)).rows;
console.table(profs);
profs.length === 4 ? ok('profile auto-created for all 4 signups') : bad(`only ${profs.length}/4 profiles`);
profs.some(p => p.handle === 'bob') ? ok("handle derived from email when not supplied") : bad('email-derived handle missing');
new Set(profs.map(p=>p.handle)).size === 4 ? ok('handle collision resolved, all unique') : bad('duplicate handles');

const id = async (e) => (await db.query(`select id from auth.users where email=$1`,[e])).rows[0].id;
const [alice, bob, carol] = [await id('alice@example.com'), await id('bob@example.com'), await id('carol@example.com')];

console.log('\n\x1b[1m── friendships ──\x1b[0m');
await asUser(alice, () => allowed('alice sends a friend request as herself',
  () => db.query(`insert into public.friendships (requester_id,addressee_id) values ($1,$2) returning id`,[alice,bob])));
await asUser(alice, () => denied('alice forging a request from bob to carol',
  () => db.query(`insert into public.friendships (requester_id,addressee_id) values ($1,$2)`,[bob,carol])));
await asUser(bob, async () => {
  const r = await db.query(`update public.friendships set status='accepted' where requester_id=$1 returning id`,[alice]);
  r.rows.length === 1 ? ok('bob (addressee) accepts the request') : bad('bob could not accept');
});
await asUser(alice, () => denied('alice self-accepting her own outgoing request',
  () => db.query(`update public.friendships set status='accepted' where addressee_id=$1 returning id`,[carol])));
await asUser(carol, () => denied('carol reading a friendship she is not part of',
  () => db.query(`select * from public.friendships`)));
await asUser(bob, () => denied('reverse-direction duplicate friendship (B→A)',
  () => db.query(`insert into public.friendships (requester_id,addressee_id) values ($1,$2)`,[bob,alice])));

console.log('\n\x1b[1m── conversations: the RETURNING path ──\x1b[0m');
let convo;
await asUser(alice, async () => {
  const r = await allowed('alice creates a conversation with .insert().select()',
    () => db.query(`insert into public.conversations (is_group,created_by) values (false,$1) returning id`,[alice]));
  convo = r?.rows?.[0]?.id;
  if (convo) {
    await allowed('alice reads back her own participant row',
      () => db.query(`insert into public.conversation_participants (conversation_id,user_id) values ($1,$2) returning user_id`,[convo,alice]));
    await allowed('alice adds bob, an accepted friend',
      () => db.query(`insert into public.conversation_participants (conversation_id,user_id) values ($1,$2) returning user_id`,[convo,bob]));
  }
});
await asUser(alice, () => denied('alice adding carol, who is NOT a friend',
  () => db.query(`insert into public.conversation_participants (conversation_id,user_id) values ($1,$2)`,[convo,carol])));
await asUser(carol, () => denied('carol adding herself to their conversation',
  () => db.query(`insert into public.conversation_participants (conversation_id,user_id) values ($1,$2)`,[convo,carol])));
await asUser(carol, () => denied('carol reading the conversation row',
  () => db.query(`select * from public.conversations`)));

console.log('\n\x1b[1m── create_conversation RPC ──\x1b[0m');
await asUser(alice, async () => {
  const r = await allowed('alice calls create_conversation(bob)',
    () => db.query(`select public.create_conversation(array[$1]::uuid[]) as id`,[bob]));
  const first = r?.rows?.[0]?.id;
  const again = (await db.query(`select public.create_conversation(array[$1]::uuid[]) as id`,[bob])).rows[0].id;
  first && first === again ? ok('calling it twice reuses the same thread (no duplicate)') : bad(`duplicate thread created: ${first} vs ${again}`);
  const n = (await db.query(`select count(*)::int as n from public.conversation_participants where conversation_id=$1`,[first])).rows[0].n;
  n === 2 ? ok('both participants were added atomically') : bad(`expected 2 participants, got ${n}`);
});
await asUser(alice, () => denied('RPC refuses a non-friend (rolls the whole thing back)',
  () => db.query(`select public.create_conversation(array[$1]::uuid[]) as id`,[carol])));
const orphans = (await db.query(`select count(*)::int as n from public.conversations c
  where not exists (select 1 from public.conversation_participants cp where cp.conversation_id=c.id)`)).rows[0].n;
orphans === 0 ? ok('no orphaned conversation left behind by the failed call') : bad(`${orphans} orphaned conversation(s)`);
await asUser(alice, () => denied('RPC refuses a conversation with nobody else in it',
  () => db.query(`select public.create_conversation(array[]::uuid[]) as id`)));

console.log('\n\x1b[1m── messages ──\x1b[0m');
let mid;
await asUser(alice, async () => {
  mid = await allowed('alice sends a fenced message with send_message',
    () => send(convo, 'meet me here', [37.7749, -122.4194, 150, 'Dolores Park']));
  const sealed = (await db.query(`select body from public.message_sealed where message_id=$1`,[mid])).rows;
  sealed[0]?.body === 'meet me here' ? ok('alice (sender) reads her own sealed text') : bad(`alice read ${JSON.stringify(sealed)}`);
  const again = await db.query(`select public.send_message($1,$2,'meet me here',37.7749,-122.4194,150,'Dolores Park') as t`,[mid,convo]);
  const n = (await db.query(`select count(*)::int as n from public.messages where id=$1`,[mid])).rows[0].n;
  again.rows.length === 1 && n === 1 ? ok('retrying a send with the same id is a no-op') : bad(`retry made ${n} rows`);
});
await asUser(bob, async () => {
  const r = await db.query(`select body, fence_latitude from public.messages where conversation_id=$1`,[convo]);
  r.rows.length === 1 ? ok('bob (participant) reads the message row') : bad(`bob saw ${r.rows.length} messages, expected 1`);
  r.rows[0]?.body === null && r.rows[0]?.fence_latitude != null
    ? ok("the shared row carries the fence but not the locked text")
    : bad(`bob's row carries body ${JSON.stringify(r.rows[0]?.body)}`);
});
await asUser(bob, () => denied('bob reading the sealed text before unlocking',
  () => db.query(`select * from public.message_sealed where message_id=$1`,[mid])));
await asUser(carol, () => denied("carol reading the thread's messages",
  () => db.query(`select * from public.messages where conversation_id=$1`,[convo])));
await asUser(carol, () => denied('carol posting into their thread',
  () => send(convo, 'hi')));
await asUser(bob, () => denied('bob inserting into messages directly',
  () => db.query(`insert into public.messages (conversation_id,sender_id,body) values ($1,$2,'fake')`,[convo,bob])));
await asUser(bob, () => denied('bob backdating a message with a direct insert',
  () => db.query(`insert into public.messages (conversation_id,sender_id,body,sent_at) values ($1,$2,'old','2001-01-01')`,[convo,bob])));
await asUser(bob, () => denied("bob deleting alice's message",
  () => db.query(`delete from public.messages where id=$1 returning id`,[mid])));

console.log('\n\x1b[1m── fence_key parity with the client\'s fenceKey() ──\x1b[0m');
const keyed = {};
const jsKey = (lat,lng,r) => `${lat.toFixed(5)}:${lng.toFixed(5)}:${Math.round(r)}`;
for (const [lat,lng,r,label] of [[37.7749,-122.4194,150,'typical'],[7.5,-0.5,3000.6,'single digit / negative / rounding'],[0,0,1,'zero'],[-89.123456,179.987654,99999,'extremes']]) {
  const kid = await asUser(alice, () => send(convo, `k:${label}`, [lat, lng, r, null]));
  keyed[label] = kid;
  const pg = (await db.query(`select fence_key from public.messages where id=$1`,[kid])).rows[0].fence_key;
  const js = jsKey(lat,lng,r);
  pg === js ? ok(`${label}: ${pg}`) : bad(`${label}: postgres ${pg} ≠ javascript ${js}`);
}
await asUser(alice, () => send(convo, 'unfenced'));
const nullKey = (await db.query(`select fence_key from public.messages where body='unfenced'`)).rows[0].fence_key;
nullKey === null ? ok('an unfenced message gets a null fence_key') : bad(`unfenced message got key ${nullKey}`);

console.log('\n\x1b[1m── message_unlocks (per-reader state) ──\x1b[0m');
await asUser(bob, () => denied('bob inserting an unlock directly (no position)',
  () => db.query(`insert into public.message_unlocks (message_id,user_id) values ($1,$2)`,[mid,bob])));
await asUser(bob, () => unlockIs('bob unlocking from across town: not_here', 'not_here', mid, 37.70, -122.4194));
await asUser(bob, () => denied('an unlock with no position at all',
  () => unlock(mid, null, null)));
await asUser(bob, async () => {
  const r = await unlockIs('bob unlocks standing at the place', 'unlocked', mid, 37.7749, -122.4194);
  r?.body === 'meet me here' ? ok('the unlock returns the sealed text') : bad(`unlock returned body ${r?.body}`);
  const sealed = (await db.query(`select body from public.message_sealed where message_id=$1`,[mid])).rows.length;
  sealed === 1 ? ok('bob reads the sealed text once unlocked') : bad('bob still cannot read the text');
});
// keyed.typical: 150 m around 37.7749,-122.4194. +0.0015° latitude is ~167 m out.
await asUser(bob, () => unlockIs('167 m out with a perfect fix: not_here', 'not_here', keyed.typical, 37.7764, -122.4194, 0));
await asUser(bob, () => unlockIs('a 100 m accuracy still buys only 25 m: 190 m out is not_here', 'not_here', keyed.typical, 37.7766, -122.4194, 100));
await asUser(bob, () => unlockIs('167 m out with a 30 m accuracy: inside the slack, unlocked', 'unlocked', keyed.typical, 37.7764, -122.4194, 30));
await asUser(carol, () => denied('carol unlocking a message in a thread she is not in',
  () => unlock(mid, 37.7749, -122.4194)));
await asUser(alice, async () => {
  const r = await db.query(`select user_id from public.message_unlocks where message_id=$1`,[mid]);
  r.rows.length === 1 && r.rows[0].user_id === bob
    ? ok("alice (the sender) reads bob's receipt for her message")
    : bad(`alice saw ${r.rows.length} receipt row(s), expected bob's 1`);
});
await asUser(bob, () => denied('bob forging an unlock for alice',
  () => db.query(`insert into public.message_unlocks (message_id,user_id) values ($1,$2)`,[mid,alice])));

console.log('\n\x1b[1m── queries the client depends on ──\x1b[0m');
// The client reads unlocks through an embedded resource
// (`unlocks:message_unlocks(...)`). Since Found It, a sender sees the finders'
// rows there too, so the mapper must pick the viewer's own unlock by user_id
// rather than taking the first row.
await asUser(alice, async () => {
  const r = await db.query(
    `select (select count(*)::int from public.message_unlocks u where u.message_id = m.id) as visible_unlocks
     from public.messages m where m.id = $1`,
    [mid],
  );
  r.rows[0].visible_unlocks === 1
    ? ok("alice sees bob's receipt through an embed-style subquery")
    : bad(`alice sees ${r.rows[0].visible_unlocks} unlock(s), expected 1`);
});
await asUser(bob, async () => {
  const r = await db.query(
    `select (select count(*)::int from public.message_unlocks u where u.message_id = m.id) as visible_unlocks
     from public.messages m where m.id = $1`,
    [mid],
  );
  r.rows[0].visible_unlocks === 1
    ? ok('bob sees exactly his own unlock')
    : bad(`bob sees ${r.rows[0].visible_unlocks} unlocks, expected 1`);
});

// createConversation() in the repository relies on this: opening a chat with
// the same person twice must reuse the thread rather than fork it.
await asUser(alice, async () => {
  const first = (await db.query(`select public.create_conversation(array[$1]::uuid[]) as id`, [bob]))
    .rows[0].id;
  const second = (await db.query(`select public.create_conversation(array[$1]::uuid[]) as id`, [bob]))
    .rows[0].id;
  first === second
    ? ok('create_conversation returns the existing id for identical membership')
    : bad(`create_conversation forked a thread: ${first} vs ${second}`);
});

console.log('\n\x1b[1m── unlock receipts ──\x1b[0m');
const dave = (await db.query(`insert into auth.users (email, raw_user_meta_data) values ('dave@example.com','{"name":"Dave"}') returning id`)).rows[0].id;
// Dave is friends with alice and in a group thread with alice and bob.
await asUser(alice, () => db.query(`insert into public.friendships (requester_id,addressee_id) values ($1,$2)`,[alice,dave]));
await asUser(dave, () => db.query(`update public.friendships set status='accepted' where requester_id=$1`,[alice]));
let group, gmid;
await asUser(alice, async () => {
  group = (await db.query(`select public.create_conversation(array[$1,$2]::uuid[]) as id`,[bob,dave])).rows[0].id;
  gmid = await send(group, 'group hunt', [37.8, -122.4, 100, 'Pier 39']);
});
await asUser(bob, () => unlockIs('bob unlocks the group message', 'unlocked', gmid, 37.8));
await asUser(dave, () => denied("dave (another group member, not the sender) reading bob's unlock",
  () => db.query(`select * from public.message_unlocks where message_id=$1`,[gmid])));
await asUser(alice, async () => {
  const r = await db.query(`select unlocked_at from public.message_unlocks where message_id=$1`,[gmid]);
  r.rows.length === 1 ? ok("alice (sender) reads bob's group receipt") : bad(`alice saw ${r.rows.length} group receipts`);
  const at = r.rows[0]?.unlocked_at;
  at && new Date(at).getUTCSeconds() === 0 && new Date(at).getUTCMilliseconds() === 0
    ? ok('unlocked_at is coarsened to the minute')
    : bad(`unlocked_at not coarsened: ${at}`);
});
await asUser(dave, () => denied('dave backdating an unlock with a direct insert',
  () => db.query(`insert into public.message_unlocks (message_id,user_id,unlocked_at) values ($1,$2,'2001-01-01T00:00:00Z')`,[gmid,dave])));
await asUser(dave, async () => {
  await unlock(gmid, 37.8, -122.4);
  const r = await db.query(`select unlocked_at from public.message_unlocks where message_id=$1 and user_id=$2`,[gmid,dave]);
  new Date(r.rows[0].unlocked_at).getUTCFullYear() > 2001
    ? ok('unlocked_at comes from the server clock')
    : bad('unlock carries a client time');
});

await asUser(bob, () => allowed('bob turns receipts off',
  () => db.query(`update public.profiles set share_unlock_receipts=false where id=$1 returning id`,[bob])));
await asUser(alice, () => denied("alice reading bob's receipts once he opts out",
  () => db.query(`select * from public.message_unlocks where user_id=$1`,[bob])));
await asUser(alice, async () => {
  const r = await db.query(
    `select (select count(*)::int from public.message_unlocks u where u.message_id = m.id) as n
     from public.messages m where m.id = $1`, [gmid]);
  r.rows[0].n === 1
    ? ok("opted-out bob is hidden from the embed; dave's receipt still shows")
    : bad(`alice sees ${r.rows[0].n} receipts on the group message, expected 1 (dave's)`);
});
await asUser(bob, async () => {
  const r = await db.query(`select * from public.message_unlocks where user_id=$1`,[bob]);
  r.rows.length === 3 ? ok('bob still sees his own unlocks with receipts off') : bad(`bob sees ${r.rows.length} of his 3 unlocks`);
});
await asUser(bob, () => db.query(`update public.profiles set share_unlock_receipts=true where id=$1`,[bob]));

console.log('\n\x1b[1m── push_tokens ──\x1b[0m');
await asUser(alice, () => allowed('alice registers a push token',
  () => db.query(`select public.register_push_token('ExponentPushToken[shared]','ios')`)));
await asUser(alice, () => allowed('re-registering the same token is an upsert',
  () => db.query(`select public.register_push_token('ExponentPushToken[shared]','ios')`)));
await asUser(bob, () => denied("bob reading alice's push token",
  () => db.query(`select * from public.push_tokens`)));
await asUser(bob, () => denied('bob inserting a token row directly',
  () => db.query(`insert into public.push_tokens (user_id,token,platform) values ($1,'ExponentPushToken[x]','ios')`,[bob])));
await asUser(bob, () => denied("bob deleting alice's token",
  () => db.query(`delete from public.push_tokens where user_id=$1 returning token`,[alice])));
await asUser(bob, () => allowed('bob signs in on the same device and registers that token',
  () => db.query(`select public.register_push_token('ExponentPushToken[shared]','ios')`)));
const owners = (await db.query(`select user_id from public.push_tokens where token='ExponentPushToken[shared]'`)).rows;
owners.length === 1 && owners[0].user_id === bob
  ? ok('the token moved to bob; alice no longer receives pushes on that device')
  : bad(`token owned by ${owners.length} account(s)`);
await asUser(bob, async () => {
  const r = await db.query(`delete from public.push_tokens where token='ExponentPushToken[shared]' returning token`);
  r.rows.length === 1 ? ok('bob removes his own token on sign-out') : bad('bob could not remove his token');
});
await asUser(alice, () => denied('register_push_token rejects an unknown platform',
  () => db.query(`select public.register_push_token('ExponentPushToken[y]','web')`)));

console.log('\n\x1b[1m── message_reactions ──\x1b[0m');
const unfenced = (await db.query(`select id from public.messages where body='unfenced'`)).rows[0].id;
const lockedForBob = keyed.zero;
await asUser(bob, () => allowed('bob reacts to an open message',
  () => db.query(`insert into public.message_reactions (message_id,user_id,emoji) values ($1,$2,'❤️') returning emoji`,[unfenced,bob])));
await asUser(bob, () => allowed('bob reacts to a fenced message he has unlocked',
  () => db.query(`insert into public.message_reactions (message_id,user_id,emoji) values ($1,$2,'😮') returning emoji`,[mid,bob])));
await asUser(bob, () => denied('bob reacting to a fenced message he has NOT unlocked',
  () => db.query(`insert into public.message_reactions (message_id,user_id,emoji) values ($1,$2,'😂')`,[lockedForBob,bob])));
await asUser(alice, () => allowed('alice (sender) reacts to her own fenced message',
  () => db.query(`insert into public.message_reactions (message_id,user_id,emoji) values ($1,$2,'🙏') returning emoji`,[lockedForBob,alice])));
await asUser(carol, () => denied('carol reacting in a thread she is not in',
  () => db.query(`insert into public.message_reactions (message_id,user_id,emoji) values ($1,$2,'❤️')`,[unfenced,carol])));
await asUser(bob, () => denied('bob reacting as alice',
  () => db.query(`insert into public.message_reactions (message_id,user_id,emoji) values ($1,$2,'❤️')`,[unfenced,alice])));
await asUser(bob, () => denied('an emoji outside the fixed set',
  () => db.query(`update public.message_reactions set emoji='👍' where message_id=$1 and user_id=$2 returning emoji`,[unfenced,bob])));
await asUser(bob, async () => {
  const r = await db.query(`update public.message_reactions set emoji='😂' where message_id=$1 and user_id=$2 returning emoji`,[unfenced,bob]);
  r.rows[0]?.emoji === '😂' ? ok('bob changes his reaction') : bad('bob could not change his reaction');
  const off = await db.query(`update public.message_reactions set emoji=null where message_id=$1 and user_id=$2 returning emoji`,[unfenced,bob]);
  off.rows.length === 1 && off.rows[0].emoji === null ? ok('bob removes it by setting emoji to null') : bad('bob could not remove his reaction');
});
await asUser(alice, () => denied("alice changing bob's reaction",
  () => db.query(`update public.message_reactions set emoji='❤️' where user_id=$1 returning emoji`,[bob])));
await asUser(bob, () => denied('clients cannot delete reaction rows (removal is emoji = null)',
  () => db.query(`delete from public.message_reactions where user_id=$1 returning message_id`,[bob])));
await asUser(alice, async () => {
  const r = await db.query(`select user_id from public.message_reactions where message_id=$1`,[mid]);
  r.rows.length === 1 && r.rows[0].user_id === bob ? ok("alice sees bob's reaction in their thread") : bad(`alice saw ${r.rows.length} reactions on mid`);
});
await asUser(carol, () => denied('carol reading reactions in a thread she is not in',
  () => db.query(`select * from public.message_reactions`)));

console.log('\n\x1b[1m── reaction set parity with src/data/reactions.ts ──\x1b[0m');
const reactionsTs = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src', 'data', 'reactions.ts'), 'utf8');
const jsSet = [...reactionsTs.match(/REACTIONS = \[([^\]]*)\]/)[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
const checkDef = (await db.query(`select pg_get_constraintdef(c.oid) as def from pg_constraint c
  where c.conrelid='public.message_reactions'::regclass and c.contype='c'`)).rows.map((r) => r.def).join(' ');
const pgSet = [...checkDef.matchAll(/'([^']+)'::text/g)].map((m) => m[1]);
JSON.stringify(jsSet) === JSON.stringify(pgSet)
  ? ok(`same set, same order: ${jsSet.join(' ')}`)
  : bad(`client ${jsSet.join(' ')} ≠ database ${pgSet.join(' ')}`);

console.log('\n\x1b[1m── push_log / claim_push_slot (server only) ──\x1b[0m');
await asUser(alice, () => denied('authenticated calling claim_push_slot',
  () => db.query(`select public.claim_push_slot($1,'reaction',300) as ok`,[alice])));
await asUser(alice, () => denied('authenticated reading push_log',
  () => db.query(`select * from public.push_log`)));
await db.exec(`set role service_role`);
try {
  const first = (await db.query(`select public.claim_push_slot($1,'reaction',300) as ok`,[alice])).rows[0].ok;
  const second = (await db.query(`select public.claim_push_slot($1,'reaction',300) as ok`,[alice])).rows[0].ok;
  const otherKind = (await db.query(`select public.claim_push_slot($1,'receipt',300) as ok`,[alice])).rows[0].ok;
  const otherUser = (await db.query(`select public.claim_push_slot($1,'reaction',300) as ok`,[bob])).rows[0].ok;
  first === true && second === false
    ? ok('second reaction push to the same author within the window is suppressed')
    : bad(`claim results first=${first} second=${second}`);
  otherKind && otherUser ? ok('the window is per recipient and per kind') : bad(`otherKind=${otherKind} otherUser=${otherUser}`);
  await db.query(`update public.push_log set created_at = now() - interval '6 minutes' where recipient_id=$1`,[alice]);
  (await db.query(`select public.claim_push_slot($1,'reaction',300) as ok`,[alice])).rows[0].ok === true
    ? ok('a new slot opens once the window has passed')
    : bad('slot never reopened');
} finally { await db.exec(`reset role`); }

console.log('\n\x1b[1m── trails: pin mode (1:1) ──\x1b[0m');
const stop = (n, lat, extra = {}) => ({ body: `stop ${n}`, latitude: lat, longitude: -122.4, radius_meters: 100, label: `Place ${n}`, ...extra });
const visibleSteps = async (trail) =>
  (await db.query(`select trail_step from public.messages where trail_id=$1 order by trail_step`, [trail])).rows.map((r) => r.trail_step);
const stepId = async (trail, n) =>
  (await db.query(`select id from public.messages where trail_id=$1 and trail_step=$2`, [trail, n])).rows[0]?.id;
let pinTrail;
await asUser(alice, async () => {
  const r = await allowed('alice creates a 3-stop pin trail with bob',
    () => db.query(`select public.create_trail($1,'Our places','pin',$2::jsonb) as id`,
      [convo, JSON.stringify([stop(1, 37.70, { next_clue: 'coffee' }), stop(2, 37.71), stop(3, 37.72)])]));
  pinTrail = r?.rows?.[0]?.id;
  JSON.stringify(await visibleSteps(pinTrail)) === '[1,2,3]' ? ok('the creator sees every stop') : bad('creator cannot see all stops');
});
const pin2 = await asUser(alice, () => stepId(pinTrail, 2));
const pin1 = await asUser(alice, () => stepId(pinTrail, 1));
await asUser(bob, async () => {
  const v = await visibleSteps(pinTrail);
  JSON.stringify(v) === '[1]' ? ok('bob sees only stop 1 before unlocking anything') : bad(`bob sees stops ${v}`);
  const t = (await db.query(`select step_count from public.trails where id=$1`, [pinTrail])).rows[0];
  t?.step_count === 3 ? ok('bob can read the trail length (for "Stop 1 of 3")') : bad('bob cannot read the trail row');
  const inbox = (await db.query(`select count(*)::int as n from public.messages where conversation_id=$1 and trail_id=$2`, [convo, pinTrail])).rows[0].n;
  inbox === 1 ? ok('hidden stops are absent from a thread-wide query too') : bad(`thread query returned ${inbox} trail rows`);
});
await asUser(bob, () => denied('bob unlocking stop 2 before stop 1',
  () => unlock(pin2, 37.71, -122.4)));
await asUser(bob, () => denied("bob reading stop 1's text before finding it",
  () => db.query(`select * from public.message_sealed where message_id=$1`, [pin1])));
await asUser(bob, () => unlockIs('bob cannot unlock stop 1 from the couch', 'not_here', pin1, 37.0));
await asUser(bob, () => unlockIs('bob unlocks stop 1 at the place', 'unlocked', pin1, 37.70));
await asUser(bob, async () => {
  const v = await visibleSteps(pinTrail);
  JSON.stringify(v) === '[1,2]' ? ok('unlocking stop 1 reveals stop 2 (pin mode), not stop 3') : bad(`bob sees stops ${v}`);
  const s2 = (await db.query(`select * from public.message_sealed where message_id=$1`, [pin2])).rows.length;
  s2 === 0 ? ok("stop 2's pin is revealed, but not its text") : bad("stop 2's text leaked with its pin");
});
await asUser(carol, async () => {
  const v = (await db.query(`select count(*)::int as n from public.messages where trail_id=$1`, [pinTrail])).rows[0].n;
  const t = (await db.query(`select count(*)::int as n from public.trails where id=$1`, [pinTrail])).rows[0].n;
  v === 0 && t === 0 ? ok('carol (not in the thread) sees neither the trail nor its stops') : bad(`carol sees ${v} stops, ${t} trails`);
});

console.log('\n\x1b[1m── trails: clue mode (group) ──\x1b[0m');
let clueTrail;
await asUser(alice, async () => {
  const r = await allowed('alice creates a clue trail in the group thread',
    () => db.query(`select public.create_trail($1,'Birthday hunt','clue',$2::jsonb) as id`,
      [group, JSON.stringify([stop(1, 37.80, { next_clue: 'where we met' }), stop(2, 37.81, { next_clue: 'first date' }), stop(3, 37.82)])]));
  clueTrail = r?.rows?.[0]?.id;
});
const clue1 = await asUser(alice, () => stepId(clueTrail, 1));
const clue2 = await asUser(alice, () => stepId(clueTrail, 2));
await asUser(bob, () => unlock(clue1, 37.80, -122.4));
await asUser(bob, async () => {
  const v = await visibleSteps(clueTrail);
  JSON.stringify(v) === '[1]' ? ok('clue mode: unlocking stop 1 does NOT reveal stop 2') : bad(`bob sees stops ${v}`);
  const c = (await db.query(`select next_clue from public.message_sealed where message_id=$1`, [clue1])).rows[0]?.next_clue;
  c === 'where we met' ? ok("bob reads stop 1's clue to stop 2") : bad(`clue was ${c}`);
  const far = (await db.query(`select public.check_in_trail_step($1,2,37.0,-122.4) as s`, [clueTrail])).rows[0].s;
  far === 'not_here' ? ok('check-in far away: not_here') : bad(`far check-in returned ${far}`);
  const here = (await db.query(`select public.check_in_trail_step($1,2,37.81,-122.4) as s`, [clueTrail])).rows[0].s;
  here === 'unlocked' ? ok('check-in at the hidden stop: unlocked') : bad(`check-in returned ${here}`);
  const v2 = await visibleSteps(clueTrail);
  JSON.stringify(v2) === '[1,2]' ? ok('stop 2 becomes visible once checked in') : bad(`bob sees stops ${v2}`);
  const again = (await db.query(`select public.check_in_trail_step($1,2,37.81,-122.4) as s`, [clueTrail])).rows[0].s;
  again === 'unlocked' ? ok('checking in twice is harmless') : bad(`second check-in returned ${again}`);
});
await asUser(dave, async () => {
  const v = await visibleSteps(clueTrail);
  JSON.stringify(v) === '[1]' ? ok("dave's progress is his own: bob's check-in reveals nothing to him") : bad(`dave sees stops ${v}`);
});
await asUser(dave, () => denied('dave checking in to stop 2 before finding stop 1',
  () => db.query(`select public.check_in_trail_step($1,2,37.81,-122.4) as s`, [clueTrail])));
await asUser(dave, async () => {
  const c = (await db.query(`select * from public.message_sealed where message_id=$1`, [clue1])).rows.length;
  c === 0 ? ok("dave cannot read stop 1's clue before finding stop 1") : bad("stop 1's clue leaked to dave");
});
await asUser(dave, () => unlock(clue1, 37.80, -122.4));
await asUser(dave, () => denied('dave unlocking hidden clue stop 2 with unlock_message (bypassing check-in)',
  () => unlock(clue2, 37.81, -122.4)));
await asUser(carol, () => denied('carol checking in to a trail in a thread she is not in',
  () => db.query(`select public.check_in_trail_step($1,1,37.80,-122.4) as s`, [clueTrail])));
await asUser(dave, async () => {
  let last;
  for (let i = 0; i < 30; i++) last = (await db.query(`select public.check_in_trail_step($1,2,37.0,-122.4) as s`, [clueTrail])).rows[0].s;
  const capped = (await db.query(`select public.check_in_trail_step($1,2,37.81,-122.4) as s`, [clueTrail])).rows[0].s;
  last === 'not_here' && capped === 'too_many'
    ? ok('after 30 check-ins in an hour, even the right spot returns too_many')
    : bad(`rate limit: last=${last} capped=${capped}`);
});
await asUser(dave, () => denied('authenticated reading trail_check_ins',
  () => db.query(`select * from public.trail_check_ins`)));
await asUser(alice, async () => {
  const r = await db.query(`select count(*)::int as n from public.message_unlocks where message_id=$1`, [clue2]);
  r.rows[0].n === 1 ? ok("alice (creator) sees bob's checked-in stop as a receipt") : bad(`alice sees ${r.rows[0].n} receipts on stop 2`);
});

console.log('\n\x1b[1m── trails: validation ──\x1b[0m');
await asUser(alice, () => denied('a trail with one stop',
  () => db.query(`select public.create_trail($1,'x','pin',$2::jsonb)`, [convo, JSON.stringify([stop(1, 37.7)])])));
await asUser(alice, () => denied('a trail with 11 stops',
  () => db.query(`select public.create_trail($1,'x','pin',$2::jsonb)`, [convo, JSON.stringify(Array.from({ length: 11 }, (_, i) => stop(i + 1, 37.7, { next_clue: 'c' })))])));
await asUser(alice, () => denied('clue mode with a stop missing its clue',
  () => db.query(`select public.create_trail($1,'x','clue',$2::jsonb)`, [convo, JSON.stringify([stop(1, 37.7), stop(2, 37.71)])])));
const strays = (await db.query(`select count(*)::int as n from public.trails where title='x'`)).rows[0].n;
strays === 0 ? ok('a refused trail leaves no trail or stops behind') : bad(`${strays} stray trail(s)`);
await asUser(carol, () => denied("carol creating a trail in alice and bob's thread",
  () => db.query(`select public.create_trail($1,'x','pin',$2::jsonb)`, [convo, JSON.stringify([stop(1, 37.7), stop(2, 37.71)])])));
await asUser(alice, () => denied('a trail stop without a fence',
  () => db.query(`insert into public.messages (conversation_id,sender_id,body,trail_id,trail_step) values ($1,$2,'x',$3,9)`, [convo, alice, pinTrail])));
await asUser(alice, () => denied('a second stop 1 on the same trail',
  () => db.query(`insert into public.messages (conversation_id,sender_id,body,fence_latitude,fence_longitude,fence_radius_meters,trail_id,trail_step) values ($1,$2,'x',37,-122,50,$3,1)`, [convo, alice, pinTrail])));

console.log('\n\x1b[1m── trails: time windows ──\x1b[0m');
const future = new Date(Date.now() + 86_400_000).toISOString();
const past = new Date(Date.now() - 86_400_000).toISOString();
let windowTrail;
await asUser(alice, async () => {
  const r = await allowed('alice creates a pin trail whose stop 2 opens tomorrow and stop 3 already closed',
    () => db.query(`select public.create_trail($1,'Timed','pin',$2::jsonb) as id`, [convo, JSON.stringify([
      stop(1, 37.60), stop(2, 37.61, { opens_at: future }), stop(3, 37.62, { closes_at: past }),
    ])]));
  windowTrail = r?.rows?.[0]?.id;
});
const win1 = await asUser(alice, () => stepId(windowTrail, 1));
const win2 = await asUser(alice, () => stepId(windowTrail, 2));
const win3 = await asUser(alice, () => stepId(windowTrail, 3));
await asUser(bob, () => unlock(win1, 37.60, -122.4));
await asUser(bob, async () => {
  const v = await visibleSteps(windowTrail);
  JSON.stringify(v) === '[1,2]' ? ok('a stop that has not opened is still visible once earned') : bad(`bob sees ${v}`);
});
await asUser(bob, () => unlockIs('bob at stop 2 before it opens: not_open', 'not_open', win2, 37.61));
await db.query(`update public.messages set opens_at = now() - interval '1 minute' where id=$1`, [win2]);
await asUser(bob, () => unlockIs('bob unlocks stop 2 once it has opened', 'unlocked', win2, 37.61));
await asUser(bob, () => unlockIs('bob at stop 3 after it closed: closed', 'closed', win3, 37.62));
await asUser(alice, () => denied('a time window on an ordinary message',
  () => db.query(`insert into public.messages (conversation_id,sender_id,body,opens_at) values ($1,$2,'x',now())`, [convo, alice])));
await asUser(alice, () => denied('a window that closes before it opens',
  () => db.query(`select public.create_trail($1,'x','pin',$2::jsonb)`, [convo, JSON.stringify([
    stop(1, 37.6, { opens_at: future, closes_at: past }), stop(2, 37.61),
  ])])));
let lateClue;
await asUser(alice, async () => {
  lateClue = (await db.query(`select public.create_trail($1,'Late','clue',$2::jsonb) as id`, [group, JSON.stringify([
    stop(1, 37.50, { next_clue: 'go' }), stop(2, 37.51, { opens_at: future }),
  ])])).rows[0].id;
});
const late1 = await asUser(alice, () => stepId(lateClue, 1));
await asUser(bob, () => unlock(late1, 37.50, -122.4));
await asUser(bob, async () => {
  const far = (await db.query(`select public.check_in_trail_step($1,2,37.0,-122.4) as s`, [lateClue])).rows[0].s;
  const here = (await db.query(`select public.check_in_trail_step($1,2,37.51,-122.4) as s`, [lateClue])).rows[0].s;
  far === 'not_here' && here === 'not_open'
    ? ok('clue check-in: wrong place says not_here, right place before opening says not_open')
    : bad(`check-in far=${far} here=${here}`);
  const v = await visibleSteps(lateClue);
  JSON.stringify(v) === '[1]' ? ok('a not-yet-open check-in unlocks nothing') : bad(`bob sees ${v}`);
});

console.log('\n\x1b[1m── trails: hints ──\x1b[0m');
let hintTrail;
await asUser(alice, async () => {
  const r = await allowed('alice creates a clue trail with hints after 60 minutes',
    () => db.query(`select public.create_trail($1,'Hinted','clue',$2::jsonb,60) as id`, [group, JSON.stringify([
      stop(1, 37.40, { next_clue: 'a' }), stop(2, 37.41, { next_clue: 'b' }), stop(3, 37.42),
    ])]));
  hintTrail = r?.rows?.[0]?.id;
});
const hint1 = await asUser(alice, () => stepId(hintTrail, 1));
const hint2 = await asUser(alice, () => stepId(hintTrail, 2));
await asUser(bob, () => unlock(hint1, 37.40, -122.4));
await asUser(bob, async () => {
  const r = (await db.query(`select public.use_trail_hint($1,2) as s`, [hintTrail])).rows[0].s;
  r === 'too_soon' ? ok('a hint right after finding stop 1 is too_soon') : bad(`hint returned ${r}`);
});
await asUser(bob, () => denied('bob inserting a hint row directly',
  () => db.query(`insert into public.trail_hints (trail_id,user_id,step) values ($1,$2,2)`, [hintTrail, bob])));
await db.query(`update public.message_unlocks set unlocked_at = now() - interval '2 hours' where message_id=$1 and user_id=$2`, [hint1, bob]);
await asUser(bob, async () => {
  const r = (await db.query(`select public.use_trail_hint($1,2) as s`, [hintTrail])).rows[0].s;
  r === 'revealed' ? ok('after the delay, the hint is revealed') : bad(`hint returned ${r}`);
  const v = await visibleSteps(hintTrail);
  JSON.stringify(v) === '[1,2]' ? ok("the hinted stop's row (and pin) is now visible to bob") : bad(`bob sees ${v}`);
});
await asUser(bob, () => unlockIs('bob unlocks the hinted stop like a pin-mode stop', 'unlocked', hint2, 37.41));
await asUser(dave, async () => {
  const v = await visibleSteps(hintTrail);
  JSON.stringify(v) === '[1]' ? ok("bob's hint reveals nothing to dave") : bad(`dave sees ${v}`);
  const rows = (await db.query(`select * from public.trail_hints`)).rows.length;
  rows === 0 ? ok("dave cannot read bob's hint") : bad(`dave reads ${rows} hint rows`);
});
await asUser(dave, () => denied('dave asking for a hint before finding stop 1',
  () => db.query(`select public.use_trail_hint($1,2) as s`, [hintTrail])));
await asUser(alice, async () => {
  const rows = (await db.query(`select user_id, step from public.trail_hints where trail_id=$1`, [hintTrail])).rows;
  rows.length === 1 && rows[0].user_id === bob ? ok('the creator sees who used a hint') : bad(`alice sees ${rows.length} hints`);
});
await asUser(bob, async () => {
  const pinHint = (await db.query(`select public.use_trail_hint($1,2) as s`, [pinTrail])).rows[0].s;
  const noHint = (await db.query(`select public.use_trail_hint($1,2) as s`, [clueTrail])).rows[0].s;
  pinHint === 'disabled' && noHint === 'disabled'
    ? ok('hints are disabled in pin mode and on trails created without them')
    : bad(`pin=${pinHint} clue=${noHint}`);
});

console.log('\n\x1b[1m── trails: finishing order ──\x1b[0m');
let raceTrail;
await asUser(alice, async () => {
  raceTrail = (await db.query(`select public.create_trail($1,'Race','pin',$2::jsonb) as id`, [group, JSON.stringify([
    stop(1, 37.30), stop(2, 37.31),
  ])])).rows[0].id;
});
const race1 = await asUser(alice, () => stepId(raceTrail, 1));
const race2 = await asUser(alice, () => stepId(raceTrail, 2));
for (const who of [bob, dave]) {
  await asUser(who, () => unlock(race1, 37.30, -122.4));
  await asUser(who, () => unlock(race2, 37.31, -122.4));
}
// dave finished first.
await db.query(`update public.message_unlocks set unlocked_at = now() - interval '10 minutes' where message_id=$1 and user_id=$2`, [race2, dave]);
const order = async () => (await db.query(`select user_id, place::int as place from public.trail_finishers($1)`, [raceTrail])).rows;
await asUser(bob, async () => {
  const r = await order();
  r.length === 2 && r[0].user_id === dave && r[0].place === 1 && r[1].user_id === bob && r[1].place === 2
    ? ok('bob sees the finishing order: dave 1st, bob 2nd')
    : bad(`bob sees ${JSON.stringify(r)}`);
});
await asUser(alice, async () => {
  (await order()).length === 2 ? ok('the creator sees the finishing order') : bad('creator cannot see finishers');
});
await asUser(carol, async () => {
  (await order()).length === 0 ? ok('carol (not in the thread) sees no finishers') : bad('carol sees finishers');
});
await db.query(`update public.profiles set share_unlock_receipts=false where id=$1`, [dave]);
await asUser(bob, async () => {
  const r = await order();
  r.length === 1 && r[0].user_id === bob && r[0].place === 1
    ? ok('dave opted out: bob sees only himself, ranked 1st, with no gap')
    : bad(`bob sees ${JSON.stringify(r)}`);
});
await asUser(dave, async () => {
  const r = await order();
  r.some((x) => x.user_id === dave) ? ok('dave still sees his own finish') : bad('dave cannot see his own finish');
});
await db.query(`update public.profiles set share_unlock_receipts=true where id=$1`, [dave]);

console.log('\n\x1b[1m── hardening: write paths RLS alone did not close ──\x1b[0m');
const erin = (await db.query(`insert into auth.users (email, raw_user_meta_data) values ('erin@example.com','{"name":"Erin","handle":"erin"}') returning id`)).rows[0].id;
await asUser(erin, async () => {
  const r = (await db.query(`select id from public.profiles`)).rows;
  r.length === 1 && r[0].id === erin ? ok('a newcomer sees only her own profile, not the directory') : bad(`erin sees ${r.length} profiles`);
  const found = (await db.query(`select handle from public.search_profiles('ali')`)).rows.map((x) => x.handle);
  found.includes('alice') ? ok('search_profiles finds alice by part of her name') : bad(`search found ${found}`);
  const short = (await db.query(`select * from public.search_profiles('a')`)).rows.length;
  short === 0 ? ok('a one-character search returns nothing') : bad(`one-character search returned ${short}`);
  const self = (await db.query(`select * from public.search_profiles('erin')`)).rows.length;
  self === 0 ? ok('search leaves the caller out') : bad('search returned the caller');
  const wild = (await db.query(`select * from public.search_profiles('%%')`)).rows.length;
  wild === 0 ? ok('LIKE wildcards in a search are literal') : bad(`'%%' matched ${wild} profiles`);
});
await asUser(erin, () => denied('erin sending a request to bob that is born accepted',
  () => db.query(`insert into public.friendships (requester_id,addressee_id,status) values ($1,$2,'accepted')`,[erin,bob])));
await asUser(erin, () => allowed('erin sends bob an ordinary request',
  () => db.query(`insert into public.friendships (requester_id,addressee_id) values ($1,$2)`,[erin,bob])));
await asUser(bob, async () => {
  const r = (await db.query(`select id from public.profiles where id=$1`,[erin])).rows.length;
  r === 1 ? ok('bob can see who sent him a request') : bad('bob cannot see the requester');
});
await asUser(bob, () => denied('bob (addressee) rewriting requester_id to carol',
  () => db.query(`update public.friendships set requester_id=$1, status='accepted' where requester_id=$2 returning id`,[carol,erin])));
await asUser(bob, () => db.query(`delete from public.friendships where requester_id=$1`,[erin]));

let aliceDave;
await asUser(alice, async () => {
  aliceDave = (await db.query(`select public.create_conversation(array[$1]::uuid[]) as id`,[dave])).rows[0].id;
});
await asUser(bob, () => denied("bob moving his participant row into alice and dave's thread",
  () => db.query(`update public.conversation_participants set conversation_id=$1 where conversation_id=$2 and user_id=$3 returning user_id`,[aliceDave,convo,bob])));
await asUser(bob, async () => {
  const r = (await db.query(`select public.mark_conversation_read($1) as at`,[convo])).rows[0].at;
  const row = (await db.query(`select last_read_at from public.conversation_participants where conversation_id=$1 and user_id=$2`,[convo,bob])).rows[0];
  r && row?.last_read_at && +new Date(row.last_read_at) === +new Date(r)
    ? ok('mark_conversation_read stamps the server clock')
    : bad(`mark read returned ${r}, row has ${row?.last_read_at}`);
});
await asUser(alice, () => denied('alice (creator) flipping is_group on a conversation',
  () => db.query(`update public.conversations set is_group=true where id=$1 returning id`,[convo])));
await asUser(alice, () => allowed('alice (creator) renames a conversation',
  () => db.query(`update public.conversations set title='Us' where id=$1 returning id`,[convo])));
await asUser(alice, () => denied('alice inserting a bare trail row with no stops',
  () => db.query(`insert into public.trails (conversation_id,created_by,title,step_count) values ($1,$2,'empty',3)`,[convo,alice])));
await asUser(alice, () => denied('alice writing message_sealed directly',
  () => db.query(`insert into public.message_sealed (message_id,body) values ($1,'swap')`,[mid])));
await asUser(alice, () => denied('alice changing her profile id',
  () => db.query(`update public.profiles set id=gen_random_uuid() where id=$1 returning id`,[alice])));

await asUser(erin, async () => {
  const conv = (await db.query(`select count(*)::int as n from public.conversations`)).rows[0].n;
  conv === 0 ? ok('erin is in no threads') : bad(`erin sees ${conv} threads`);
});
const rateLimited = await asUser(alice, () => send(group, 'rate limited', [10, 10, 50, null]));
// Start dave's hour fresh; his earlier unlocks above count toward the same cap.
await db.query(`delete from public.unlock_attempts where user_id=$1`, [dave]);
await asUser(dave, async () => {
  let last;
  for (let i = 0; i < 60; i++) last = (await unlock(rateLimited, 0, 0)).status;
  const capped = (await unlock(rateLimited, 10, 10)).status;
  last === 'not_here' && capped === 'too_many'
    ? ok('after 60 unlock attempts in an hour, even the right spot returns too_many')
    : bad(`rate limit: last=${last} capped=${capped}`);
});

const noRls = (await db.query(`select tablename from pg_tables where schemaname='public' and not rowsecurity`)).rows;
noRls.length === 0 ? ok('every public table has RLS enabled') : bad(`RLS off on ${noRls.map((r) => r.tablename)}`);
await db.exec(`create table public.later_table (id int)`);
const leaked = (await db.query(`select has_table_privilege('authenticated','public.later_table','select') as s`)).rows[0].s;
leaked === false ? ok('a table added later starts with no grant to authenticated') : bad('new tables are granted to authenticated by default');
await db.exec(`drop table public.later_table`);

console.log('\n\x1b[1m── constraints ──\x1b[0m');
await asUser(alice, async () => {
  await denied('half-populated geofence (lat, no radius)', () => send(convo, 'x', [37.0, null, null, null]));
  await denied('out-of-range latitude', () => send(convo, 'x', [999, 0, 10, null]));
  await denied('zero-radius fence', () => send(convo, 'x', [37, 0, 0, null]));
  await denied('empty fenced body', () => send(convo, '', [37, 0, 10, null]));
  await denied('self-friendship', () => db.query(`insert into public.friendships (requester_id,addressee_id) values ($1,$1)`,[alice]));
  await denied('uppercase handle', () => db.query(`update public.profiles set handle='Alice' where id=$1 returning id`,[alice]));
  await denied('empty message body', () => send(convo, ''));
  await denied('handle stolen from another user', () => db.query(`update public.profiles set handle='bob' where id=$1 returning id`,[alice]));
});

console.log('\n\x1b[1m── anon (signed-out) sees nothing ──\x1b[0m');
await db.exec(`set role anon; select set_config('request.jwt.claim.sub','',false);`);
for (const t of ['profiles','friendships','conversations','conversation_participants','messages','message_unlocks','push_tokens','message_reactions','push_log','trails','trail_check_ins','trail_hints','message_sealed','unlock_attempts']) {
  await denied(`anon reading ${t}`, () => db.query(`select * from public.${t}`));
}
await db.exec(`reset role`);

console.log('\n\x1b[1m── every policy-filtered column is indexed ──\x1b[0m');
const idx = (await db.query(`select tablename, indexdef from pg_indexes where schemaname='public'`)).rows;
for (const [t,c] of [['friendships','requester_id'],['friendships','addressee_id'],['conversations','created_by'],['conversation_participants','user_id'],['messages','conversation_id'],['messages','sender_id'],['message_unlocks','user_id'],['push_tokens','user_id'],['push_tokens','token'],['message_reactions','user_id'],['trails','conversation_id'],['trails','created_by'],['trail_hints','user_id'],['unlock_attempts','user_id']]) {
  idx.some(i => i.tablename===t && i.indexdef.includes(c)) ? ok(`${t}.${c}`) : bad(`${t}.${c} is NOT indexed — RLS will seq-scan`);
}

console.log(`\n${'═'.repeat(56)}`);
console.log(fail ? `\x1b[31m  ${pass} passed, ${fail} FAILED\x1b[0m` : `\x1b[32m  all ${pass} checks passed\x1b[0m`);
console.log('═'.repeat(56));
process.exit(fail ? 1 : 0);
