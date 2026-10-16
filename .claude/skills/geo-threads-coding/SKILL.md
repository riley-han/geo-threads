---
name: geo-threads-coding
description: How to approach code changes in Geo Threads — surface assumptions, keep it simple, make surgical diffs, and prove the change with the repo's own checks (db:test, tsc, lint, the UI rules grep, the simulator). Use whenever writing, reviewing, refactoring or planning code anywhere in src/, supabase/ or scripts/.
license: MIT
---

# Geo Threads coding guidelines

Adapted from [andrej-karpathy-skills](https://github.com/multica-ai/andrej-karpathy-skills)
(MIT), which distils [Andrej Karpathy's notes](https://x.com/karpathy/status/2015883857489522876)
on how coding models go wrong. The four principles are kept; the examples and
checks are this repo's.

**Tradeoff:** these bias toward caution over speed. A typo or an obvious
one-liner doesn't need the full ritual — use judgment.

## 1. Think before coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

- State your assumptions. If you're unsure, ask instead of guessing.
- If the request reads more than one way, lay the readings out — don't pick silently.
  (Does "hide a stop" mean hidden from the map, from the thread, or from the server?)
- If there's a simpler way, say so. Push back when it's warranted.
- If something doesn't add up, stop, name what's confusing, and ask.
- Check the PRD (`docs/prd/`) and the phase plans (`docs/plans/`) before inventing
  behavior: many decisions (who sees what, what's out of scope) are already written down.
- Expo moves fast: read the v57 docs (see `AGENTS.md`) instead of relying on memory.

## 2. Simplicity first

**The least code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for code used once.
- No "flexibility" or config nobody asked for.
- No error handling for cases that can't happen.
- If you wrote 200 lines and 50 would do, rewrite it.
- Reach for what's already here before adding something: `messageVisibility()` for
  every "can I see/unlock this" question, the existing hooks in `src/hooks`, the
  stores in `src/store`, `ThemedText` / `ThemedView`, a SQL policy or RPC rather than
  client-side filtering. Don't add a dependency for something a few lines can do.

Ask: "Would a senior engineer call this overcomplicated?" If so, simplify.

## 3. Surgical changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" nearby code, comments or formatting.
- Don't refactor what isn't broken.
- Match the existing style even if you'd write it differently.
- If you spot unrelated dead code, mention it — don't delete it.
- Never edit a migration that has already shipped. Schema changes go in a new file
  (`npm run db:migrate <name>`), and `src/lib/database.types.ts` is regenerated
  (`npm run db:types`), not hand-edited.

When your change leaves orphans:
- Remove the imports, variables and functions that *your* change made unused.
- Leave pre-existing dead code alone unless asked.

The test: every changed line traces straight back to the request.

## 4. Goal-driven execution

**Define what "done" means. Loop until it's verified.**

Turn a task into something you can check. This repo has no JS unit-test runner, so
the checks are the ones below; don't add Jest just to have one.

| Change | How you prove it |
|---|---|
| Policy, RPC, trigger or table in `supabase/migrations/` | Add cases to `supabase/tests/rls.test.mjs` that fail first, then make them pass: `npm run db:test`. Test both who *can* and who *can't*. |
| Push notifications / edge functions | `npm run db:test:push` runs against the live project — ask before running it. |
| Any TypeScript | `npx tsc --noEmit` and `npm run lint` are clean. |
| Screens and components | The UI rules grep in `geo-threads-ui` is clean, and you've looked at it running (the `run` skill / iOS Simulator), in dark *and* light. |
| A bug | Reproduce it first (a failing `db:test` case, or the steps in the simulator), then fix, then show it's gone. |
| A refactor | The same checks pass before and after. |

For multi-step work, state a short plan with a check on each step:

```
1. Add closes_at to messages → verify: db:test case "refused after it closes" passes
2. Return `closed` from check_in_trail_step → verify: db:test
3. Show "Closed" on the stop card → verify: tsc, lint, UI grep, simulator
```

Bigger pieces of work get a plan in `docs/plans/` that ends with a
**Verification** checklist of exactly these commands and their results
(e.g. "`npm run db:test`: 163/163").

Report what you actually ran. If a check was skipped or couldn't run, say so.

---

**This is working if:** diffs hold only what was asked for, code is simple the first
time, and clarifying questions come before the code rather than after a mistake.
