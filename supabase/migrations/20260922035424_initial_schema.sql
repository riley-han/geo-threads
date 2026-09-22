-- Geo Threads: initial schema.
--
-- Mirrors the local SQLite model in src/db/schema.ts, with two deliberate
-- departures. Locally there is exactly one reader, so per-reader state could sit
-- on the shared row: `conversations.unread` and `messages.unlocked_at`. On a
-- shared server those are per-viewer facts, so they move to their own tables
-- (`conversation_participants.last_read_at`, `message_unlocks`). A row everyone
-- can see cannot hold one person's read state.
--
-- Every table is RLS-protected. Policies are per-operation, name their role with
-- TO, and wrap auth.uid() in a subselect so Postgres caches it per statement
-- rather than re-evaluating per row.

-- ---------------------------------------------------------------------------
-- Helper schema: security-definer predicates used inside policies. Kept out of
-- `public` so they are not exposed over the REST API.
-- ---------------------------------------------------------------------------

create schema if not exists private;

-- RLS policy expressions are evaluated as the *calling* role, so `authenticated`
-- must be able to reach the helpers below or every policy using one fails with
-- "permission denied for schema private". This does not expose the schema over
-- the API: PostgREST only serves the schemas in its exposed-schemas setting,
-- which is `public` by default. `anon` is deliberately left out — every policy
-- here is TO authenticated.
grant usage on schema private to authenticated;

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 80),
  -- Stored lowercase and without the leading '@'; the UI adds it. The check
  -- forbids uppercase, so a plain unique index is case-insensitive in effect and
  -- no citext extension is needed.
  handle text not null unique check (handle ~ '^[a-z0-9_]{3,30}$'),
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.profiles is
  'Public-facing identity for an auth user. One row per auth.users row, created by trigger on signup.';

-- ---------------------------------------------------------------------------
-- friendships
--
-- One row per pair, not one per direction. `requester_id` records who asked, so
-- the client derives pending_in vs pending_out by comparing it to its own id.
-- The unique index on (least, greatest) makes the pair unordered, so A→B and
-- B→A cannot both exist.
-- ---------------------------------------------------------------------------

create type public.friendship_status as enum ('pending', 'accepted');

create table public.friendships (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references public.profiles (id) on delete cascade,
  addressee_id uuid not null references public.profiles (id) on delete cascade,
  status public.friendship_status not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint friendships_no_self check (requester_id <> addressee_id)
);

create unique index friendships_pair_key
  on public.friendships (least(requester_id, addressee_id), greatest(requester_id, addressee_id));

create index friendships_requester_idx on public.friendships (requester_id);
create index friendships_addressee_idx on public.friendships (addressee_id);

-- ---------------------------------------------------------------------------
-- conversations + participants
-- ---------------------------------------------------------------------------

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  is_group boolean not null default false,
  title text check (title is null or char_length(trim(title)) between 1 and 120),
  created_by uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);

create index conversations_created_by_idx on public.conversations (created_by);

create table public.conversation_participants (
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  -- Replaces the local `conversations.unread` flag: unread is per-participant,
  -- computed as "exists a message sent after my last_read_at".
  last_read_at timestamptz,
  joined_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);

create index conversation_participants_user_idx on public.conversation_participants (user_id);

-- ---------------------------------------------------------------------------
-- messages
-- ---------------------------------------------------------------------------

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  sender_id uuid not null references public.profiles (id) on delete cascade,
  body text not null check (char_length(body) between 1 and 4000),
  sent_at timestamptz not null default now(),
  -- A geofence is all-or-nothing: either the message is pinned to a place or it
  -- is not. The check stops half-populated fences from ever reaching a client.
  fence_latitude double precision check (fence_latitude between -90 and 90),
  fence_longitude double precision check (fence_longitude between -180 and 180),
  fence_radius_meters double precision check (fence_radius_meters > 0 and fence_radius_meters <= 100000),
  fence_label text,
  constraint messages_fence_complete check (
    (fence_latitude is null and fence_longitude is null and fence_radius_meters is null)
    or (fence_latitude is not null and fence_longitude is not null and fence_radius_meters is not null)
  )
);

-- Stable identity for a place, so messages sharing a fence share one monitored
-- OS region. Set by trigger rather than supplied by the client, so it can never
-- drift from the coordinates. Mirrors fenceKey() in src/data/types.ts.
alter table public.messages add column fence_key text;

create function private.set_fence_key()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.fence_latitude is null then
    new.fence_key := null;
  else
    new.fence_key :=
      to_char(round(new.fence_latitude::numeric, 5), 'FM990.00000') || ':' ||
      to_char(round(new.fence_longitude::numeric, 5), 'FM990.00000') || ':' ||
      to_char(round(new.fence_radius_meters::numeric), 'FM999999990');
  end if;
  return new;
end;
$$;

create trigger messages_set_fence_key
  before insert or update of fence_latitude, fence_longitude, fence_radius_meters
  on public.messages
  for each row execute function private.set_fence_key();

create index messages_conversation_idx on public.messages (conversation_id, sent_at);
create index messages_sender_idx on public.messages (sender_id);
create index messages_fence_key_idx on public.messages (fence_key) where fence_key is not null;

-- ---------------------------------------------------------------------------
-- message_unlocks
--
-- Per-reader, so it cannot live on the message row: two people in a group
-- thread unlock the same fenced message at different times, and a message stays
-- readable for whoever has already been there.
-- ---------------------------------------------------------------------------

create table public.message_unlocks (
  message_id uuid not null references public.messages (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  unlocked_at timestamptz not null default now(),
  primary key (message_id, user_id)
);

create index message_unlocks_user_idx on public.message_unlocks (user_id);

-- ---------------------------------------------------------------------------
-- Security-definer predicates.
--
-- Without these, RLS recurses: the policy on conversation_participants needs to
-- know whether you are a participant, which reads conversation_participants,
-- which runs the policy again. A definer function reads the table as its owner,
-- so the inner policy never fires and the cycle is broken.
--
-- `set search_path = ''` is mandatory here — a definer function that resolves
-- names through the caller's search_path can be hijacked, so every reference
-- below is schema-qualified.
-- ---------------------------------------------------------------------------

create function private.is_conversation_participant(p_conversation_id uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1
    from public.conversation_participants cp
    where cp.conversation_id = p_conversation_id
      and cp.user_id = (select auth.uid())
  );
$$;

create function private.are_friends(p_other_id uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1
    from public.friendships f
    where f.status = 'accepted'
      and (
        (f.requester_id = (select auth.uid()) and f.addressee_id = p_other_id)
        or (f.addressee_id = (select auth.uid()) and f.requester_id = p_other_id)
      )
  );
$$;

create function private.owns_message(p_message_id uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1
    from public.messages m
    join public.conversation_participants cp on cp.conversation_id = m.conversation_id
    where m.id = p_message_id
      and cp.user_id = (select auth.uid())
  );
$$;

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.friendships enable row level security;
alter table public.conversations enable row level security;
alter table public.conversation_participants enable row level security;
alter table public.messages enable row level security;
alter table public.message_unlocks enable row level security;

-- profiles: any signed-in user can look up any profile, because adding a friend
-- means searching for them by handle first. Only name/handle/avatar live here —
-- email and other auth fields stay in auth.users, which is not exposed.
create policy "profiles are readable by signed-in users"
  on public.profiles for select
  to authenticated
  using (true);

create policy "users insert their own profile"
  on public.profiles for insert
  to authenticated
  with check ((select auth.uid()) = id);

create policy "users update their own profile"
  on public.profiles for update
  to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

-- friendships: visible to both sides only.
create policy "users read their own friendships"
  on public.friendships for select
  to authenticated
  using ((select auth.uid()) in (requester_id, addressee_id));

-- Only the requester may open a request, and only as themselves.
create policy "users send friend requests as themselves"
  on public.friendships for insert
  to authenticated
  with check ((select auth.uid()) = requester_id);

-- Only the addressee may accept. The USING clause scopes it to requests sent to
-- you; WITH CHECK stops the row being rewritten to a different pair.
create policy "addressee responds to a friend request"
  on public.friendships for update
  to authenticated
  using ((select auth.uid()) = addressee_id)
  with check ((select auth.uid()) = addressee_id);

-- Either side can withdraw, decline, or unfriend — all of which are a delete.
create policy "either side removes a friendship"
  on public.friendships for delete
  to authenticated
  using ((select auth.uid()) in (requester_id, addressee_id));

-- conversations
-- The creator arm is not redundant. `insert ... returning` (which supabase-js
-- always sends, as `.insert().select()`) applies this SELECT policy to the new
-- row, and at that instant the creator's participant row does not exist yet, so
-- a participant-only check makes creating a conversation impossible.
create policy "participants read their conversations"
  on public.conversations for select
  to authenticated
  using (
    (select auth.uid()) = created_by
    or private.is_conversation_participant(id)
  );

create policy "users create conversations they own"
  on public.conversations for insert
  to authenticated
  with check ((select auth.uid()) = created_by);

create policy "creator updates a conversation"
  on public.conversations for update
  to authenticated
  using ((select auth.uid()) = created_by)
  with check ((select auth.uid()) = created_by);

-- conversation_participants
create policy "participants see who else is in the thread"
  on public.conversation_participants for select
  to authenticated
  using (
    (select auth.uid()) = user_id
    or private.is_conversation_participant(conversation_id)
  );

-- Adding someone requires owning the conversation AND being their friend — the
-- friends-only rule enforced server-side, not just in the compose screen. The
-- creator's own row is exempt, since you are not your own friend.
create policy "creator adds friends to their conversation"
  on public.conversation_participants for insert
  to authenticated
  with check (
    exists (
      select 1 from public.conversations c
      where c.id = conversation_id
        and c.created_by = (select auth.uid())
    )
    and (
      user_id = (select auth.uid())
      or private.are_friends(user_id)
    )
  );

-- Marking a thread read is an update to your own participant row.
create policy "users update their own participation"
  on public.conversation_participants for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "users leave a conversation"
  on public.conversation_participants for delete
  to authenticated
  using ((select auth.uid()) = user_id);

-- messages: readable by participants. Note this is deliberately not gated on
-- the geofence — a fenced message is delivered to the device and revealed by the
-- client once in range, exactly as the local implementation does. Hiding the
-- body until arrival would need an RPC that checks a trusted position; see the
-- note in README-supabase.md.
create policy "participants read conversation messages"
  on public.messages for select
  to authenticated
  using (
    (select auth.uid()) = sender_id
    or private.is_conversation_participant(conversation_id)
  );

create policy "participants send as themselves"
  on public.messages for insert
  to authenticated
  with check (
    (select auth.uid()) = sender_id
    and private.is_conversation_participant(conversation_id)
  );

create policy "senders delete their own messages"
  on public.messages for delete
  to authenticated
  using ((select auth.uid()) = sender_id);

-- message_unlocks: you may only record your own arrival, and only for a message
-- in a thread you are in.
create policy "users read their own unlocks"
  on public.message_unlocks for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "users record their own unlocks"
  on public.message_unlocks for insert
  to authenticated
  with check (
    (select auth.uid()) = user_id
    and private.owns_message(message_id)
  );

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------

-- Keeps updated_at honest without trusting the client to send it.
create function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function private.set_updated_at();

create trigger friendships_set_updated_at
  before update on public.friendships
  for each row execute function private.set_updated_at();

-- A profile row must exist for every auth user, and the client cannot be relied
-- on to create it (signup may complete while the app is backgrounded, and email
-- confirmation can land on another device). The trigger runs as definer because
-- it fires before the new user has a session.
create function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_handle text;
  v_name text;
begin
  v_name := coalesce(
    nullif(trim(new.raw_user_meta_data ->> 'name'), ''),
    split_part(new.email, '@', 1),
    'New user'
  );

  -- Prefer the handle chosen at signup; otherwise derive one from the email and
  -- suffix it until it is free, so signup never fails on a collision.
  v_handle := lower(regexp_replace(
    coalesce(
      nullif(trim(new.raw_user_meta_data ->> 'handle'), ''),
      split_part(new.email, '@', 1),
      'user'
    ),
    '[^a-zA-Z0-9_]', '', 'g'
  ));

  if char_length(v_handle) < 3 then
    v_handle := v_handle || 'user';
  end if;
  v_handle := left(v_handle, 24);

  while exists (select 1 from public.profiles p where p.handle = v_handle) loop
    v_handle := left(v_handle, 20) || to_char(floor(random() * 9000 + 1000), 'FM9999');
  end loop;

  insert into public.profiles (id, name, handle)
  values (new.id, left(v_name, 80), v_handle);

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

-- ---------------------------------------------------------------------------
-- RPC: create a conversation and its participants atomically.
--
-- Doing this from the client takes two or more round trips with no transaction
-- around them, so a failure partway leaves a conversation nobody is in. A
-- function runs in a single transaction, so it either all lands or none does.
--
-- Deliberately SECURITY INVOKER (the default): the inserts below still pass
-- through RLS, so the friends-only rule and the "as yourself" rule are enforced
-- in exactly one place — the policies — rather than duplicated here.
-- ---------------------------------------------------------------------------

create function public.create_conversation(
  p_participant_ids uuid[],
  p_title text default null
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_me uuid := (select auth.uid());
  v_others uuid[];
  v_all uuid[];
  v_conversation_id uuid;
begin
  if v_me is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  -- Normalise: drop duplicates and the caller, so passing yourself in is
  -- harmless and the participant set is canonical.
  select coalesce(array_agg(distinct pid), '{}'::uuid[])
    into v_others
  from unnest(p_participant_ids) as pid
  where pid <> v_me;

  if array_length(v_others, 1) is null then
    raise exception 'a conversation needs at least one other participant'
      using errcode = '22023';
  end if;

  v_all := v_others || v_me;

  -- Reuse an existing thread with exactly this membership, so opening a chat
  -- with the same person twice does not create a second thread. Mirrors the
  -- sameParticipants() check the client does today.
  select c.id into v_conversation_id
  from public.conversations c
  where c.is_group = (array_length(v_others, 1) > 1)
    and (
      select array_agg(cp.user_id order by cp.user_id)
      from public.conversation_participants cp
      where cp.conversation_id = c.id
    ) = (select array_agg(u order by u) from unnest(v_all) as u)
  limit 1;

  if v_conversation_id is not null then
    return v_conversation_id;
  end if;

  insert into public.conversations (is_group, title, created_by)
  values (array_length(v_others, 1) > 1, p_title, v_me)
  returning id into v_conversation_id;

  -- The caller first: the friends-only policy exempts your own row, and the
  -- others' rows are checked against your accepted friendships.
  insert into public.conversation_participants (conversation_id, user_id)
  select v_conversation_id, u from unnest(v_all) as u;

  return v_conversation_id;
end;
$$;

-- PostgREST exposes every function in `public`, so be explicit about who may
-- call it rather than relying on the default grant to PUBLIC.
revoke all on function public.create_conversation(uuid[], text) from public;
grant execute on function public.create_conversation(uuid[], text) to authenticated;

-- ---------------------------------------------------------------------------
-- Realtime
--
-- Subscriptions respect RLS, so a client only receives rows its SELECT policy
-- already allows. Added now so the message list can move to live updates
-- without another migration.
-- ---------------------------------------------------------------------------

alter publication supabase_realtime add table public.messages;
alter publication supabase_realtime add table public.conversation_participants;
alter publication supabase_realtime add table public.friendships;
