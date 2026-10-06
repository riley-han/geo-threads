-- Trails, continued: time windows, hints, and finishing order.
--
-- See docs/plans/2026-10-phase-5-trails-plus.md. Builds on
-- 20261004180000_trails.sql, whose visibility rule (hide the row, not the
-- columns) still applies: every change here either widens or narrows who can
-- see or unlock a stop, in the same predicates.

-- ---------------------------------------------------------------------------
-- Time windows
--
-- Absolute moments rather than a time of day, so there is no time zone to
-- store or get wrong. Before opens_at a stop can be seen (once earned) but not
-- unlocked; after closes_at it can no longer be unlocked.
-- ---------------------------------------------------------------------------

alter table public.messages
  add column opens_at timestamptz,
  add column closes_at timestamptz,
  add constraint messages_window_trail_only
    check ((opens_at is null and closes_at is null) or trail_id is not null),
  add constraint messages_window_order
    check (opens_at is null or closes_at is null or closes_at > opens_at);

-- Server clock, never the device's: a skewed phone cannot open a stop early.
create function private.is_open_now(p_message_id uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select coalesce((
    select (m.opens_at is null or m.opens_at <= now())
       and (m.closes_at is null or m.closes_at > now())
    from public.messages m
    where m.id = p_message_id
  ), false);
$$;

drop policy "users record their own unlocks" on public.message_unlocks;

create policy "users record their own unlocks"
  on public.message_unlocks for insert
  to authenticated
  with check (
    (select auth.uid()) = user_id
    and private.can_see_message(message_id)
    and private.is_open_now(message_id)
  );

-- ---------------------------------------------------------------------------
-- Hints
--
-- Clue mode only. Once a finder has been stuck on a stop for the creator's
-- chosen delay (counted from when they found the previous stop), they may
-- reveal its pin. A used hint is a row, and the visibility rule admits the
-- stop for that finder, so from then on it behaves like a pin-mode stop.
-- ---------------------------------------------------------------------------

alter table public.trails
  add column hint_after_minutes integer
    check (hint_after_minutes is null or hint_after_minutes between 1 and 10080);

comment on column public.trails.hint_after_minutes is
  'Minutes stuck on a clue-mode stop before its pin can be revealed. Null: no hints.';

create table public.trail_hints (
  trail_id uuid not null references public.trails (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  step integer not null check (step between 2 and 10),
  used_at timestamptz not null default now(),
  primary key (trail_id, user_id, step)
);

create index trail_hints_user_idx on public.trail_hints (user_id);

create function private.created_trail(p_trail_id uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.trails t
    where t.id = p_trail_id and t.created_by = (select auth.uid())
  );
$$;

alter table public.trail_hints enable row level security;

-- Your own hints, and (as creator) everyone's on your trail.
create policy "finders and creators read hints"
  on public.trail_hints for select
  to authenticated
  using (
    (select auth.uid()) = user_id
    or private.created_trail(trail_id)
  );

-- Written only by use_trail_hint, which checks the delay.
grant select on public.trail_hints to authenticated;
grant all on public.trail_hints to service_role;

create or replace function private.can_see_trail_step(p_trail_id uuid, p_step integer)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select
    p_step = 1
    -- Pin mode: the previous stop is unlocked, so this one is on the map.
    or exists (
      select 1
      from public.trails t
      join public.messages prev on prev.trail_id = t.id and prev.trail_step = p_step - 1
      join public.message_unlocks u on u.message_id = prev.id and u.user_id = (select auth.uid())
      where t.id = p_trail_id and t.reveal_mode = 'pin'
    )
    -- Either mode: you have already unlocked this stop.
    or exists (
      select 1
      from public.messages m
      join public.message_unlocks u on u.message_id = m.id and u.user_id = (select auth.uid())
      where m.trail_id = p_trail_id and m.trail_step = p_step
    )
    -- Clue mode: you used a hint for this stop.
    or exists (
      select 1 from public.trail_hints h
      where h.trail_id = p_trail_id and h.step = p_step and h.user_id = (select auth.uid())
    );
$$;

create function public.use_trail_hint(p_trail_id uuid, p_step integer)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := (select auth.uid());
  v_trail public.trails%rowtype;
  v_previous_found timestamptz;
begin
  if v_me is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  select t.* into v_trail from public.trails t where t.id = p_trail_id;
  if not found or not private.is_conversation_participant(v_trail.conversation_id) then
    raise exception 'no such trail' using errcode = '42501';
  end if;

  if v_trail.reveal_mode <> 'clue' or v_trail.hint_after_minutes is null then
    return 'disabled';
  end if;
  if p_step < 2 or p_step > v_trail.step_count then
    return 'not_needed';
  end if;

  if exists (
    select 1 from public.messages m
    join public.message_unlocks u on u.message_id = m.id and u.user_id = v_me
    where m.trail_id = p_trail_id and m.trail_step = p_step
  ) then
    return 'not_needed';
  end if;

  select u.unlocked_at into v_previous_found
  from public.messages prev
  join public.message_unlocks u on u.message_id = prev.id and u.user_id = v_me
  where prev.trail_id = p_trail_id and prev.trail_step = p_step - 1;

  if v_previous_found is null then
    raise exception 'find the previous stop first' using errcode = '42501';
  end if;

  if v_previous_found + make_interval(mins => v_trail.hint_after_minutes) > now() then
    return 'too_soon';
  end if;

  insert into public.trail_hints (trail_id, user_id, step)
  values (p_trail_id, v_me, p_step)
  on conflict do nothing;

  return 'revealed';
end;
$$;

revoke all on function public.use_trail_hint(uuid, integer) from public, anon;
grant execute on function public.use_trail_hint(uuid, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- check_in_trail_step: unchanged, except that the right place at the wrong
-- time now says so (not_open / closed) instead of unlocking.
-- ---------------------------------------------------------------------------

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
  v_distance double precision;
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

  -- Haversine, matching distanceMeters() in src/lib/geo.ts.
  v_distance := 2 * 6371000 * asin(sqrt(
    power(sin(radians(p_latitude - v_stop.fence_latitude) / 2), 2)
    + cos(radians(v_stop.fence_latitude)) * cos(radians(p_latitude))
      * power(sin(radians(p_longitude - v_stop.fence_longitude) / 2), 2)
  ));

  if v_distance > v_stop.fence_radius_meters then
    return 'not_here';
  end if;

  -- Distance first, so the time is only revealed to someone standing there.
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
-- trail_finishers: who finished, in order.
--
-- Definer, because finders cannot read each other's unlocks. Visible to anyone
-- in the thread. Finishers who turned receipts off are left out of everyone's
-- view but their own, and ranks are counted among the people shown, so an
-- opted-out finisher leaves no gap that would give them away.
-- ---------------------------------------------------------------------------

create function public.trail_finishers(p_trail_id uuid)
returns table (user_id uuid, finished_at timestamptz, place bigint)
language sql
security definer
stable
set search_path = ''
as $$
  select u.user_id, u.unlocked_at, rank() over (order by u.unlocked_at)
  from public.trails t
  join public.messages last_stop
    on last_stop.trail_id = t.id and last_stop.trail_step = t.step_count
  join public.message_unlocks u on u.message_id = last_stop.id
  join public.profiles p on p.id = u.user_id
  where t.id = p_trail_id
    and (t.created_by = (select auth.uid()) or private.is_conversation_participant(t.conversation_id))
    and (p.share_unlock_receipts or u.user_id = (select auth.uid()))
  order by u.unlocked_at, u.user_id;
$$;

revoke all on function public.trail_finishers(uuid) from public, anon;
grant execute on function public.trail_finishers(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- create_trail: now with a hint delay and per-stop windows.
--
-- The old signature is dropped rather than overloaded: PostgREST picks a
-- function by its argument names, and two candidates would make every call
-- ambiguous.
-- ---------------------------------------------------------------------------

drop function public.create_trail(uuid, text, public.trail_reveal_mode, jsonb);

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
set search_path = ''
as $$
declare
  v_me uuid := (select auth.uid());
  v_count integer;
  v_trail_id uuid;
  v_stop jsonb;
  v_step integer := 0;
  v_now timestamptz := now();
begin
  if v_me is null then
    raise exception 'not authenticated' using errcode = '42501';
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
      trail_id, trail_step, next_clue, opens_at, closes_at
    ) values (
      p_conversation_id,
      v_me,
      v_stop ->> 'body',
      v_now + make_interval(secs => (v_step - 1) * 0.001),
      (v_stop ->> 'latitude')::double precision,
      (v_stop ->> 'longitude')::double precision,
      (v_stop ->> 'radius_meters')::double precision,
      nullif(trim(v_stop ->> 'label'), ''),
      v_trail_id,
      v_step,
      case when v_step < v_count then nullif(trim(v_stop ->> 'next_clue'), '') end,
      nullif(v_stop ->> 'opens_at', '')::timestamptz,
      nullif(v_stop ->> 'closes_at', '')::timestamptz
    );
  end loop;

  return v_trail_id;
end;
$$;

revoke all on function public.create_trail(uuid, text, public.trail_reveal_mode, jsonb, integer)
  from public, anon;
grant execute on function public.create_trail(uuid, text, public.trail_reveal_mode, jsonb, integer)
  to authenticated;
