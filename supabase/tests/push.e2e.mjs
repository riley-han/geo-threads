// End-to-end check of the push pipeline against the LINKED project:
// insert → Database Webhook → `push` Edge Function → Expo Push API.
//
//   npm run db:test:push
//
// No phone needed. Each case gives a seed account a fake Expo token. Expo
// rejects it as DeviceNotRegistered and the function deletes it, so "the token
// disappeared" proves a push was attempted, and "the token is still there"
// proves none was. Only the seed accounts from `npm run db:seed` are touched,
// and everything written is removed at the end.
//
// Needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local, the deployed
// function and all three webhooks (supabase/README.md → Push). Like the seed
// script, it imports nothing from src/.

import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local.');
  process.exit(1);
}
const s = createClient(url, key, { auth: { persistSession: false } });

const TOKEN_PREFIX = 'ExponentPushToken[e2e-';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (m) => { console.log(`  \x1b[32m✔\x1b[0m ${m}`); pass++; };
const bad = (m) => { console.log(`  \x1b[31m✘ ${m}\x1b[0m`); fail++; };
const must = ({ data, error }, what) => {
  if (error) throw new Error(`${what}: ${error.message}`);
  return data;
};

async function profileId(handle) {
  const row = must(await s.from('profiles').select('id').eq('handle', handle).maybeSingle(), handle);
  if (!row) throw new Error(`seed account @${handle} not found: run npm run db:seed`);
  return row.id;
}

async function giveToken(userId) {
  const token = `${TOKEN_PREFIX}${userId.slice(0, 8)}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}]`;
  must(await s.from('push_tokens').insert({ user_id: userId, token, platform: 'ios' }), 'token');
  return token;
}

const tokenExists = async (t) =>
  must(await s.from('push_tokens').select('token').eq('token', t), 'poll').length > 0;

/** Pushed: the fake token was pruned within the timeout. */
async function expectPush(token, label, timeoutMs = 20_000) {
  for (let waited = 0; waited < timeoutMs; waited += 1000) {
    await sleep(1000);
    if (!(await tokenExists(token))) return ok(`${label} (≈${(waited + 1000) / 1000}s)`);
  }
  bad(`${label}: no push within ${timeoutMs / 1000}s`);
}

/** Not pushed: the token survives a generous wait. */
async function expectNoPush(token, label, waitMs = 6_000) {
  await sleep(waitMs);
  (await tokenExists(token)) ? ok(label) : bad(`${label}: a push was sent`);
}

const ada = await profileId('ada');
const miguel = await profileId('miguel');

// Their 1:1 thread from the seed.
const parts = must(
  await s.from('conversation_participants').select('conversation_id, user_id').in('user_id', [ada, miguel]),
  'participants',
);
const members = new Map();
for (const p of parts) members.set(p.conversation_id, [...(members.get(p.conversation_id) ?? []), p.user_id]);
const convo = [...members].find(([, ids]) => ids.includes(ada) && ids.includes(miguel))?.[0];
if (!convo) throw new Error('no thread between @ada and @miguel: run npm run db:seed');

const created = { messages: [], trails: [] };
const fence = { fence_latitude: 37.7955, fence_longitude: -122.3937, fence_radius_meters: 150, fence_label: 'Ferry Building' };

async function message(row) {
  const m = must(await s.from('messages').insert({ conversation_id: convo, ...row }).select('id').single(), 'message');
  created.messages.push(m.id);
  return m.id;
}
const unlock = async (messageId, userId) =>
  must(await s.from('message_unlocks').insert({ message_id: messageId, user_id: userId }), 'unlock');

try {
  await s.from('push_log').delete().in('recipient_id', [ada, miguel]);

  console.log('\n\x1b[1m── messages ──\x1b[0m');
  {
    const t = await giveToken(miguel);
    await message({ sender_id: ada, body: '[e2e] hello' });
    await expectPush(t, 'a new message pushes the recipient');
  }

  console.log('\n\x1b[1m── unlock receipts ──\x1b[0m');
  {
    const fenced = await message({ sender_id: ada, body: '[e2e] fenced', ...fence });
    await sleep(2000); // let the message's own push finish first
    const t = await giveToken(ada);
    await unlock(fenced, miguel);
    await expectPush(t, 'an unlock pushes the sender');
  }

  console.log('\n\x1b[1m── reactions ──\x1b[0m');
  {
    const open = await message({ sender_id: ada, body: '[e2e] react to me' });
    await sleep(2000);
    const t1 = await giveToken(ada);
    must(await s.from('message_reactions').insert({ message_id: open, user_id: miguel, emoji: '❤️' }), 'react');
    await expectPush(t1, 'a reaction pushes the author');
    const t2 = await giveToken(ada);
    must(
      await s.from('message_reactions').update({ emoji: '😂' }).eq('message_id', open).eq('user_id', miguel),
      'change',
    );
    await expectNoPush(t2, 'changing a reaction does not push');
  }

  console.log('\n\x1b[1m── trails ──\x1b[0m');
  {
    // Inserted directly as service_role: create_trail needs a user session.
    const trail = must(
      await s
        .from('trails')
        .insert({ conversation_id: convo, created_by: ada, title: '[e2e] trail', reveal_mode: 'pin', step_count: 3 })
        .select('id')
        .single(),
      'trail',
    );
    created.trails.push(trail.id);
    const stopRow = (n) => ({
      sender_id: ada,
      body: `[e2e] stop ${n}`,
      ...fence,
      fence_latitude: 37.79 + n / 1000,
      fence_label: `Stop ${n} place`,
      trail_id: trail.id,
      trail_step: n,
    });

    const t1 = await giveToken(miguel);
    const stop1 = await message(stopRow(1));
    await expectPush(t1, 'a new trail pushes the recipient once, for stop 1');

    const t2 = await giveToken(miguel);
    const stop2 = await message(stopRow(2));
    const stop3 = await message(stopRow(3));
    await expectNoPush(t2, 'stops 2 and 3 do not push (their places stay secret)');
    must(await s.from('push_tokens').delete().eq('token', t2), 'cleanup t2');

    const t3 = await giveToken(ada);
    await unlock(stop1, miguel);
    await expectPush(t3, 'finding a stop pushes the creator');

    must(await s.from('profiles').update({ share_unlock_receipts: false }).eq('id', miguel), 'opt out');
    try {
      const t4 = await giveToken(ada);
      await unlock(stop2, miguel);
      await expectNoPush(t4, 'a finder who opted out of receipts sends no stop push');
      must(await s.from('push_tokens').delete().eq('token', t4), 'cleanup t4');
    } finally {
      must(await s.from('profiles').update({ share_unlock_receipts: true }).eq('id', miguel), 'opt back in');
    }

    const t5 = await giveToken(ada);
    await unlock(stop3, miguel);
    await expectPush(t5, 'finishing the trail pushes the creator');
  }
} catch (e) {
  bad(`aborted: ${e.message}`);
} finally {
  if (created.messages.length) await s.from('messages').delete().in('id', created.messages);
  if (created.trails.length) await s.from('trails').delete().in('id', created.trails);
  await s.from('push_tokens').delete().like('token', `${TOKEN_PREFIX}%`);
  await s.from('push_log').delete().in('recipient_id', [ada, miguel]);
  console.log('\n  cleaned up test messages, trails, tokens and push log');
}

console.log(`\n${'═'.repeat(56)}`);
console.log(fail ? `\x1b[31m  ${pass} passed, ${fail} FAILED\x1b[0m` : `\x1b[32m  all ${pass} push checks passed\x1b[0m`);
console.log('═'.repeat(56));
process.exit(fail ? 1 : 0);
