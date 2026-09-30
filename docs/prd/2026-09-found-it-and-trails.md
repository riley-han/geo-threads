# PRD: "Found It" unlock receipts + Trails

| | |
|---|---|
| **Status** | Draft, for review |
| **Date** | 2026-09-29 |
| **Owner** | Product Engineering |
| **Scope** | One improvement (Found It) and one new feature (Trails) |

---

## 1. Summary

Geo Threads lets friends leave messages locked to a place. The message unlocks when the recipient physically arrives. The magic moment is real, but the loop only runs **one way**:

1. The sender drops a message at a place.
2. Days later, the recipient walks by, gets an arrival alert, and reads it.
3. **The sender never finds out.**

The unlock is already recorded in `message_unlocks`, but RLS only lets the *finder* read it (`supabase/migrations/20260922035424_initial_schema.sql`, policy "users read their own unlocks"). On top of that, every notification in the app is **local**: `notifyArrival` in `src/lib/notifications.ts` fires from the on-device geofence task. There is no remote push, so nothing tells a sender to come back. A new message from a friend doesn't reach you either unless the app is already open.

### Retention thesis

Messaging apps retain through two mechanics:

- **Closed loops.** Someone did something with the thing you made, and you want to see it. Read receipts, reactions, and replies all work this way.
- **Multi-session goals.** You are partway through something and want to finish it. Streaks, progress bars, and unfinished stories work this way.

This PRD adds one of each:

| Feature | Type | Mechanic | Why it brings people back |
|---|---|---|---|
| **Found It**: unlock receipts + reactions | Improvement | Closed loop | The sender gets a push when their drop is found, and the finder can react in one tap |
| **Trails**: sequenced drops | New feature | Multi-session goal | Each unlock reveals the next place, so an experience spans places and days |

Found It also ships the **remote push infrastructure** that the whole app is missing and that Trails depends on. That dependency sets the build order (§5).

---

## 2. Personas and jobs-to-be-done

| Persona | Who | Job to be done | What they lack today |
|---|---|---|---|
| **The Planner** | Partners, best friends, family | "Set up a surprise and know that it landed." | Never learns the message was found. |
| **The Explorer** | Curious, walks a lot, likes discovery | "Give me a reason to go somewhere." | Single drops are one-offs, so there is no pull to the *next* place. |
| **The Organizer** | Runs birthdays, bachelor(ette)s, team offsites, city games | "Run a shared experience across several spots." | No way to sequence drops or see progress. |

The Planner is the core sender. The Planner's retention depends on hearing back, which is Found It. The Explorer and the Organizer are the growth wedge, and Trails serves them. Trails also turns finders into creators (§4 metrics).

---

## 3. Feature A: "Found It" (unlock receipts + reactions)

### 3.1 Problem

A fenced message is the most effortful thing a user can send in Geo Threads. They picked a place, a radius, and words meant for that spot. It is also the only message type that gives **zero feedback**. Effort with no payoff teaches senders to stop sending.

### 3.2 User stories

- **Sender.** When my friend unlocks my message, I get a push: *"Ada found your message at Blue Bottle."* In the thread, my bubble shows **Found · 2:14 PM**.
- **Sender, group thread.** My bubble shows **Found by 2 of 4**. Tapping it lists who found it and when.
- **Finder.** Right after I unlock a message, I can tap a quick reaction (❤️ 😂 😮 🙏) without writing a reply. The sender is notified.
- **Anyone.** When a friend sends me a message while the app is closed, I get a push. This does not happen today.
- **Privacy-conscious finder.** I can turn off *"Let senders know when I find their messages"* in Profile. My unlocks still work for me, but senders see nothing.

### 3.3 Requirements

| Pri | Requirement | Notes |
|---|---|---|
| P0 | **Remote push for new incoming messages** | This is the biggest single retention gap. Push copy for a fenced message never includes its body, which keeps the rule already in `notifyArrival`: *"the reader is in range, but a lock screen is not."* Open messages may show a preview, subject to the OS preview settings. |
| P0 | **Unlock receipt on the sender's bubble** | `src/components/message-bubble.tsx`. 1:1: "Found · {time}". Group: "Found by N of M". |
| P0 | **Push to the sender on unlock** | "{Name} found your message at {place label}." Tapping it deep-links to the thread. |
| P0 | **Privacy toggle**, default ON | Lives in Profile. When OFF, the sender cannot read your unlock rows at all. This is enforced in RLS, not just hidden in the UI. |
| P1 | **Reactions** on any open message | A fixed set of 4–6 emoji, one reaction per person per message (it can be changed). Shown as a compact row under the bubble. |
| P1 | **Reaction push** to the message author | Collapsed: several reactions within 5 minutes become one push. |
| P1 | **Coarsened receipt time** | Minute precision. A receipt says *which* message was found, never a live location or a trail of positions. |
| P2 | "Found it" nudge prompt | After unlock, a one-tap "Tell {sender} you found it" button that sends a reaction. |

### 3.4 Data model and technical design

Everything below builds on the existing schema and client patterns.

**Receipts (server)**
- Add `share_unlock_receipts boolean not null default true` to `public.profiles`, or put it in a new `user_settings` table if more settings are expected soon.
- Add a second SELECT policy on `public.message_unlocks`: *the sender of the message can read unlock rows for it, if the finder has `share_unlock_receipts = true`.* Implement it as a `private.` security-definer predicate, following the existing pattern (`private.owns_message`, `private.is_conversation_participant`), to avoid RLS recursion.
- Add `message_unlocks` to the `supabase_realtime` publication, so the "Found" state appears live in an open thread.

**Push (server)**
- New table `public.push_tokens (user_id, token, platform, updated_at)`, PK on `(user_id, token)`, with RLS limiting each user to their own rows.
- The client registers its token via `Notifications.getExpoPushTokenAsync()` right after `requestNotificationAccess()` succeeds (both call sites: `src/app/(tabs)/profile.tsx` and `src/app/conversation/[id].tsx`). It unregisters on sign-out, next to `clearMirror`.
- A Supabase **Edge Function** is invoked by Database Webhooks on:
  - `insert on messages`: pushes every other participant.
  - `insert on message_unlocks`: pushes the message's sender, if the finder shares receipts.
  - `insert on message_reactions`: pushes the message's author (batched).
- The function calls the Expo Push API, prunes tokens that come back `DeviceNotRegistered`, and respects per-thread mute (P1).
- **Dedupe with local alerts:** the finder already gets a local arrival notification from `src/lib/geofence-task.ts`. The server push for `messages` inserts goes to recipients only; unlock pushes go to senders only. The two never overlap for the same person.

**Reactions (server)**
- New table `public.message_reactions (message_id, user_id, emoji, created_at)`, PK on `(message_id, user_id)`.
- RLS: read if `private.owns_message(message_id)`. Insert, update, or delete your own row only, and only for a message you can read.

**Client**
- `Message` in `src/data/types.ts` gains:
  - `foundBy: { person: Person; at: number }[]`, meaningful only on your own messages.
  - `reactions: { emoji: string; personId: string }[]`.
- Mapping goes in `src/data/repository/mappers.ts` (`toMessage`), and the fetch in `src/data/repository/messages.ts` adds the joins.
- `src/store/messages-store.tsx` subscribes to realtime `message_unlocks` and `message_reactions` in the same way it already handles `messages`.

### 3.5 Success metrics

| Metric | Target (first 60 days) |
|---|---|
| Senders who reopen the app within 24h of a receipt push | ≥ 45% |
| Unlocks followed by a reaction or reply within 1h | ≥ 30% |
| D30 retention: senders with ≥ 1 receipt vs. senders with none | +10 pts |
| Push permission opt-in (new users) | ≥ 60% |
| Receipt-toggle opt-out rate | < 10% (guardrail: a higher rate signals a privacy concern) |

---

## 4. Feature B: Trails (sequenced drops)

### 4.1 Problem

Every drop today is a single moment. Users have no way to plan an **experience**, meaning a sequence of places that unfolds over an evening, a weekend, or a month. Yet the offline behaviors people already organize around are sequential: scavenger hunts, anniversary recaps of "places we've been", birthday surprises, and city walking tours.

### 4.2 Concept

A **Trail** is an ordered chain of fenced messages inside a thread.

- Only **step 1** is visible at first.
- Unlocking step *N* reveals step *N+1*, in one of two ways chosen by the creator:
  - **Pin mode:** the next place shows on the map, as it would for a normal drop.
  - **Clue mode:** only a text clue appears ("Where we had our first coffee ☕️"). The finder has to work out where to go, and the pin stays hidden.
- Finishing the last step triggers a completion card for the finder and a push for the creator.

### 4.3 User stories

- **Planner.** From compose I tap **Make it a trail**, add 3–10 stops with the existing fence picker, write a message for each stop, and optionally a clue that leads to the next one.
- **Finder.** In the thread I see a trail card: *"Trail · Step 2 of 5"* with the clue or pin. On Home, the trail shows under **Waiting for you** with its progress.
- **Creator.** I get a push as each step is found (this reuses Found It), then *"Ada finished your trail 🎉"* with the completion time.
- **Finder, after finishing.** The completion card offers **Make a trail for {creator}**. This is the viral loop.

### 4.4 Requirements

| Pri | Requirement | Notes |
|---|---|---|
| P0 | Create a trail: ordered stops, each with a fence, a body, and an optional next-stop clue; reveal mode set to pin or clue | Builder reuses `src/components/fence-picker.tsx` and `src/components/radius-slider.tsx` in `src/app/compose.tsx`. |
| P0 | **Gated reveal**: step N+1 is hidden until the viewer has unlocked step N | Enforced server-side (see §4.5). |
| P0 | Hidden steps are **not** registered as OS geofences and **not** mirrored into `pending_fenced` | Otherwise the background task would fire an arrival alert for a stop the finder hasn't earned. |
| P0 | Progress UI in the thread (trail card) and on Home ("Waiting for you") | |
| P0 | Completion event: finder card + creator push | Reuses the Found It push pipeline. |
| P1 | Group trails: progress per person, "first to finish" shown on the completion card | |
| P1 | Per-stop time window ("unlocks after 7 PM") | |
| P1 | Hint button: reveals the pin for a clue-mode step after N hours stuck | Keeps players from abandoning a trail when a clue is too hard. |
| P2 | Templates: *Birthday hunt*, *Our places*, *City walk* | Pre-filled structure and copy, with the user choosing the places. |

### 4.5 Data model and technical design

**Server**
- New table `public.trails (id, conversation_id, created_by, title, reveal_mode, created_at)`, where `reveal_mode` is an enum `pin | clue`.
- `public.messages` gains `trail_id uuid null references trails`, `trail_step int null`, and `next_clue text null`, with a check that `trail_id` and `trail_step` are either both null or both set and that trail messages are fenced.
- A `create_trail(p_conversation_id, p_title, p_reveal_mode, p_stops jsonb)` RPC inserts the trail and all its stops in one transaction. Like `create_conversation`, it is `SECURITY INVOKER`, so RLS stays the single source of truth.
- **Gating (important).** Today, fenced message bodies *and* coordinates are delivered to the client before unlock, by design (see the policy comment on `messages`). That is fine for single drops, but it breaks a hunt: anyone who inspects the payload can see every stop. For trail messages:
  - Serve trail rows through a view or RPC that returns `null` for `body`, the `fence_*` columns, and `next_clue` on any step whose predecessor the caller has not unlocked. It still returns the step count so the progress UI can render "Step 2 of 5".
  - The creator always sees the full trail.
  - When step *N* is unlocked, the client refetches, and step *N+1* comes back populated.
- A completion row or event (the last step's unlock) drives the creator push through the same webhook and Edge Function as Found It.

**Client**
- `src/lib/message-visibility.ts`: `messageVisibility()` gains `{ kind: 'hidden'; trailStep: number; clue?: string }`. Every surface already goes through this function, including bubbles, inbox previews, and Home, so all of them inherit the rule without changes of their own.
- `src/store/messages-store.tsx`: `pendingFenced`, which is exposed as `usePendingFencedMessages()` and written to the SQLite mirror via `replaceMirror`, excludes hidden steps. Because `src/store/geofence-sync.tsx` builds its regions from that same list, hidden steps are never monitored.
- A side benefit: registering only the *current* step of each trail keeps us well under the iOS limit of 20 monitored regions, which `geofence-sync.tsx` already works within.
- `Message` in `src/data/types.ts` gains `trail?: { id: string; step: number; total: number; revealMode: 'pin' | 'clue'; nextClue?: string }`.
- New components: `trail-card.tsx` (in-thread progress) and a trail row variant on Home.

### 4.6 Success metrics

| Metric | Target (first 90 days) |
|---|---|
| Trails created per weekly active user | ≥ 0.15 |
| Trail completion rate | ≥ 55% |
| Median time to complete | Tracked; used to tune the hint timing |
| Finishers who create their own trail within 14 days | ≥ 20% (viral loop) |
| Return rate on ≥ 3 distinct days while a trail is active | ≥ 40% |

---

## 5. Sequencing

| Phase | Ships | Depends on |
|---|---|---|
| 1 | Push token registration, Edge Function, **push for new messages** | None |
| 2 | Unlock receipts: RLS policy, bubble state, sender push, privacy toggle | 1 |
| 3 | Reactions + reaction push | 1 |
| 4 | **Trails v1**: 1:1, pin and clue modes, server-gated steps, completion push | 1, 2 |
| 5 | Group trails, time windows, hints, templates | 4 |

Phase 1 alone should produce a measurable retention lift, because today the app never reaches a user who isn't already in it.

---

## 6. Risks, out of scope, and open questions

### Risks

| Risk | Mitigation |
|---|---|
| **Location privacy.** A receipt implies "was at place X around time T". | Default-on toggle enforced in RLS. Time coarsened to the minute. Receipts shown only to the message's sender, never to other group members. |
| **Push fatigue** | Collapse reactions. Cap trail pushes (at most N per trail per hour). Add per-thread mute (P1). |
| **Spoofed unlocks.** Unlocks are client-reported. | Accepted for v1: the graph is friends-only, and spoofing GPS to fake a friend's scavenger hunt is low-stakes. A trusted-position check remains out of scope, as the migration already notes. |
| **Trail spoilers via payload inspection** | Server-side nulling of gated steps (§4.5). This is required for v1, not deferred. |
| **Abandoned trails** from clues that are too hard | Hint button (P1), plus completion-rate monitoring per reveal mode. |

### Out of scope

- Public or stranger trails. The friends-only rule stays, and it is enforced in RLS.
- Media (photos or voice) in drops. This is a strong follow-up candidate.
- Editing a trail after it has been sent.

### Open questions

1. Should the receipt toggle default **ON**? This draft recommends yes, because the loop is the point, but it should get a privacy review.
2. Maximum trail length: 10 stops for v1?
3. Should senders in group threads see *who* found a message, or only the count?
4. Do reactions apply to locked messages? This draft says no: you react to what you have read.
