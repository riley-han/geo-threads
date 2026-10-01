-- Grants the API roles access to the application tables.
--
-- RLS decides which *rows* a caller may touch; a GRANT decides whether it may
-- touch the table at all. Without this, every request fails before any policy
-- runs — PostgREST returns 42501 "permission denied for table profiles" to a
-- perfectly legitimate signed-in user.
--
-- The initial migration relied on Supabase's default privileges to cover this.
-- They did not apply to these tables, so it is stated explicitly here. Being
-- explicit is better anyway: the grants become part of the schema that
-- supabase/tests/rls.test.mjs exercises, rather than an assumption about the
-- environment that the test harness was quietly satisfying on its own.

-- `authenticated` gets full DML and is held in check entirely by RLS. This is
-- not as broad as it looks: every policy on these tables is TO authenticated
-- and scoped to the caller, so the grant only makes those policies reachable.
grant select, insert, update, delete on
  public.profiles,
  public.friendships,
  public.conversations,
  public.conversation_participants,
  public.messages,
  public.message_unlocks
to authenticated;

-- `service_role` bypasses RLS and backs server-side tooling such as the seed
-- script. It needs the grant for the same reason: privileges are checked before
-- policies, and bypassing RLS does not bypass a missing GRANT.
grant all on
  public.profiles,
  public.friendships,
  public.conversations,
  public.conversation_participants,
  public.messages,
  public.message_unlocks
to service_role;

-- `anon` is deliberately given nothing. This app has no anonymous surface:
-- every policy is TO authenticated, so a signed-out caller was already blocked
-- by RLS, and withholding the grant blocks it a step earlier.

-- Tables added later should be covered too — default privileges not firing is
-- what caused this in the first place.
alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema public
  grant all on tables to service_role;
