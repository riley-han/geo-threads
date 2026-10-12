# Geo Threads: plan to harden security, speed up the app, and polish the UI

## Context
You asked for a full pass over what's built so far (threads, Found It, reactions, trails) covering security, efficiency and UI/UX. I read every migration and the push Edge Function myself. Two parallel reviews read the client data layer and every screen and component, and I re-checked their most serious findings. The baseline is healthy: `npm run db:test` passes all 163 RLS checks, the theme rules are mostly followed, and a lot is already done well.

There are real problems, though:
- several RLS holes;
- the core promise, "you have to be there," is enforced only on the client;
- a developer location-spoofing toggle ships to every user;
- the inbox refetches too often, which wastes requests and can bring back stale data;
- some basic UX is missing: failed sends look like they went through, threads open at the oldest message, and there are no haptics.

Decisions you made: **unlocks are verified on the server and locked text is withheld until unlock**, and the work ships as **phased PRs**. Per AGENTS.md, check the Expo v57 docs before writing code (expo-haptics, expo-location accuracy, FlatList and keyboard APIs).

---

## PR 0: Hotfix (small, ship first)
- Put the "GPS / Inside / Away" pill (`src/app/conversation/[id].tsx:276`) and `jumpInside`/`jumpFarAway`/`cycleSimulation` (`src/store/location-store.tsx:22-25,104-106`) behind `__DEV__`. In release builds the simulated position is always null.
- Notification routing (`src/app/_layout.tsx:35-53`): keep the handled response's `notification.request.identifier` in a ref so a token refresh (a new `session` object) doesn't open the same thread again. Validate that `conversationId` is a UUID before routing.

---

## PR 1: Security
New migration `supabase/migrations/2026101x_hardening.sql`, then `npm run db:types`.

**Close the RLS holes (each one checked against the policy text):**
1. **friendships**
   - Today a user can insert a row with `status='accepted'` and force a friendship with anyone. The addressee can also rewrite `requester_id`.
   - Fix: the insert check also requires `status = 'pending'`. Change the grants to `revoke update` then `grant update (status)`.
2. **conversation_participants**
   - Today you can update your own row's `conversation_id` and join any thread.
   - Fix: `grant update (last_read_at)` only. Add an RPC `mark_conversation_read(p_conversation_id)` that sets `last_read_at = now()` on the server clock. That also fixes the device-clock skew in `src/data/repository/conversations.ts:98-105`.
3. **conversations**: `grant update (title)` only.
4. **messages insert**
   - Today the client can set `sent_at`, `trail_id`/`trail_step`, `next_clue` and `opens_at`/`closes_at` directly.
   - Fix: revoke direct insert. Add a `send_message(p_id, p_conversation_id, p_body, p_fence_*)` RPC (security definer, with explicit sender/participant checks and the server clock).
   - `create_trail` becomes security definer with an explicit participant check, since it can no longer rely on the insert grant.
5. **Sealed bodies.** The locked text stops reaching the device before unlock.
   - New table `public.message_sealed (message_id pk → messages, body, next_clue)`.
   - RLS select: you are the sender, or you have a `message_unlocks` row for the message.
   - `messages.body` becomes nullable, with a check: body is null for fenced messages and not null for open ones. `next_clue` moves to the sealed table.
   - Data step: copy existing fenced bodies and clues across, then null them on `messages`.
   - `send_message` and `create_trail` write fenced bodies to the sealed table. Coordinates stay on `messages`, so distance, the map and geofences keep working.
6. **Verified unlocks**
   - New RPC `unlock_message(p_message_id, p_latitude, p_longitude, p_accuracy)`, security definer. It checks:
     - `private.can_see_message` and `private.is_open_now`;
     - haversine distance ≤ `radius + least(accuracy, 25)` (the same formula as `check_in_trail_step`);
     - a rate limit, by turning `trail_check_ins` into a general `unlock_attempts` log.
   - It returns `{status, body, next_clue}`, so the client can show the text without refetching.
   - Drop the insert policy on `message_unlocks` and revoke insert. `check_in_trail_step` uses the same helper and also returns the body.
   - Known limit to note in the docs: a spoofed GPS position still works. The server can't verify a device's position, but casual and scripted cheating is closed.
7. **profiles**
   - Today anyone signed in can list every user.
   - Fix: select is allowed for yourself, friends and pending requests, people you share a thread with, and finishers via the existing definer RPCs.
   - Search moves to an RPC `search_profiles(p_query)` with at least 2 characters, a limit of 20, and the same name/handle substring match that `src/data/repository/profiles.ts:28-33` does today.
8. **Default grants**: revoke the `alter default privileges … to authenticated` from `20260928030830_grant_table_privileges.sql`, so new tables are locked by default. Add a test that every `public` table has RLS enabled.

**Push Edge Function** (`supabase/functions/push/index.ts`)
- Compare the secret in constant time.
- Add `kind`, `trailId` and `messageId` to `data`, so taps can deep-link (used in PR 3).
- Reaction and unlock pushes already keep fenced text off the lock screen. Keep that, and read the label only.

**Client changes for PR 1**
- `src/data/repository/messages.ts`:
  - `createMessage` and `unlockMessage` switch to the RPCs.
  - `unlockMessage` sends `position.accuracy`; the location store has to keep it (see PR 2).
  - `MESSAGE_SELECT` embeds `sealed:message_sealed(body,next_clue)`, and `mappers.ts` reads `row.body ?? row.sealed?.body`.
  - A realtime insert of a fenced row arrives with no body. That's fine: it's locked anyway.
- `src/data/repository/profiles.ts`: search uses the RPC.
- `src/data/repository/conversations.ts`: mark-read uses the RPC.
- `src/lib/push.ts`: save the registered token (expo-sqlite kv-store) so sign-out can always delete it. Delete the token only after `auth.signOut()` succeeds; re-register if sign-out fails.
- Auth hardening:
  - `supabase/config.toml` (and the hosted dashboard): `minimum_password_length = 8`, `password_requirements = "letters_digits"`, `enable_confirmations = true`.
  - Optional follow-up: move the session out of plaintext SQLite into the SecureStore-backed "LargeSecureStore" pattern.

**Tests**: extend `supabase/tests/rls.test.mjs` with denied cases:
- self-accepted friendship;
- rewriting `requester_id`;
- changing a participant's `conversation_id`;
- a direct insert into `messages` or `message_unlocks`;
- reading a sealed body before unlock;
- `unlock_message` from too far away, outside the time window, and over the rate limit;
- profile enumeration.

Add allowed cases for each RPC.

---

## PR 2: Efficiency and data correctness
**Messages store** (`src/store/messages-store.tsx`)
- Replace the 11 direct `loadInbox()` calls with `scheduleInboxRefresh()`: single-flight with a ~250 ms trailing debounce, plus a request sequence number so older results are ignored. That fixes stale pending-fenced data bringing a geofence back.
- Realtime: resolve the sender from `conversations[].participants` first, fall back to a small profile cache, and skip work for your own echo (`:306, :350`).
- Refetch on resume only when the app is coming back from `'background'`, not from `'inactive'` (also in `social-store.tsx` and `location-store.tsx`).
- When a refresh fails, keep the last good state: no `state: 'error'` that turns off geofencing (`:157`), and no emptied thread (`:221`).
- Merge refetched rows so `'sending'` and `'failed'` rows are kept. Give a thread a "dirty" flag so events that arrive during a load trigger one more fetch.
- The unlock result now comes from the RPC: only reveal on `status === 'unlocked'`, and return the status so the UI can show it.

**Context churn**
- Split into a stable actions context (actions read state through refs) and separate state contexts.
- Split position from permission in `location-store.tsx`.
- `auth-store.tsx` exposes a stable `userId` instead of the `session` object.
- `React.memo` on `MessageBubble`, `InboxRow` and the trail rows. Move position reads out of each bubble into the screen.
- Use stable `renderItem` callbacks in `conversation/[id].tsx` and `messages.tsx`.

**Queries**
- New RPC `pending_fences()`, filtered on the server: only fences you haven't unlocked, lean columns plus `opens_at`/`closes_at` and the sender's name. It replaces `fetchPendingFenced`'s full select and client-side filter.
- `fetchTrails` gets a lean select.
- Paginate threads with `.range()` for the newest 50, and load older pages on scroll.
- (`messages_trail_step_key` already indexes `trail_id`, so no new index is needed.)

**Realtime** (`messages.ts:146`)
- Handle subscribe status and catch up with a refetch when it returns to `SUBSCRIBED`.
- Subscribe to `friendships` and `conversation_participants`, which are already in the publication, so friend requests and new threads appear live.
- Stretch goal: per-user Broadcast via `realtime.broadcast_changes` once there are enough users to need it.

**Geofencing** (`src/store/geofence-sync.tsx`, `src/lib/geofence-task.ts`, `src/db/*`)
- Sort region identifiers before building the signature, so reordering doesn't re-register regions and trigger repeat Enter alerts.
- Move to schema v-next: the mirror stores lat, lng, radius, `opens_at`, `closes_at` and `last_notified_at`. The task skips closed or not-yet-open stops and uses a 30-minute cooldown per fence.
- Use 19 fences plus 1 exit region around the last position. On exit, the task re-ranks from the mirror. Use `notifyOnExit` only for that region.
- Mirror writes go through `withExclusiveTransactionAsync` (or a queue) and are skipped when the rows haven't changed.
- Log instead of swallowing errors. Check `cancelled` before early stops.
- Add a foreground timer for the next window boundary, so scheduled stops flip on time.

**Location** (`src/store/location-store.tsx`)
- Add a generation counter so the watch start/stop race can't leave GPS running.
- Keep `coords.accuracy`. Switch to `Accuracy.High` within ~500 m of a pending fence and `Balanced` otherwise.
- Add `.catch` on `start()`/`getLocationAccess()` and surface "location services off."

---

## PR 3: UI/UX polish (follow `.claude/skills/geo-threads-ui/SKILL.md`)
**Core messaging**
- Conversation:
  - use an inverted `FlatList` with paged data so it opens at the newest message and new sends stay in view;
  - show "Sending…" and "Couldn't send. Tap to retry / Delete" on bubbles;
  - add an in-flight guard in `message-input-bar.tsx` against double sends;
  - show inline errors on send and unlock;
  - make the header open a members sheet.
- Haptics: add `expo-haptics` and a `src/lib/haptics.ts` wrapper. Fire on send, unlock success ("You're here"), check-in result, reaction, long-press, radius slider steps, and trail sent.
- Pull-to-refresh on Home, the inbox and threads.

**Location-aware states**
- When there's no fix or permission:
  - Home shows a "Turn on location" card instead of "Nothing waiting nearby";
  - the map doesn't show distances from `DEFAULT_POSITION`;
  - fence-picker's "Where I am" is disabled with an explanation;
  - trail-status gets a real button.
- Show an offline banner (via `@react-native-community/netinfo`, after checking the Expo v57 docs).

**Flows**
- Confirm before discarding drafts in compose and the trail builder (`usePreventRemove` covers swipe-down too), and before "Remove stop."
- Make recipient tokens two-tap to remove.
- "Make it a trail" stops creating the conversation up front. The builder takes the recipients and creates the conversation when the trail is sent, so cancelling leaves no empty thread.
- Trail-builder validation opens stop 1 when the loop needs it. Hide "Give the trail a name" until the user tries to send.
- Notification taps route by `kind`: trail stops and `trail_finished` open `/trail/[id]` (reuse `src/lib/message-route.ts`), and a multi-message arrival opens `/map`.
- Make Home's friend avatars tappable. Make the map sheet draggable or remove its handle.

**Accessibility**
- Add `accessibilityLabel`/`accessibilityRole` to every icon-only control: ✎, send ↑, 📍, ‹ back, ✕, the unlock bubble, ✓, and the search inputs.
- Give every target at least 44 pt (via `hitSlop` or size): reaction chips, friend actions, input-bar buttons, tokens, chips.
- `radius-slider.tsx`: `accessibilityRole="adjustable"` with increment and decrement actions.
- Announce errors with live regions. Mark the priming sheet with `accessibilityViewIsModal`.
- Dynamic Type: replace fixed heights with `minHeight`, and measure glass header heights with `onLayout` instead of the hardcoded `HEADER_HEIGHT = 140` / `52`.

**Keyboard**
- Fence-picker: the Name input gets `automaticallyAdjustKeyboardInsets`.
- Login: wrap the form in a `ScrollView`, and move focus to the next field via refs.
- Fix the double safe-area gap above the keyboard in the conversation and compose screens. Use the Android edge-to-edge `behavior`.

**Consistency and SKILL compliance sweep**
- Extract shared `ModalHeader`, `ScreenHeader`, `Button` (primary/secondary, `Radius.medium`, 48 pt) and `SearchField` components, then replace the three header patterns and the button variants in roughly 10 screens.
- Fix these rule violations:
  - `borderRadius: 999` → `Radius.pill`, and Spacing-as-radius → `Radius.*`;
  - magic spacing values;
  - `fontSize` overrides → `ThemedText` types;
  - the raw `<Text>` in `messages.tsx:150`;
  - the People input's `fontFamily`;
  - the hex in `animated-icon.tsx:138`.
- Gold only marks "waiting in the world": change the friend-request banner, the preset chips and the duplicate gold in trail-status. Fix light-theme contrast for the accent dot and slider fill.
- Copy: "geofence" → place; "New message"; "a note"; "Inbox" vs "Messages"; consistent fallback names and @handle format.
- Leftovers that currently ship:
  - Messages and Profile tab icons (Profile currently reuses Home's icon);
  - the Expo logo on the splash overlay;
  - hide "Continue with Gmail" until it's configured;
  - Android "iOS-only for now" copy.
- Lists: switch the ScrollView+map lists (people, profile friends, map list) to `FlatList`.

---

## Verification
- `npm run db:test` passes, including every new denied and allowed case. `npm run db:test:push` against a dev project checks the push payloads and the reaction collapse.
- `npm run lint` and `npx tsc --noEmit` are clean. Grep checks from SKILL.md: no hex, `fontWeight` or raw `Text`.
- Run in the iOS Simulator with the `run` skill:
  - send to a friend, sending while offline (the failed state and retry), and a double tap;
  - a locked message: confirm the REST response has no body before unlock, simulate the location (Simulator → Features → Location) and unlock;
  - build a clue trail and a pin trail and complete both; check the finishing order;
  - reactions, push deep links into the trail, and a sign-out/sign-in account switch (the mirror is cleared and the token removed).
- With the Accessibility Inspector and VoiceOver, check labels and targets at the largest Dynamic Type size, in both light and dark themes.
- Geofencing: watch that regions aren't re-registered when moving within a 20-region set; confirm no repeat alerts at a boundary; confirm a closed stop doesn't alert.
