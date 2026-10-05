# Phase 3: Reactions

| | |
|---|---|
| **Status** | Built (branch `rh/reactions`) |
| **Date** | 2026-10-04 |
| **PRD** | [Found It + Trails](../prd/2026-09-found-it-and-trails.md), §3.3 rows P1 "Reactions", P1 "Reaction push", P2 "Found it nudge" |
| **Builds on** | Phase 1–2 (remote push, unlock receipts), PR #18 |

## Goal

After someone reads a message, they can answer it in one tap. The author hears about it without being flooded. This closes the loop that receipts opened: a receipt tells the sender *that* the message was found, and a reaction tells them *how it landed*.

## Decisions

| Question | Decision | Why |
|---|---|---|
| Reaction set | ❤️ 😂 😮 🙏 (the PRD's four) | Fits beside a bubble on one row. Adding more needs a migration (check constraint) and an edit to `src/data/reactions.ts`, and the test suite fails if they drift. |
| Push collapse | **First one only:** the first reaction to an author pushes, and further ones within 5 min stay silent | No scheduler needed. Later reactions still appear live in the app. A delayed digest ("Ada and 2 others…") would need pg_cron plus a scheduled function. |
| Locked messages (PRD open question 4) | No reactions until you have read it | Enforced in RLS (`private.can_react`): the message is unfenced, or you sent it, or you have unlocked it. |
| Reacting to your own message | Allowed, never pushes | Matches common messaging apps; the function skips self-reactions. |
| Removing a reaction | `emoji = null`, never a delete | Realtime cannot apply RLS to DELETE events, so a delete would broadcast "user X removed a reaction on message Y" to every subscriber. |
| Changing a reaction | Update, no push | Only INSERT is webhooked. |
| Per-thread mute | Deferred to its own follow-up | Keeps this phase to reactions. |

## What was built

**Database** (`supabase/migrations/20261004120000_reactions.sql`)
- `message_reactions (message_id, user_id, emoji, created_at, updated_at)`, PK `(message_id, user_id)`, emoji limited to the four.
- RLS:
  - read: anyone in the thread;
  - insert or update: only as yourself, and only if `can_react`;
  - delete: no client grant at all.
- Added to the realtime publication.
- `push_log` and the `claim_push_slot(recipient, kind, window_seconds)` RPC. The RPC takes an advisory lock, then checks and inserts, so of several simultaneous reactions exactly one claims the push. Both are server-only: RLS with no policies, explicit revokes, and only `service_role` may use them.

**Push function** (`supabase/functions/push`)
- New `message_reactions` branch.
- Skips removals and self-reactions, claims the 5-minute slot, then pushes the author:
  - title: the reactor's name;
  - body: `Reacted ❤️ to "…"`, or for a fenced message `Reacted ❤️ to your message at {place}` (the text stays off the lock screen).

**App**
- `src/data/reactions.ts`: `REACTIONS` and `isReaction`.
- `Message.reactions`, mapped in `toReactions`. Null and unknown emoji are dropped.
- `setReaction` in the repository: one upsert for set, change and remove.
- Realtime INSERT and UPDATE on `message_reactions`. The store's `reactToMessage` updates optimistically and refetches the thread on error.
- `ReactionBar`: counts under the bubble, with your chip selected; tap to toggle.
- `ReactionPicker`: long-press an open bubble.
- **Nudge** (P2): right after you unlock a message in the thread, the picker opens with "Tell {name} you found it". It disappears once you react.
- **Fix from Phase 2:** the inbox query's `unlocks` embed lacked `user_id`, so inbox previews always treated the last message as not unlocked.

## Setup (once per project)

A third Database Webhook, configured exactly like the other two:
- name `push-on-reaction`
- **schema `public`**, table `message_reactions`, event **Insert**
- type Supabase Edge Functions, function `push`, method `POST`
- header `x-webhook-secret` set to `PUSH_WEBHOOK_SECRET` from `.env.local`

## Verification

- `npm run db:test` (102 checks), including:
  - who may react to what, including locked and unlocked fenced messages;
  - outsiders, spoofing, and an emoji outside the set;
  - change and remove, and that client deletes are refused;
  - the emoji set matching between client and database;
  - `claim_push_slot`: suppression inside the window, a separate window per recipient and kind, reopening after the window, and refusal for `authenticated`.
- Function called directly with seed accounts and fake tokens:
  - the first reaction pushes;
  - a second within 5 minutes is collapsed;
  - a self-reaction sends nothing.
- Simulator on a real account: picking, changing and removing a reaction update the bubble and the database row.

**Still to check**
- [x] Through the `push-on-reaction` webhook with seed accounts: a reaction insert pushes the author within about 1 second, and changing a reaction does not push. Message and unlock pushes still pass after the function was redeployed.
- [ ] Live reaction updates across two signed-in devices.
- [ ] Delivery to a real device (needs Android + Firebase, or a paid Apple Developer account).

## Follow-ups

- Per-thread mute (PRD P1). The push function would skip muted recipients for every kind.
- A delayed digest instead of first-only, if the metrics show silenced reactions matter.
- Metric from the PRD: "Unlocks followed by a reaction or reply within 1h ≥ 30%". Needs analytics events, which don't exist yet.
