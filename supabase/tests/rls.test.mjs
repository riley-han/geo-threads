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
  create role anon; create role authenticated;
  grant usage on schema auth to anon, authenticated;
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
await db.exec(`grant usage on schema public to anon, authenticated;
  grant all on all tables in schema public to authenticated, anon;`);

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
await asUser(alice, () => denied("alice reading bob's unlock (per-reader privacy)",
  () => db.query(`select * from public.message_unlocks`)));
await asUser(bob, () => denied('bob forging an unlock for alice',
  () => db.query(`insert into public.message_unlocks (message_id,user_id) values ($1,$2)`,[mid,alice])));

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
for (const t of ['profiles','friendships','conversations','conversation_participants','messages','message_unlocks']) {
  await denied(`anon reading ${t}`, () => db.query(`select * from public.${t}`));
}
await db.exec(`reset role`);

console.log('\n\x1b[1m── every policy-filtered column is indexed ──\x1b[0m');
const idx = (await db.query(`select tablename, indexdef from pg_indexes where schemaname='public'`)).rows;
for (const [t,c] of [['friendships','requester_id'],['friendships','addressee_id'],['conversations','created_by'],['conversation_participants','user_id'],['messages','conversation_id'],['messages','sender_id'],['message_unlocks','user_id']]) {
  idx.some(i => i.tablename===t && i.indexdef.includes(c)) ? ok(`${t}.${c}`) : bad(`${t}.${c} is NOT indexed — RLS will seq-scan`);
}

console.log(`\n${'═'.repeat(56)}`);
console.log(fail ? `\x1b[31m  ${pass} passed, ${fail} FAILED\x1b[0m` : `\x1b[32m  all ${pass} checks passed\x1b[0m`);
console.log('═'.repeat(56));
process.exit(fail ? 1 : 0);
