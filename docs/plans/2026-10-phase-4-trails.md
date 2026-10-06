# Phase 4: Trails

| | |
|---|---|
| **Status** | Built (branch `rh/trails`) |
| **Date** | 2026-10-04 |
| **PRD** | [Found It + Trails](../prd/2026-09-found-it-and-trails.md), §4 |
| **Builds on** | Phase 1–2 (push, receipts), Phase 3 (reactions) |

## Goal

A trail is an ordered chain of 2–10 fenced stops in a thread. Unlocking one stop reveals the next, so a single surprise becomes an experience that spans places and days. This is the multi-session goal in the PRD's retention thesis.

## Decisions

| Question | Decision | Why |
|---|---|---|
| How are future stops kept secret? | **Hidden rows (RLS), not blanked columns** | The PRD suggests a view or RPC that blanks body and coordinates. A hidden row is stronger and simpler: every reader already goes through the messages SELECT policy (thread, inbox, geofence list, Realtime), so a stop you haven't earned never reaches the device or the OS geofence set. |
| Clue mode | Stop 1 always shows its pin. Stops 2+ show only the clue (from the previous stop) until you **check in** | In clue mode the device never holds a hidden stop's coordinates, so unlocking is a server RPC that compares your position with the hidden pin. Position is still device-reported, which the PRD accepts. |
| Probing the check-in for the location | At most 30 check-ins per person per trail per hour | Without a limit, scripted check-ins could sweep a city to find the hidden pin. |
| Entry points | A **Trail** button in a thread's input bar, and **Make it a trail** in compose | Both open a full-screen builder. |
| Who takes part | **Anyone in the thread, groups included.** Each person follows it at their own pace | The user asked for as many participants as needed. Visibility is per viewer, so a group costs almost nothing extra. This pulls part of Phase 5 forward. |
| Stops | 2 to 10 | PRD open question 2. |
| Creator pushes | Each found stop and the finish, **only for finders who share receipts** | Same privacy rule as Found It. |
| Push for a new trail | One push, for stop 1 only | A push per stop would leak the hidden stops' place names. |
| Editing after sending | Not supported | Out of scope in the PRD. |

## Server (`supabase/migrations/…_trails.sql`)

**Tables and columns**
- `trails (id, conversation_id, created_by, title, reveal_mode pin|clue, step_count 2–10, created_at)`. Participants read it; the creator inserts it, as a participant.
- `messages` gains `trail_id`, `trail_step` and `next_clue`, with these checks:
  - `trail_id` and `trail_step` are both set or both null;
  - trail steps are fenced;
  - `(trail_id, trail_step)` is unique.

**Visibility**
- `private.can_see_trail_step(trail, step)` is true when any of these hold:
  - it's stop 1;
  - in pin mode, the viewer has unlocked the previous stop;
  - the viewer has unlocked this stop.
- The messages SELECT policy becomes: you are the sender, or you are a participant and the row is not a hidden trail step.
- The `message_unlocks` INSERT policy also requires the message to be visible, so nobody can unlock a stop out of order.

**RPCs**
- `create_trail(conversation, title, mode, stops jsonb)`: `SECURITY INVOKER` like `create_conversation`, so RLS stays the single gate. One transaction. It validates the number of stops and that clue mode has a clue on every stop but the last. Steps get `sent_at` one millisecond apart, so they sort.
- `check_in_trail_step(trail, step, lat, lng)` returns `unlocked`, `not_here` or `too_many`.
  - Definer.
  - Requires that the caller is a participant and has unlocked the previous stop.
  - Uses the same haversine formula as `src/lib/geo.ts` and logs every attempt for the rate limit.

**Push function**
- New trail: one push for stop 1, "{sender} left you a trail", with the title and stop 1's place.
- Unlocking a stop: the creator gets "{name} found stop k of n", and the last one becomes "{name} finished your trail".

## App

- **Data:**
  - `Message.trail` (id, title, step, total, mode, next clue);
  - a `Trail` type plus `trailProgress()` for both the finder's view and the creator's view;
  - `fetchTrails`, `createTrail` and `checkInTrailStep` in the repository.
- **Store:**
  - trails load alongside the inbox;
  - unlocking a trail step refetches the thread and the inbox, so the next stop appears;
  - pin-mode next stops join `pendingFenced` automatically, which means geofencing too.
- **Trail builder** (`src/app/trail-builder.tsx`, a modal):
  - title, then a choice between "Show the pin" and "Give a clue";
  - each stop has a place (the existing `FencePicker`), what's found there, and a clue to the next stop;
  - add or remove stops.
- **Thread:**
  - every trail bubble is labelled "{title} · Stop k of n";
  - in clue mode the finder sees a clue card with **I'm here**;
  - finishing shows a completion card with **Make a trail for {creator}**;
  - the creator sees per-person progress.
- **Home:** "Waiting for you" also lists clue-mode next stops, which have no distance because there is no pin.

## Verification

- RLS tests:
  - hidden steps are invisible in both modes;
  - steps are revealed in order, and nobody can unlock out of order;
  - the creator sees every step;
  - `create_trail` validation;
  - check-in in range, out of range, before the previous stop, by a non-participant, and the rate limit;
  - a group member's progress is independent of the others'.
- Push function, through the webhooks with seed accounts and fake tokens:
  - only stop 1 pushes on create;
  - the step and finish pushes reach the creator;
  - opted-out finders send nothing.
- Simulator, on a real account: Home and the thread render with trails loaded; the Trail button opens the builder; the mode switch changes the copy and makes clues required; Send with an empty form is stopped by validation (nothing written).

**Results**
- [x] `npm run db:test`: 136/136, including 34 trail cases.
- [x] `npm run db:test:push`: 9/9 against the live project. Only stop 1 pushes on create, and a found stop and the finish push the creator. An opted-out finder sends nothing.
- [x] `tsc`, lint and the UI rules check are clean.
- [ ] Sending a real trail and walking it in the app (the clue card, check-in, completion card, and the creator's progress). This needs a trail in a real thread, or a second signed-in device.
- [ ] Delivery to a real device.

## Later (Phase 5)

- "First to finish" in groups. This needs a server view, because finders can't see each other's unlocks.
- Per-stop time windows.
- A hint button for stuck clue-mode players.
- Templates.
