# Phase 5: Trails, continued

| | |
|---|---|
| **Status** | Built (branch `rh/trails-phase-5`) |
| **Date** | 2026-10-05 |
| **PRD** | [Found It + Trails](../prd/2026-09-found-it-and-trails.md), §4.4 rows P1 and P2 |
| **Builds on** | [Phase 4](2026-10-phase-4-trails.md). Group trails already shipped there. |

## Scope

| Item | Decision |
|---|---|
| **First to finish** | Everyone in the thread sees the finishing order and times. People who turned off receipts are left out of everyone else's view, and ranks are counted among the people shown. |
| **Time windows** | Per stop: an optional **opening** date and time, and an optional **closing** date and time. These are absolute moments, so there are no time zones to store. Before it opens, a stop can be seen (if earned) but not unlocked. After it closes, it can no longer be unlocked. |
| **Hints** | Clue mode only. The creator picks the delay: never, 1 h, 6 h or 24 h. Once a finder has been stuck that long since finding the previous stop, **Show me the pin** reveals the next stop's pin. The creator sees who used a hint. |
| **Templates** | *Birthday hunt*, *Our places* and *City walk*. Each pre-fills the title, mode, hint delay, number of stops and per-stop prompts; you still pick the places. Client-only. |

## Server (`…_trails_phase_5.sql`)

**Time windows**
- `messages.opens_at` and `closes_at`, allowed only on trail stops, with `closes_at > opens_at`.
- The unlock INSERT policy adds `private.is_open_now(message)`.
- `check_in_trail_step` returns `not_open` or `closed` when you're at the right place at the wrong time.

**Hints**
- `trails.hint_after_minutes` (null means hints are off).
- `trail_hints (trail_id, user_id, step, used_at)`: read by the finder or the trail's creator, written only by an RPC.
- `use_trail_hint(trail, step)` returns `revealed`, `too_soon`, `disabled` or `not_needed`. It checks the time against the server clock and your unlock of the previous stop.
- `can_see_trail_step` also admits a stop you've used a hint for. That's what puts its pin on the map, and then it unlocks like any pin-mode stop.

**Finishing order**
- `trail_finishers(trail)` (definer) returns the people who unlocked the last stop, in order, with their rank. You must be in the thread. It leaves out finishers who turned off receipts, except yourself.

**Trail creation**
- `create_trail` gains `p_hint_after_minutes`, and each stop gains optional `opens_at` and `closes_at`. The old signature is dropped so PostgREST has exactly one function to call.

## App

- `messageVisibility()` gains `scheduled` (not open yet) and `closed`. Every surface already goes through it.
- Stops that aren't open aren't registered as geofences, so there are no misleading arrival alerts. They're picked up again on the next refresh once they open.
- **Builder:**
  - template chips;
  - a hint delay in clue mode;
  - per stop, **Set an opening time** and **Set a closing time** (`@expo/ui/community/datetime-picker`).
- **Thread:**
  - the clue card shows "Hint in 3 h" or a **Show me the pin** button;
  - completion cards show the finishing order;
  - the creator's card marks who used a hint and shows the order.
- **Home:** stops that haven't opened yet are listed with "Opens Sat 7:00 PM".

## Not included

- A push when a stop opens. That needs a scheduler (pg_cron plus a function), and the in-app state is enough for now.
- Re-registering a geofence while the app is in the background at the moment a stop opens.

## Verification

- [x] `npm run db:test`: 163/163. 27 new cases:
  - windows: visible before opening, but no unlock; unlocking after it opens; refused after it closes; `not_open` on check-in; constraints;
  - hints: `too_soon`, revealed after the delay, visible only to the finder, readable by the creator, disabled in pin mode and when off, direct inserts refused;
  - finishing order: ranks, visible to the creator, hidden from outsiders, opted-out finishers left out with no gap.
- [x] `npm run db:test:push`: 9/9 against the live project after the migration.
- [x] `tsc`, lint and the UI rules check are clean.
- [ ] Simulator walkthrough of the builder (templates, hint delay, date pickers), the clue card hint, and the finish card. Not done: when I came to check, the simulator was signed in to another person's account, so I stopped.
