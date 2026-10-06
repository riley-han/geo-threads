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
| `npm run db:test:push`       | Checks the live push pipeline with seed accounts     |
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

### Unlock receipts

`message_unlocks` is per-reader, but since Found It it is not private to the
reader: the **sender** of a message may read its unlock rows, as long as the
finder has `profiles.share_unlock_receipts` on (the default). Other people in a
group thread still see nothing. The check is the definer predicate
`private.can_read_unlock_receipt`, so turning the setting off hides your rows in
RLS, not just in the UI.

Two consequences for the client:

- The `unlocks` embed on a message can now hold other people's rows, so the
  mapper picks the viewer's own unlock by `user_id` rather than taking `[0]`.
- `unlocked_at` is set by trigger to the server clock, truncated to the minute.
  A receipt says which message was found, never a precise moment.

### Trails

A trail's stops are ordinary fenced messages with `trail_id` and `trail_step`
set. A stop the viewer has not earned is not blanked; **the row is hidden**
by the messages SELECT policy (`private.can_see_trail_step`). Stop 1 is always
visible. In pin mode, stop N+1 appears once you have unlocked stop N. In clue
mode it stays hidden until you unlock it yourself.

Hiding the whole row means everything that reads messages inherits the rule
without its own check: the thread, the inbox embed, the pending-fenced list
the OS geofences are built from, and Realtime. The `trails` row (title, mode,
`step_count`) is readable by everyone in the thread, which is what lets
progress read "Stop 2 of 5".

Clue-mode stops can only be unlocked through `check_in_trail_step`, because
the device never has their coordinates. It compares the reported position
server-side and allows 30 attempts per person per trail per hour, so it
can't be scripted to sweep for the pin. The unlock INSERT policy also requires
the message to be visible, so stops can't be unlocked out of order.

Trails are created with the `create_trail` RPC: the trail and all its stops in
one transaction, through RLS (`SECURITY INVOKER`).

## Push

Remote push has three parts: devices register an Expo push token in
`push_tokens` (through the `register_push_token` RPC), two Database Webhooks
fire on inserts, and the `push` Edge Function (`supabase/functions/push`)
sends through the Expo Push API.

### 1. Deploy the function and its secret

```bash
npx supabase functions deploy push
npx supabase secrets set PUSH_WEBHOOK_SECRET=<a long random string>
```

`openssl rand -hex 32` makes a good secret. The function is deployed with
`verify_jwt = false` (see `config.toml`) because webhooks carry no user JWT; it
checks the `x-webhook-secret` header against this secret instead and returns
401 otherwise.

Optional: if you turn on **Enhanced push security** for the project on
expo.dev, also set `EXPO_ACCESS_TOKEN`.

### 2. Create the two webhooks

In the dashboard, under **Database → Webhooks**, create:

| Name | Table | Events |
| --- | --- | --- |
| `push-on-message` | `public.messages` | Insert |
| `push-on-unlock` | `public.message_unlocks` | Insert |
| `push-on-reaction` | `public.message_reactions` | Insert |

For each, choose **Supabase Edge Functions**, select `push` and method `POST`,
then add an HTTP header `x-webhook-secret` with the same value as above.

Set the schema to **`public`** before picking the table. Supabase Realtime has
its own `realtime.messages` table, and a webhook attached to it never fires for
your messages. To check which table each webhook is on:

```bash
npx supabase db query --linked "select t.tgname, n.nspname || '.' || c.relname as tbl from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace where not t.tgisinternal and not c.relispartition and t.tgfoid = 'supabase_functions.http_request'::regproc"
```

If saving a webhook fails with `schema "supabase_functions" does not exist`,
enable webhooks first under **Integrations → Database Webhooks**.

These are not in a migration on purpose: they need the project URL and the
secret, and neither belongs in version control.

### What gets sent

| Event | Who | Copy |
| --- | --- | --- |
| New open message | every other participant | sender, then a 140-character preview |
| New fenced message | every other participant | "Left you a message at {place}". The body is **never** included. |
| Unlock | the message's sender, if the finder shares receipts | "{name} found your message at {place}" |
| New trail | every other participant, for stop 1 only | "Left you a trail: {title}. Start at {place}". Later stops never push, so their places stay secret. |
| Trail stop found | the creator, if the finder shares receipts | "{name} found stop 2 of 5 on {title}", or "Trail finished" for the last stop |
| Reaction | the message's author, unless they reacted themselves | "Reacted ❤️ to "…"", or "Reacted ❤️ to your message at {place}" for a fenced message |

Reaction pushes are collapsed: the first reaction to an author pushes, and any
more within five minutes stay silent. They still appear live in the app. The
`claim_push_slot` RPC and `push_log` table do this; both are server-only.

Message pushes go only to recipients and unlock pushes only to senders, so
neither duplicates the finder's local arrival alert. Tokens that Expo reports as
`DeviceNotRegistered` are deleted.

Check the delivery logs under **Edge Functions → push → Logs** in the dashboard.

`npm run db:test:push` checks every row of this table against the linked
project without a phone. It gives the seed accounts fake Expo tokens: a pruned
token means a push was attempted, and a surviving one means none was. It
removes everything it writes.

### 3. EAS (the app side)

The app cannot get a push token until it belongs to an EAS project.
`registerPushToken` in `src/lib/push.ts` quietly does nothing until then.

1. `npm install --global eas-cli`. If `eas init` errored with "command not
   found", this was the cause.
2. `eas login`, then `eas init`. This writes `extra.eas.projectId` and `owner`
   into `app.json`. Commit that change.
3. Change `ios.bundleIdentifier` and `android.package` away from
   `com.anonymous.geothreads` to an identifier you own. APNs and FCM
   credentials are tied to it.
4. Run `eas build:configure` to create `eas.json`.
5. **iOS:** run `eas credentials`, choose iOS, and set up a **Push Notifications
   key**. This needs a paid Apple Developer account.
6. **Android:** create a Firebase project, download `google-services.json`, set
   `android.googleServicesFile` in `app.json`, and upload the FCM V1
   service-account key with `eas credentials`.
7. Build a dev client with `eas build --profile development`, or run
   `npx expo run:ios --device`. Push needs a development build. On Android it
   does not work in Expo Go. On iOS it works on simulators only with Xcode 14+,
   and a real device is the reliable test.

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
