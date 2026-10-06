-- Trails: an ordered chain of fenced stops where unlocking one reveals the next.
--
-- See docs/prd/2026-09-found-it-and-trails.md §4 and
-- docs/plans/2026-10-phase-4-trails.md.
--
-- The PRD suggests blanking the body and coordinates of unearned steps through
-- a view or RPC. This hides the whole row instead, in the messages SELECT
-- policy. Every reader already goes through that policy — the thread, the
-- inbox embed, the pending-fenced list the geofences are built from, and
-- Realtime — so a stop you have not earned never reaches the device, and is
-- never registered as an OS geofence.

-- ---------------------------------------------------------------------------
-- trails
-- ---------------------------------------------------------------------------

create type public.trail_reveal_mode as enum ('pin', 'clue');

create table public.trails (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  created_by uuid not null references public.profiles (id) on delete cascade,
  title text not null check (char_length(trim(title)) between 1 and 80),
  -- pin: unlocking stop N puts stop N+1 on the map.
  -- clue: stop N+1 stays hidden; stop N's next_clue says where, and the finder
  --       checks in with check_in_trail_step. Stop 1 always shows its pin.
  reveal_mode public.trail_reveal_mode not null default 'pin',
  -- Readable by every participant, so progress can say "Stop 2 of 5" without
  -- revealing the stops themselves.
  step_count integer not null check (step_count between 2 and 10),
  created_at timestamptz not null default now()
);

create index trails_conversation_idx on public.trails (conversation_id);
create index trails_created_by_idx on public.trails (created_by);

alter table public.messages
  add column trail_id uuid references public.trails (id) on delete cascade,
  add column trail_step integer,
  -- Written on stop N, read once stop N is visible: the way to stop N+1.
  add column next_clue text check (next_clue is null or char_length(trim(next_clue)) between 1 and 280),
  add constraint messages_trail_complete check ((trail_id is null) = (trail_step is null)),
  add constraint messages_trail_step_range check (trail_step is null or trail_step between 1 and 10),
  add constraint messages_trail_fenced check (trail_id is null or fence_latitude is not null);

create unique index messages_trail_step_key
  on public.messages (trail_id, trail_step)
  where trail_id is not null;

-- ---------------------------------------------------------------------------
-- Visibility
-- ---------------------------------------------------------------------------

-- Whether the caller may see stop p_step of a trail. Not called for the trail's
-- creator: the sender arm of the messages policy admits them first.
create function private.can_see_trail_step(p_trail_id uuid, p_step integer)
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
    -- Either mode: you have already unlocked this stop (in clue mode, by
    -- checking in), so it is yours to read.
    or exists (
      select 1
      from public.messages m
      join public.message_unlocks u on u.message_id = m.id and u.user_id = (select auth.uid())
      where m.trail_id = p_trail_id and m.trail_step = p_step
    );
$$;

-- The full rule for one message, for policies that only have its id.
create function private.can_see_message(p_message_id uuid)
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
        or (
          private.is_conversation_participant(m.conversation_id)
          and (m.trail_id is null or private.can_see_trail_step(m.trail_id, m.trail_step))
        )
      )
  );
$$;

drop policy "participants read conversation messages" on public.messages;

create policy "participants read conversation messages"
  on public.messages for select
  to authenticated
  using (
    (select auth.uid()) = sender_id
    or (
      private.is_conversation_participant(conversation_id)
      and (trail_id is null or private.can_see_trail_step(trail_id, trail_step))
    )
  );

-- You may only record an unlock for a message you can see, so a stop cannot be
-- unlocked out of order. Clue-mode stops are invisible until unlocked, so the
-- only way in is check_in_trail_step, which checks the position server-side.
drop policy "users record their own unlocks" on public.message_unlocks;

create policy "users record their own unlocks"
  on public.message_unlocks for insert
  to authenticated
  with check (
    (select auth.uid()) = user_id
    and private.can_see_message(message_id)
  );

-- trails: everyone in the thread sees the trail exists and how long it is.
alter table public.trails enable row level security;

create policy "participants read trails in their threads"
  on public.trails for select
  to authenticated
  using (
    (select auth.uid()) = created_by
    or private.is_conversation_participant(conversation_id)
  );

create policy "participants create trails as themselves"
  on public.trails for insert
  to authenticated
  with check (
    (select auth.uid()) = created_by
    and private.is_conversation_participant(conversation_id)
  );

grant select, insert on public.trails to authenticated;
grant all on public.trails to service_role;

-- ---------------------------------------------------------------------------
-- create_trail: the trail and every stop, in one transaction.
--
-- SECURITY INVOKER like create_conversation: the inserts pass through RLS, so
-- "as yourself" and "in a thread you are in" are enforced by the policies.
--
-- p_stops is an array of
--   { body, latitude, longitude, radius_meters, label, next_clue? }
-- in order. next_clue on the last stop is ignored.
-- ---------------------------------------------------------------------------

create function public.create_trail(
  p_conversation_id uuid,
  p_title text,
  p_reveal_mode public.trail_reveal_mode,
  p_stops jsonb
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

  insert into public.trails (conversation_id, created_by, title, reveal_mode, step_count)
  values (p_conversation_id, v_me, trim(p_title), p_reveal_mode, v_count)
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
      trail_id, trail_step, next_clue
    ) values (
      p_conversation_id,
      v_me,
      v_stop ->> 'body',
      -- One millisecond apart, so the stops sort in order in the thread.
      v_now + make_interval(secs => (v_step - 1) * 0.001),
      (v_stop ->> 'latitude')::double precision,
      (v_stop ->> 'longitude')::double precision,
      (v_stop ->> 'radius_meters')::double precision,
      nullif(trim(v_stop ->> 'label'), ''),
      v_trail_id,
      v_step,
      case when v_step < v_count then nullif(trim(v_stop ->> 'next_clue'), '') end
    );
  end loop;

  return v_trail_id;
end;
$$;

revoke all on function public.create_trail(uuid, text, public.trail_reveal_mode, jsonb) from public, anon;
grant execute on function public.create_trail(uuid, text, public.trail_reveal_mode, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- check_in_trail_step: unlock a stop by being there, without the device ever
-- holding its coordinates. The only way to unlock a clue-mode stop.
--
-- Definer, because the caller cannot read the stop yet. It checks everything
-- RLS would: that you are in the thread and have unlocked the stop before.
-- The position is reported by the device, as for every unlock (the PRD accepts
-- this), but the coordinates it is compared with never leave the server.
--
-- Every attempt is logged and limited to 30 per person per trail per hour, so
-- the check cannot be scripted to sweep a city for the hidden pin.
-- ---------------------------------------------------------------------------

create table public.trail_check_ins (
  id bigint generated always as identity primary key,
  trail_id uuid not null references public.trails (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);

create index trail_check_ins_user_trail_idx
  on public.trail_check_ins (user_id, trail_id, created_at desc);

-- Server-only, like push_log: RLS on, no policies, no grant to the API roles.
alter table public.trail_check_ins enable row level security;
revoke all on public.trail_check_ins from anon, authenticated;
grant all on public.trail_check_ins to service_role;

create function public.check_in_trail_step(
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

  insert into public.message_unlocks (message_id, user_id)
  values (v_stop.id, v_me)
  on conflict (message_id, user_id) do nothing;

  return 'unlocked';
end;
$$;

revoke all on function public.check_in_trail_step(uuid, integer, double precision, double precision)
  from public, anon;
grant execute on function public.check_in_trail_step(uuid, integer, double precision, double precision)
  to authenticated;
