-- Reactions: one tap on a message you have read, and a push to its author.
--
-- See docs/prd/2026-09-found-it-and-trails.md §3 (Phase 3) and
-- docs/plans/2026-10-phase-3-reactions.md.

-- ---------------------------------------------------------------------------
-- message_reactions
--
-- One row per (message, person). Changing your reaction updates the row;
-- removing it sets `emoji` to null rather than deleting. That is deliberate:
-- Realtime cannot apply RLS to DELETE events, so a delete is broadcast (primary
-- key only) to every subscriber of the table, which would tell anyone who
-- removed a reaction on which message. Updates go through the SELECT policy
-- like inserts do.
--
-- The emoji set must match REACTIONS in src/data/reactions.ts; the RLS suite
-- checks the two stay in step.
-- ---------------------------------------------------------------------------

create table public.message_reactions (
  message_id uuid not null references public.messages (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  emoji text check (emoji in ('❤️', '😂', '😮', '🙏')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (message_id, user_id)
);

comment on column public.message_reactions.emoji is
  'Null means the reaction was removed. Rows are not deleted; see the migration header.';

create index message_reactions_user_idx on public.message_reactions (user_id);

create trigger message_reactions_set_updated_at
  before update on public.message_reactions
  for each row execute function private.set_updated_at();

-- You react to what you have read. A fenced message counts as read once you
-- have unlocked it, or if you sent it. Definer for the same reason as the other
-- helpers: it reads messages and message_unlocks without re-entering RLS.
create function private.can_react(p_message_id uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1
    from public.messages m
    join public.conversation_participants cp
      on cp.conversation_id = m.conversation_id
     and cp.user_id = (select auth.uid())
    where m.id = p_message_id
      and (
        m.fence_latitude is null
        or m.sender_id = (select auth.uid())
        or exists (
          select 1 from public.message_unlocks u
          where u.message_id = m.id and u.user_id = (select auth.uid())
        )
      )
  );
$$;

alter table public.message_reactions enable row level security;

-- Everyone in the thread sees reactions, the same audience as the message.
create policy "participants read reactions"
  on public.message_reactions for select
  to authenticated
  using (private.owns_message(message_id));

create policy "users react as themselves to messages they have read"
  on public.message_reactions for insert
  to authenticated
  with check (
    (select auth.uid()) = user_id
    and private.can_react(message_id)
  );

create policy "users change their own reaction"
  on public.message_reactions for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and private.can_react(message_id)
  );

-- No delete grant or policy for clients: removing is `emoji = null`.
grant select, insert, update on public.message_reactions to authenticated;
grant all on public.message_reactions to service_role;

alter publication supabase_realtime add table public.message_reactions;

-- ---------------------------------------------------------------------------
-- push_log + claim_push_slot: collapsing reaction pushes.
--
-- Several reactions to one author within five minutes become one push: the
-- first is sent, the rest stay silent (they still appear live in the app).
-- The claim is atomic, so two reactions landing at once cannot both win.
--
-- Server-only. RLS is on with no policies and `authenticated` has no grant, so
-- only the push function (service_role) can touch either.
-- ---------------------------------------------------------------------------

create table public.push_log (
  id bigint generated always as identity primary key,
  recipient_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null,
  created_at timestamptz not null default now()
);

create index push_log_recipient_kind_idx on public.push_log (recipient_id, kind, created_at desc);

alter table public.push_log enable row level security;
-- Explicit revoke: hosted default privileges can grant new tables to the API
-- roles directly. RLS with no policies would still block them; this makes it
-- a privilege error instead.
revoke all on public.push_log from anon, authenticated;
grant all on public.push_log to service_role;

create function public.claim_push_slot(
  p_recipient_id uuid,
  p_kind text,
  p_window_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Serialise claims for one recipient and kind, so the check and the insert
  -- below cannot interleave with a concurrent call.
  perform pg_advisory_xact_lock(hashtextextended(p_recipient_id::text || ':' || p_kind, 0));

  if exists (
    select 1 from public.push_log
    where recipient_id = p_recipient_id
      and kind = p_kind
      and created_at > now() - make_interval(secs => p_window_seconds)
  ) then
    return false;
  end if;

  insert into public.push_log (recipient_id, kind) values (p_recipient_id, p_kind);
  return true;
end;
$$;

revoke all on function public.claim_push_slot(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.claim_push_slot(uuid, text, integer) to service_role;
