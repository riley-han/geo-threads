# Supabase setup

Everything here is managed by the Supabase CLI, installed as a dev dependency —
no global install needed. Prefix commands with `npx`, or use the `npm run`
scripts noted below.

## 1. Point the app at your project

```bash
cp .env.example .env.local
```

Fill in both values from the dashboard under **Project Settings → API Keys**:

| Variable                               | Where it comes from                        |
| -------------------------------------- | ------------------------------------------ |
| `EXPO_PUBLIC_SUPABASE_URL`             | Project URL                                |
| `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Publishable key (the legacy `anon` key also works) |

`.env.local` is gitignored; `.env.example` is committed as documentation.

Two things worth being clear about:

- **`EXPO_PUBLIC_` variables are inlined into the compiled app in plain text.**
  Anyone who downloads the app can read them. That is fine for the publishable
  key — it is designed to be public, and RLS is what actually protects your
  data. It is never fine for the secret/service-role key, which bypasses RLS
  entirely. Never give that key an `EXPO_PUBLIC_` prefix or import it from
  anything under `src/`.
- **They are read at build time, not runtime.** After editing `.env.local`,
  restart with `npx expo start --clear`; a running dev server will not pick up
  the change.

## 2. Link the CLI and push the schema

```bash
npx supabase login
npx supabase link --project-ref <your-project-ref>
npm run db:push
```

The project ref is the subdomain of your project URL
(`https://<project-ref>.supabase.co`).

## 3. Generate the types

```bash
npm run db:types
```

This overwrites `src/lib/database.types.ts` from the live schema. **The
generator owns that file entirely** — never hand-edit it, because the next run
silently discards whatever you added.

Domain aliases (`ProfileRow`, `MessageRow`, `Tables<'...'>` and friends) live in
`src/lib/supabase-types.ts` for exactly that reason. Import row types from
there; import `Database` itself from the generated file.

**The migrations are the source of truth.** If the types and the SQL ever
disagree, regenerate rather than editing either one by hand.

## Scripts

| Script                       | What it does                                        |
| ---------------------------- | --------------------------------------------------- |
| `npm run db:test`            | Runs the RLS test suite (no Docker, no network)      |
| `npm run db:push`            | Applies local migrations to the linked project       |
| `npm run db:pull`            | Writes a migration for schema changes made in the UI |
| `npm run db:diff`            | Shows the SQL difference against the linked project  |
| `npm run db:migrate <name>`  | Creates a new timestamped migration file             |
| `npm run db:types`           | Regenerates `src/lib/database.types.ts`              |
| `npm run db:seed`            | Creates test accounts and threads in the linked project |

Run `db:types` after every `db:push`, so the types and the schema never drift.

## Seeding test data

```bash
npm run db:seed
```

Creates four confirmed accounts at `@geothreads.test` (password
`threads-dev-1234`), two accepted friendships, one **pending** request so the
accept/decline path is reachable on a single device, two threads, and one
message fenced to the Ferry Building — which is also `DEFAULT_POSITION` in
`src/data/places.ts`, so the conversation screen's jump pill unlocks it without
leaving your desk.

It needs `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in `.env.local`. The
service role key **bypasses RLS entirely**: it must never carry an
`EXPO_PUBLIC_` prefix and must never be imported from anything under `src/`.
The script imports nothing from `src/` for that reason, and refuses to run if
`SUPABASE_URL` does not match the project the CLI is linked to.

Re-running is safe. Users are looked up by email before creation and every row
it writes has a deterministic id, so a second run updates in place.

It creates auth users through `auth.admin.createUser` rather than inserting
into `auth.users`, so GoTrue hashes the passwords and the `on_auth_user_created`
trigger builds the profile rows. That is also why it is a script and not a
`seed.sql`.

## Testing RLS

```bash
npm run db:test
```

This runs the migrations against Postgres compiled to WebAssembly (PGlite), so
it needs neither Docker nor a network connection, and is safe to run in CI.

It is not a syntax check. Each case switches the Postgres role to
`authenticated` and sets the JWT claim — which is what PostgREST does per
request — then asserts that a user can do exactly what they should and nothing
more: that a non-participant cannot read a thread, that nobody can send a
message as someone else, that a non-friend cannot be added to a conversation,
and that `fence_key` matches the client's `fenceKey()` byte for byte.

Switching role matters. RLS is bypassed for a table's owner, so tests that run
as the owner pass vacuously no matter how wrong the policies are.

Add a case whenever you add a policy. The suite is `supabase/tests/rls.test.mjs`.

## Schema notes

The schema mirrors the local SQLite model in `src/db/schema.ts`, with two
deliberate departures.

Locally there is exactly one reader, so per-reader state can sit on the shared
row: `conversations.unread` and `messages.unlocked_at`. On a shared server those
are per-viewer facts — two people in a group thread unlock the same fenced
message at different times — so they move to their own places:

| Local (SQLite)          | Server (Postgres)                            |
| ----------------------- | -------------------------------------------- |
| `conversations.unread`  | `conversation_participants.last_read_at`     |
| `messages.unlocked_at`  | `message_unlocks (message_id, user_id)`      |

Friendships are one row per pair rather than one per direction. `requester_id`
records who asked, so the client derives `pending_in` vs `pending_out` by
comparing it to its own id. A unique index on `(least(...), greatest(...))`
makes the pair unordered, so A→B and B→A cannot both exist.

`fence_key` is set by trigger from the coordinates rather than supplied by the
client, so it cannot drift from the fence it names. Do not write it.

### A note on fenced messages

The `SELECT` policy on `messages` is deliberately **not** gated on the reader's
position. A fenced message is delivered to the device and revealed by the client
once it is in range, which is exactly what the local implementation does — but
it means the body is on the device before the reader arrives, and a determined
user could read it out of the local store or off the wire.

If the fence needs to be a real secret rather than a UI affordance, the body has
to stay server-side until arrival: withhold it from the row and serve it from an
RPC that checks a position it can trust. That is a product decision about how
much you trust the client, not an oversight — it is called out here so the
choice stays visible.

### Why the `private` schema

The security-definer predicates live in `private`, not `public`, so PostgREST
does not expose them as callable endpoints (it only serves the schemas in its
exposed-schemas setting, `public` by default).

They exist to break RLS recursion. The policy on `conversation_participants`
needs to know whether you are a participant, which reads
`conversation_participants`, which runs the policy again. A definer function
reads the table as its owner, so the inner policy never fires.

`authenticated` is granted `USAGE` on the schema because **RLS policy
expressions are evaluated as the calling role**, not as the table owner. Revoke
that grant and every policy using a helper fails with `permission denied for
schema private`.

### `INSERT ... RETURNING` and SELECT policies

`supabase-js` always sends `.insert().select()`, and Postgres applies the
`SELECT` policy to the returned row. So a `SELECT` policy that only admits
existing participants makes creating a conversation impossible: at the moment
the row comes back, the creator's participant row does not exist yet.

That is why the policies on `conversations`, `conversation_participants` and
`messages` each carry an explicit "or it is mine" arm. They are not redundant.
`npm run db:test` covers this path.

## Still to do

- **Google / OAuth sign-in.** The button on the login screen says it is not set
  up. It needs a provider configured under **Authentication → Providers**, plus
  a redirect back into the app — the scheme is already `geo-threads` in
  `app.json`. See Supabase's mobile deep-linking guide.
- **Password reset deep link.** `sendPasswordReset` sends the email, but the
  link needs a route to land on and a redirect URL allow-listed under
  **Authentication → URL Configuration**.
- **Moving reads off SQLite.** `src/db/messages-repository.ts` still holds every
  SQL statement in the app, which is what makes this tractable: it is the one
  file a Postgres-backed repository has to replace.
- **Moving the app onto this data.** `src/data/contacts.ts` and
  `src/data/seed-conversations.ts` are still local fixtures with string ids
  (`'ada'`), not the UUIDs the server uses, and the app still reads from SQLite.
