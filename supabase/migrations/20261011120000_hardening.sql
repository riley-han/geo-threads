-- Hardening: close the write paths RLS left open, verify unlocks on the
-- server, and stop delivering a locked message's text before it is earned.
--
-- See docs/plans/2026-10-hardening.md. Every change narrows what a signed-in
-- caller can do; nothing here widens access.
--
--   1. Column-level UPDATE grants. A policy's WITH CHECK only sees the new row,
--      so it cannot stop a caller rewriting a column it does not name: the
--      addressee could rewrite requester_id, a participant could move their row
--      to another conversation_id. Granting UPDATE on just the columns a client
--      legitimately changes closes that whole class at once.
--   2. Friend requests start pending. The insert policy checked who sent the
--      request but not its status, so a request could be born accepted.
--   3. Messages and unlocks are written only through functions. A direct insert
--      could set sent_at, trail columns and time windows; a direct unlock needed
--      no position at all.
--   4. message_sealed. A fenced message's body (and a trail stop's clue) lives
--      in a table readable only by the sender and by whoever has unlocked it, so
--      the device holds the coordinates it needs to measure distance and
--      nothing else.
--   5. Profiles are visible to people you have a reason to see; finding a
--      stranger goes through search_profiles, which returns a page, not the
--      table.
--   6. New tables start with no grants.
--
-- What this cannot do: verify that a reported position is real. A spoofed GPS
-- fix still unlocks. The server now refuses an unlock with no position, or the
-- wrong one, and rate-limits attempts, which ends casual and scripted cheating.

-- ---------------------------------------------------------------------------
-- 1. Column-level update grants
-- ---------------------------------------------------------------------------

revoke update on public.friendships from authenticated;
grant update (status) on public.friendships to authenticated;

revoke update on public.conversation_participants from authenticated;
grant update (last_read_at) on public.conversation_participants to authenticated;

revoke update on public.conversations from authenticated;
grant update (title) on public.conversations to authenticated;

revoke update on public.profiles from authenticated;
grant update (name, handle, avatar_url, share_unlock_receipts) on public.profiles to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Friend requests start pending
-- ---------------------------------------------------------------------------

drop policy "users send friend requests as themselves" on public.friendships;

create policy "users send friend requests as themselves"
  on public.friendships for insert
  to authenticated
  with check (
    (select auth.uid()) = requester_id
    and status = 'pending'
  );

-- ---------------------------------------------------------------------------
-- Marking a thread read on the server clock.
--
-- last_read_at is compared with sent_at, which is the server's clock. Writing
-- the device's clock let a phone running slow bring a thread back to unread.
-- Invoker: the update passes through the participant policy and column grant.
-- ---------------------------------------------------------------------------

create function public.mark_conversation_read(p_conversation_id uuid)
returns timestamptz
language plpgsql
set search_path = ''
as $$
declare
  v_now timestamptz := now();
begin
  update public.conversation_participants
     set last_read_at = v_now
   where conversation_id = p_conversation_id
     and user_id = (select auth.uid());
  return v_now;
end;
$$;

revoke all on function public.mark_conversation_read(uuid) from public, anon;
grant execute on function public.mark_conversation_read(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. message_sealed
-- ---------------------------------------------------------------------------

create table public.message_sealed (
  message_id uuid primary key references public.messages (id) on delete cascade,
  body text not null check (char_length(body) between 1 and 4000),
  -- Written on stop N: the way to stop N+1. Sealed with the body, so it is read
  -- once stop N is found.
  next_clue text check (next_clue is null or char_length(trim(next_clue)) between 1 and 280)
);

comment on table public.message_sealed is
  'The text of fenced messages. Readable by the sender and by readers who have unlocked the message.';

create function private.can_read_sealed(p_message_id uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1
    from public.messages m
    where m.id = p_message_id
      and (
        m.sender_id = (select auth.uid())
        or exists (
          select 1 from public.message_unlocks u
          where u.message_id = m.id and u.user_id = (select auth.uid())
        )
      )
  );
$$;

alter table public.message_sealed enable row level security;

create policy "senders and finders read sealed text"
  on public.message_sealed for select
  to authenticated
  using (private.can_read_sealed(message_id));

-- Written only by send_message and create_trail.
grant select on public.message_sealed to authenticated;
grant all on public.message_sealed to service_role;

-- Move what is already there, then take it off the shared row.
alter table public.messages alter column body drop not null;

insert into public.message_sealed (message_id, body, next_clue)
select m.id, m.body, m.next_clue
from public.messages m
where m.fence_latitude is not null;

update public.messages set body = null where fence_latitude is not null;

alter table public.messages drop column next_clue;

alter table public.messages
  add constraint messages_body_sealed
    check ((fence_latitude is null) = (body is not null));

-- ---------------------------------------------------------------------------
-- 3a. send_message: the only way to post an ordinary or fenced message.
--
-- Definer, because clients no longer hold INSERT on messages. It checks what
-- the old insert policy did — you send as yourself, into a thread you are in —
-- and the server picks sent_at. The id is the client's, so the optimistic row,
-- this insert and the realtime echo share one identity, and a retry of a send
-- that did land is a no-op rather than a duplicate.
-- ---------------------------------------------------------------------------

revoke insert on public.messages from authenticated;

create function public.send_message(
  p_id uuid,
  p_conversation_id uuid,
  p_body text,
  p_fence_latitude double precision default null,
  p_fence_longitude double precision default null,
  p_fence_radius_meters double precision default null,
  p_fence_label text default null
)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := (select auth.uid());
  v_fenced boolean := p_fence_latitude is not null;
  v_sent_at timestamptz;
begin
  if v_me is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if not private.is_conversation_participant(p_conversation_id) then
    raise exception 'not a participant' using errcode = '42501';
  end if;

  select m.sent_at into v_sent_at
  from public.messages m
  where m.id = p_id and m.sender_id = v_me and m.conversation_id = p_conversation_id;
  if found then
    return v_sent_at;
  end if;

  insert into public.messages (
    id, conversation_id, sender_id, body,
    fence_latitude, fence_longitude, fence_radius_meters, fence_label
  ) values (
    p_id, p_conversation_id, v_me,
    case when v_fenced then null else p_body end,
    p_fence_latitude, p_fence_longitude, p_fence_radius_meters,
    nullif(trim(p_fence_label), '')
  )
  returning sent_at into v_sent_at;

  if v_fenced then
    insert into public.message_sealed (message_id, body) values (p_id, p_body);
  end if;

  return v_sent_at;
end;
$$;

revoke all on function public.send_message(uuid, uuid, text, double precision, double precision, double precision, text)
  from public, anon;
grant execute on function public.send_message(uuid, uuid, text, double precision, double precision, double precision, text)
  to authenticated;

-- ---------------------------------------------------------------------------
-- 3b. create_trail: definer now, since it can no longer lean on the insert
-- grant. It checks participation itself, and is the only way to create a trail
-- row — a bare trails insert made a trail with no stops.
-- ---------------------------------------------------------------------------

revoke insert on public.trails from authenticated;
drop policy "participants create trails as themselves" on public.trails;

drop function public.create_trail(uuid, text, public.trail_reveal_mode, jsonb, integer);

-- p_stops: [{ body, latitude, longitude, radius_meters, label, next_clue?,
--             opens_at?, closes_at? }] in order. Times are ISO 8601.
create function public.create_trail(
  p_conversation_id uuid,
  p_title text,
  p_reveal_mode public.trail_reveal_mode,
  p_stops jsonb,
  p_hint_after_minutes integer default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := (select auth.uid());
  v_count integer;
  v_trail_id uuid;
  v_stop jsonb;
  v_step integer := 0;
  v_now timestamptz := now();
  v_message_id uuid;
begin
  if v_me is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if not private.is_conversation_participant(p_conversation_id) then
    raise exception 'not a participant' using errcode = '42501';
  end if;

  if jsonb_typeof(p_stops) is distinct from 'array' then
    raise exception 'stops must be an array' using errcode = '22023';
  end if;
  v_count := jsonb_array_length(p_stops);
  if v_count < 2 or v_count > 10 then
    raise exception 'a trail needs 2 to 10 stops' using errcode = '22023';
  end if;

  insert into public.trails (
    conversation_id, created_by, title, reveal_mode, step_count, hint_after_minutes
  ) values (
    p_conversation_id, v_me, trim(p_title), p_reveal_mode, v_count,
    -- Hints only mean something in clue mode.
    case when p_reveal_mode = 'clue' then p_hint_after_minutes end
  )
  returning id into v_trail_id;

  for v_stop in select value from jsonb_array_elements(p_stops) loop
    v_step := v_step + 1;

    if v_step < v_count
       and p_reveal_mode = 'clue'
       and nullif(trim(v_stop ->> 'next_clue'), '') is null then
      raise exception 'stop % needs a clue to the next stop', v_step using errcode = '22023';
    end if;

    insert into public.messages (
      conversation_id, sender_id, body, sent_at,
      fence_latitude, fence_longitude, fence_radius_meters, fence_label,
      trail_id, trail_step, opens_at, closes_at
    ) values (
      p_conversation_id,
      v_me,
      null,
      -- One millisecond apart, so the stops sort in order in the thread.
      v_now + make_interval(secs => (v_step - 1) * 0.001),
      (v_stop ->> 'latitude')::double precision,
      (v_stop ->> 'longitude')::double precision,
      (v_stop ->> 'radius_meters')::double precision,
      nullif(trim(v_stop ->> 'label'), ''),
      v_trail_id,
      v_step,
      nullif(v_stop ->> 'opens_at', '')::timestamptz,
      nullif(v_stop ->> 'closes_at', '')::timestamptz
    )
    returning id into v_message_id;

    insert into public.message_sealed (message_id, body, next_clue)
    values (
      v_message_id,
      v_stop ->> 'body',
      case when v_step < v_count then nullif(trim(v_stop ->> 'next_clue'), '') end
    );
  end loop;

  return v_trail_id;
end;
$$;

revoke all on function public.create_trail(uuid, text, public.trail_reveal_mode, jsonb, integer)
  from public, anon;
grant execute on function public.create_trail(uuid, text, public.trail_reveal_mode, jsonb, integer)
  to authenticated;

-- ---------------------------------------------------------------------------
-- 3c. unlock_message: unlock by being there, checked on the server.
--
-- Replaces the direct insert into message_unlocks. The visibility and window
-- rules are the ones the old insert policy applied; the distance check is new
-- for pin-mode and ordinary fenced messages (clue-mode stops already had it,
-- through check_in_trail_step).
--
-- The device's reported accuracy buys up to 25 m of slack, so a fix the app
-- shows as inside is not refused for being a few metres out.
--
-- Attempts are logged and capped at 60 an hour per person, across messages.
-- trail_check_ins keeps its own, tighter, per-trail limit.
-- ---------------------------------------------------------------------------

drop policy "users record their own unlocks" on public.message_unlocks;
revoke insert on public.message_unlocks from authenticated;

create table public.unlock_attempts (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  message_id uuid not null references public.messages (id) on delete cascade,
  created_at timestamptz not null default now()
);

create index unlock_attempts_user_idx on public.unlock_attempts (user_id, created_at desc);
create index unlock_attempts_message_idx on public.unlock_attempts (message_id);

-- Server-only, like trail_check_ins.
alter table public.unlock_attempts enable row level security;
revoke all on public.unlock_attempts from anon, authenticated;
grant all on public.unlock_attempts to service_role;

-- Haversine, matching distanceMeters() in src/lib/geo.ts and check_in_trail_step.
create function private.distance_meters(
  p_lat1 double precision, p_lng1 double precision,
  p_lat2 double precision, p_lng2 double precision
)
returns double precision
language sql
immutable
set search_path = ''
as $$
  select 2 * 6371000 * asin(sqrt(
    power(sin(radians(p_lat2 - p_lat1) / 2), 2)
    + cos(radians(p_lat1)) * cos(radians(p_lat2))
      * power(sin(radians(p_lng2 - p_lng1) / 2), 2)
  ));
$$;

-- Returns { status, body, next_clue }. status is one of
--   unlocked | not_here | not_open | closed | too_many
-- body and next_clue are set only when status is unlocked.
create function public.unlock_message(
  p_message_id uuid,
  p_latitude double precision,
  p_longitude double precision,
  p_accuracy double precision default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := (select auth.uid());
  v_message public.messages%rowtype;
  v_sealed public.message_sealed%rowtype;
  v_slack double precision := least(greatest(coalesce(p_accuracy, 0), 0), 25);
begin
  if v_me is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p_latitude is null or p_longitude is null then
    raise exception 'a position is required' using errcode = '22023';
  end if;

  select m.* into v_message from public.messages m where m.id = p_message_id;

  -- One answer for "no such message" and "not yours to see", so the RPC does
  -- not confirm which ids exist.
  if not found
     or v_message.fence_latitude is null
     or not private.can_see_message(p_message_id) then
    raise exception 'no such message' using errcode = '42501';
  end if;

  if v_message.sender_id <> v_me and not exists (
    select 1 from public.message_unlocks u
    where u.message_id = p_message_id and u.user_id = v_me
  ) then
    if (
      select count(*) from public.unlock_attempts a
      where a.user_id = v_me and a.created_at > now() - interval '1 hour'
    ) >= 60 then
      return jsonb_build_object('status', 'too_many');
    end if;

    insert into public.unlock_attempts (user_id, message_id) values (v_me, p_message_id);

    if private.distance_meters(
         v_message.fence_latitude, v_message.fence_longitude, p_latitude, p_longitude
       ) > v_message.fence_radius_meters + v_slack then
      return jsonb_build_object('status', 'not_here');
    end if;

    -- Distance first, so the time is only revealed to someone standing there.
    if v_message.opens_at is not null and v_message.opens_at > now() then
      return jsonb_build_object('status', 'not_open');
    end if;
    if v_message.closes_at is not null and v_message.closes_at <= now() then
      return jsonb_build_object('status', 'closed');
    end if;

    insert into public.message_unlocks (message_id, user_id)
    values (p_message_id, v_me)
    on conflict (message_id, user_id) do nothing;
  end if;

  select s.* into v_sealed from public.message_sealed s where s.message_id = p_message_id;

  return jsonb_build_object(
    'status', 'unlocked',
    'body', v_sealed.body,
    'next_clue', v_sealed.next_clue
  );
end;
$$;

revoke all on function public.unlock_message(uuid, double precision, double precision, double precision)
  from public, anon;
grant execute on function public.unlock_message(uuid, double precision, double precision, double precision)
  to authenticated;

-- check_in_trail_step: same rules, now through the shared distance helper.
create or replace function public.check_in_trail_step(
  p_trail_id uuid,
  p_step integer,
  p_latitude double precision,
  p_longitude double precision
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := (select auth.uid());
  v_stop public.messages%rowtype;
begin
  if v_me is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  select m.* into v_stop
  from public.messages m
  where m.trail_id = p_trail_id and m.trail_step = p_step;

  if not found or not private.is_conversation_participant(v_stop.conversation_id) then
    raise exception 'no such stop' using errcode = '42501';
  end if;

  if p_step > 1 and not exists (
    select 1
    from public.messages prev
    join public.message_unlocks u on u.message_id = prev.id and u.user_id = v_me
    where prev.trail_id = p_trail_id and prev.trail_step = p_step - 1
  ) then
    raise exception 'find the previous stop first' using errcode = '42501';
  end if;

  if exists (
    select 1 from public.message_unlocks u
    where u.message_id = v_stop.id and u.user_id = v_me
  ) then
    return 'unlocked';
  end if;

  if (
    select count(*) from public.trail_check_ins c
    where c.user_id = v_me
      and c.trail_id = p_trail_id
      and c.created_at > now() - interval '1 hour'
  ) >= 30 then
    return 'too_many';
  end if;

  insert into public.trail_check_ins (trail_id, user_id) values (p_trail_id, v_me);

  if private.distance_meters(v_stop.fence_latitude, v_stop.fence_longitude, p_latitude, p_longitude)
     > v_stop.fence_radius_meters then
    return 'not_here';
  end if;

  if v_stop.opens_at is not null and v_stop.opens_at > now() then
    return 'not_open';
  end if;
  if v_stop.closes_at is not null and v_stop.closes_at <= now() then
    return 'closed';
  end if;

  insert into public.message_unlocks (message_id, user_id)
  values (v_stop.id, v_me)
  on conflict (message_id, user_id) do nothing;

  return 'unlocked';
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Profiles
--
-- Visible: yourself, anyone you have a friendship row with (either side, any
-- status, so an incoming request shows who sent it), and anyone you share a
-- thread with (so senders, finders and participants resolve).
-- ---------------------------------------------------------------------------

create function private.can_see_profile(p_profile_id uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select
    p_profile_id = (select auth.uid())
    or exists (
      select 1 from public.friendships f
      where (f.requester_id = (select auth.uid()) and f.addressee_id = p_profile_id)
         or (f.addressee_id = (select auth.uid()) and f.requester_id = p_profile_id)
    )
    or exists (
      select 1
      from public.conversation_participants mine
      join public.conversation_participants theirs
        on theirs.conversation_id = mine.conversation_id
      where mine.user_id = (select auth.uid())
        and theirs.user_id = p_profile_id
    );
$$;

drop policy "profiles are readable by signed-in users" on public.profiles;

create policy "profiles are readable by people with a reason to see them"
  on public.profiles for select
  to authenticated
  using (private.can_see_profile(id));

-- Finding someone new. Matches name or handle, at least two characters, one
-- page at a time; the caller is left out. Only the public card is returned.
create function public.search_profiles(p_query text)
returns table (id uuid, name text, handle text, avatar_url text)
language sql
security definer
stable
set search_path = ''
as $$
  with q as (
    select replace(replace(replace(lower(trim(coalesce(p_query, ''))), '\', '\\'), '%', '\%'), '_', '\_') as term
  )
  select p.id, p.name, p.handle, p.avatar_url
  from public.profiles p, q
  where (select auth.uid()) is not null
    and char_length(q.term) >= 2
    and p.id <> (select auth.uid())
    and (lower(p.name) like '%' || q.term || '%' or p.handle like '%' || q.term || '%')
  order by (p.handle = q.term) desc, p.name
  limit 20;
$$;

revoke all on function public.search_profiles(text) from public, anon;
grant execute on function public.search_profiles(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. New tables start with no grants. Each migration grants what it needs, as
-- every table since 20260930120000 already does.
-- ---------------------------------------------------------------------------

alter default privileges in schema public
  revoke select, insert, update, delete on tables from authenticated;
