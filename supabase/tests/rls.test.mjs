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
  const r = await allowed('alice sends a fenced message and reads it back',
    () => db.query(`insert into public.messages (conversation_id,sender_id,body,fence_latitude,fence_longitude,fence_radius_meters,fence_label)
      values ($1,$2,'meet me here',37.7749,-122.4194,150,'Dolores Park') returning id, fence_key`,[convo,alice]));
  mid = r?.rows?.[0]?.id;
});
await asUser(bob, async () => {
  const r = await db.query(`select body from public.messages where conversation_id=$1`,[convo]);
  r.rows.length === 1 ? ok('bob (participant) reads the message') : bad(`bob saw ${r.rows.length} messages, expected 1`);
});
await asUser(carol, () => denied("carol reading the thread's messages",
  () => db.query(`select * from public.messages where conversation_id=$1`,[convo])));
await asUser(carol, () => denied('carol posting into their thread',
  () => db.query(`insert into public.messages (conversation_id,sender_id,body) values ($1,$2,'hi')`,[convo,carol])));
await asUser(bob, () => denied('bob spoofing a message as alice',
  () => db.query(`insert into public.messages (conversation_id,sender_id,body) values ($1,$2,'fake')`,[convo,alice])));
await asUser(bob, () => denied("bob deleting alice's message",
  () => db.query(`delete from public.messages where id=$1 returning id`,[mid])));

console.log('\n\x1b[1m── fence_key parity with the client\'s fenceKey() ──\x1b[0m');
const jsKey = (lat,lng,r) => `${lat.toFixed(5)}:${lng.toFixed(5)}:${Math.round(r)}`;
for (const [lat,lng,r,label] of [[37.7749,-122.4194,150,'typical'],[7.5,-0.5,3000.6,'single digit / negative / rounding'],[0,0,1,'zero'],[-89.123456,179.987654,99999,'extremes']]) {
  await asUser(alice, () => db.query(`insert into public.messages (conversation_id,sender_id,body,fence_latitude,fence_longitude,fence_radius_meters)
    values ($1,$2,$3,$4,$5,$6)`,[convo,alice,`k:${label}`,lat,lng,r]));
  const pg = (await db.query(`select fence_key from public.messages where body=$1`,[`k:${label}`])).rows[0].fence_key;
  const js = jsKey(lat,lng,r);
  pg === js ? ok(`${label}: ${pg}`) : bad(`${label}: postgres ${pg} ≠ javascript ${js}`);
}
await asUser(alice, () => db.query(`insert into public.messages (conversation_id,sender_id,body) values ($1,$2,'unfenced')`,[convo,alice]));
const nullKey = (await db.query(`select fence_key from public.messages where body='unfenced'`)).rows[0].fence_key;
nullKey === null ? ok('an unfenced message gets a null fence_key') : bad(`unfenced message got key ${nullKey}`);

console.log('\n\x1b[1m── message_unlocks (per-reader state) ──\x1b[0m');
await asUser(bob, () => allowed('bob records his own unlock',
  () => db.query(`insert into public.message_unlocks (message_id,user_id) values ($1,$2) returning unlocked_at`,[mid,bob])));
await asUser(carol, () => denied('carol unlocking a message in a thread she is not in',
  () => db.query(`insert into public.message_unlocks (message_id,user_id) values ($1,$2)`,[mid,carol])));
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
  gmid = (await db.query(`insert into public.messages (conversation_id,sender_id,body,fence_latitude,fence_longitude,fence_radius_meters,fence_label)
    values ($1,$2,'group hunt',37.8,-122.4,100,'Pier 39') returning id`,[group,alice])).rows[0].id;
});
await asUser(bob, () => allowed('bob unlocks the group message',
  () => db.query(`insert into public.message_unlocks (message_id,user_id) values ($1,$2) returning unlocked_at`,[gmid,bob])));
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
await asUser(bob, () => db.query(`insert into public.message_unlocks (message_id,user_id,unlocked_at) values ($1,$2,'2001-01-01T00:00:00Z')`,[mid,bob])
  .catch(() => null)); // already unlocked: a conflict is fine
await asUser(dave, async () => {
  await db.query(`insert into public.message_unlocks (message_id,user_id,unlocked_at) values ($1,$2,'2001-01-01T00:00:00Z')`,[gmid,dave]);
  const r = await db.query(`select unlocked_at from public.message_unlocks where message_id=$1 and user_id=$2`,[gmid,dave]);
  new Date(r.rows[0].unlocked_at).getUTCFullYear() > 2001
    ? ok('a client-supplied unlocked_at is replaced by the server clock')
    : bad('client backdated its unlock');
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
  r.rows.length === 2 ? ok('bob still sees his own unlocks with receipts off') : bad(`bob sees ${r.rows.length} of his 2 unlocks`);
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
const lockedForBob = (await db.query(`select id from public.messages where body='k:typical'`)).rows[0].id;
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

console.log('\n\x1b[1m── constraints ──\x1b[0m');
await asUser(alice, async () => {
  await denied('half-populated geofence (lat, no radius)',
    () => db.query(`insert into public.messages (conversation_id,sender_id,body,fence_latitude) values ($1,$2,'x',37.0)`,[convo,alice]));
  await denied('out-of-range latitude',
    () => db.query(`insert into public.messages (conversation_id,sender_id,body,fence_latitude,fence_longitude,fence_radius_meters) values ($1,$2,'x',999,0,10)`,[convo,alice]));
  await denied('zero-radius fence',
    () => db.query(`insert into public.messages (conversation_id,sender_id,body,fence_latitude,fence_longitude,fence_radius_meters) values ($1,$2,'x',37,0,0)`,[convo,alice]));
  await denied('self-friendship', () => db.query(`insert into public.friendships (requester_id,addressee_id) values ($1,$1)`,[alice]));
  await denied('uppercase handle', () => db.query(`update public.profiles set handle='Alice' where id=$1 returning id`,[alice]));
  await denied('empty message body', () => db.query(`insert into public.messages (conversation_id,sender_id,body) values ($1,$2,'')`,[convo,alice]));
  await denied('handle stolen from another user', () => db.query(`update public.profiles set handle='bob' where id=$1 returning id`,[alice]));
});

console.log('\n\x1b[1m── anon (signed-out) sees nothing ──\x1b[0m');
await db.exec(`set role anon; select set_config('request.jwt.claim.sub','',false);`);
for (const t of ['profiles','friendships','conversations','conversation_participants','messages','message_unlocks','push_tokens','message_reactions','push_log']) {
  await denied(`anon reading ${t}`, () => db.query(`select * from public.${t}`));
}
await db.exec(`reset role`);

console.log('\n\x1b[1m── every policy-filtered column is indexed ──\x1b[0m');
const idx = (await db.query(`select tablename, indexdef from pg_indexes where schemaname='public'`)).rows;
for (const [t,c] of [['friendships','requester_id'],['friendships','addressee_id'],['conversations','created_by'],['conversation_participants','user_id'],['messages','conversation_id'],['messages','sender_id'],['message_unlocks','user_id'],['push_tokens','user_id'],['push_tokens','token'],['message_reactions','user_id']]) {
  idx.some(i => i.tablename===t && i.indexdef.includes(c)) ? ok(`${t}.${c}`) : bad(`${t}.${c} is NOT indexed — RLS will seq-scan`);
}

console.log(`\n${'═'.repeat(56)}`);
console.log(fail ? `\x1b[31m  ${pass} passed, ${fail} FAILED\x1b[0m` : `\x1b[32m  all ${pass} checks passed\x1b[0m`);
console.log('═'.repeat(56));
process.exit(fail ? 1 : 0);
