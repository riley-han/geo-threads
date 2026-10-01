-- Found It: unlock receipts and remote push tokens.
--
-- See docs/prd/2026-09-found-it-and-trails.md §3. Two things change about who
-- can see what:
--
--   1. The sender of a message may now read the unlock rows for it, as long as
--      the finder has `share_unlock_receipts` on. Before this, message_unlocks
--      was readable only by the finder.
--   2. Devices register an Expo push token so the push Edge Function can reach
--      people who do not have the app open.
--
-- Webhooks that invoke the function are configured in the dashboard, not here:
-- they need the project URL and a secret, neither of which belongs in a
-- migration. See supabase/README.md → Push.

-- ---------------------------------------------------------------------------
-- profiles.share_unlock_receipts
--
-- Default on: the receipt is the point of the feature. Turning it off hides
-- your unlock rows from senders in RLS, not just in the UI.
-- ---------------------------------------------------------------------------

alter table public.profiles
  add column share_unlock_receipts boolean not null default true;

comment on column public.profiles.share_unlock_receipts is
  'When false, senders cannot read this user''s message_unlocks rows. Enforced by RLS.';

-- ---------------------------------------------------------------------------
-- Receipts: senders read unlocks of their own messages.
--
-- A definer predicate, like the helpers in the initial migration, because the
-- check reads `messages` and `profiles` and must not re-enter RLS. Other group
-- members still see nothing: only the message's sender qualifies.
-- ---------------------------------------------------------------------------

create function private.can_read_unlock_receipt(p_message_id uuid, p_finder_id uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1
    from public.messages m
    join public.profiles p on p.id = p_finder_id
    where m.id = p_message_id
      and m.sender_id = (select auth.uid())
      and p.share_unlock_receipts
  );
$$;

create policy "senders read receipts for their messages"
  on public.message_unlocks for select
  to authenticated
  using (private.can_read_unlock_receipt(message_id, user_id));

-- A receipt says which message was found, never a precise moment: coarsen to
-- the minute, and take the server clock so a client cannot backdate it.
create function private.coarsen_unlocked_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.unlocked_at := date_trunc('minute', now());
  return new;
end;
$$;

create trigger message_unlocks_coarsen_unlocked_at
  before insert on public.message_unlocks
  for each row execute function private.coarsen_unlocked_at();

-- So a sender's "Found" state appears live in an open thread. Realtime applies
-- the SELECT policies above, so a sender only receives receipts they may read.
alter publication supabase_realtime add table public.message_unlocks;

-- ---------------------------------------------------------------------------
-- push_tokens
--
-- One row per (user, device token). Written only through register_push_token,
-- which also takes the token away from any other account that last used this
-- device — otherwise signing into a second account on one phone would deliver
-- the first account's pushes to it.
-- ---------------------------------------------------------------------------

create table public.push_tokens (
  user_id uuid not null references public.profiles (id) on delete cascade,
  token text not null check (char_length(token) between 1 and 512),
  platform text not null check (platform in ('ios', 'android')),
  updated_at timestamptz not null default now(),
  primary key (user_id, token)
);

create index push_tokens_token_idx on public.push_tokens (token);

alter table public.push_tokens enable row level security;

create policy "users read their own push tokens"
  on public.push_tokens for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "users remove their own push tokens"
  on public.push_tokens for delete
  to authenticated
  using ((select auth.uid()) = user_id);

-- No insert or update policy: registration goes through the RPC below.
--
-- Explicit grants, as in 20260928030830_grant_table_privileges.sql: the hosted
-- project's default privileges do not cover new tables. `authenticated` gets
-- only what a policy above allows; the push function reads and prunes tokens
-- as service_role.
grant select, delete on public.push_tokens to authenticated;
grant all on public.push_tokens to service_role;

create function public.register_push_token(p_token text, p_platform text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := (select auth.uid());
begin
  if v_me is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  -- A device token identifies a device, so it can belong to one account.
  delete from public.push_tokens
  where token = p_token and user_id <> v_me;

  insert into public.push_tokens (user_id, token, platform)
  values (v_me, p_token, p_platform)
  on conflict (user_id, token)
  do update set platform = excluded.platform, updated_at = now();
end;
$$;

revoke all on function public.register_push_token(text, text) from public;
grant execute on function public.register_push_token(text, text) to authenticated;
