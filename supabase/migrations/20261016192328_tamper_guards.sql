-- Closes four writes that RLS alone let through.
--
-- A policy decides which rows you may write. It cannot see which columns
-- changed, so a write to your own row could still rewrite who that row is
-- about. 20260928030830_grant_table_privileges.sql granted full DML on every
-- column, which left these open (each one has a case in supabase/tests/rls.test.mjs):
--
--   1. A request could be inserted as already 'accepted', making you anyone's
--      friend without asking them.
--   2. The addressee could rewrite requester_id while accepting, making them
--      friends with someone who never asked.
--   3. A participant could point their row's conversation_id at any thread.
--   4. A participant could insert a message into someone else's trail.
--
-- The app only ever updates friendships.status and
-- conversation_participants.last_read_at, so updates are narrowed to exactly
-- those columns. Triggers that set other columns (updated_at) are unaffected:
-- column privileges apply to what the statement names, not to what a trigger
-- writes.

-- 1. A request starts pending; only the addressee's update can accept it.
drop policy "users send friend requests as themselves" on public.friendships;

create policy "users send friend requests as themselves"
  on public.friendships for insert
  to authenticated
  with check ((select auth.uid()) = requester_id and status = 'pending');

-- 2. Accepting changes the status and nothing else.
revoke update on public.friendships from authenticated;
grant update (status) on public.friendships to authenticated;

-- 3. Marking a thread read changes last_read_at and nothing else.
revoke update on public.conversation_participants from authenticated;
grant update (last_read_at) on public.conversation_participants to authenticated;

-- 4. Trail stops are written by create_trail, which runs as the caller, so the
--    policy admits stops on your own trails and nobody else's.
drop policy "participants send as themselves" on public.messages;

create policy "participants send as themselves"
  on public.messages for insert
  to authenticated
  with check (
    (select auth.uid()) = sender_id
    and private.is_conversation_participant(conversation_id)
    and (trail_id is null or private.created_trail(trail_id))
  );
