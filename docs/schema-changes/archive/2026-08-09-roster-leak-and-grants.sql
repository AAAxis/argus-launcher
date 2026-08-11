-- 2026-08-09 -- two live holes: the roster returns every user of the product,
-- and anyone holding the anon key can raise any organization's limits.
--
-- Same situation as every file beside this one: there is no supabase/migrations/
-- in this workspace and the Supabase CLI is not installed, so this is a record
-- of a change applied by hand in the SQL editor of project jpsmdjtxuxlkyuotwxfg
-- -- not something a tool replays. Run it once; it is idempotent.
--
-- APPLY THIS BEFORE ANYTHING ELSE. Both defects are live in production right now
-- and neither needs a client change to fix -- the function keeps its signature
-- and its return shape, and the revokes only remove privileges nothing was
-- supposed to have. Nothing has to ship alongside this.
--
-- HOW THEY WERE FOUND. Reading the live database while investigating a report
-- that a stranger had appeared in a workspace's Team tab. He had not: org_members
-- held three rows, each of them the owner of their own separate organization.
-- The Team tab was showing every user of the product to everybody, which is
-- defect 1 below.


-- ── 1. org_members_with_identity leaked the whole user table ───────────────
-- The function checks that the caller belongs to p_org and then never uses
-- p_org again. 2026-08-05-teams.sql:415-435 shipped it that way:
--
--     return query
--     select m.user_id, u.email::text, ...
--       from public.org_members m
--       join auth.users u on u.id = m.user_id      -- no org filter
--      order by m.created_at asc;
--
-- So the membership check is real but decorative: pass it for ANY org you belong
-- to -- and bootstrap_org gives every new account one at first sign-in, so
-- everybody belongs to one -- and you receive the address, display name, avatar
-- and role of every registered user. A personal-data leak that widens with every
-- signup, and the reason a stranger appeared in somebody's roster.
--
-- SECURITY DEFINER is what makes the omission fatal rather than merely wrong.
-- Under RLS the org_members_select policy (is_org_member) would have filtered
-- the rows back down on its own and the missing predicate would have been
-- invisible. This function runs without RLS, so the WHERE clause IS the tenant
-- boundary -- the same rule offer_handoff states in its own body comment
-- (2026-08-07-assign-directly.sql) and the reason every lookup in that function
-- is scoped to p_org as well as to the id.
--
-- Everything else below is byte-identical to the shipped version, including the
-- metadata precedence, which has to keep mirroring accountDisplayName() and
-- accountAvatarUrl() in src/db/account.ts.
create or replace function public.org_members_with_identity(p_org uuid)
returns table (
  user_id      uuid,
  email        text,
  display_name text,
  avatar_url   text,
  role         text,
  created_at   timestamptz,
  invited_by   uuid
)
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  if not public.is_org_member(p_org) then
    raise exception 'not a member of that organization' using errcode = '42501';
  end if;

  return query
  select m.user_id,
         u.email::text,
         coalesce(
           nullif(u.raw_user_meta_data ->> 'monti_display_name', ''),
           nullif(u.raw_user_meta_data ->> 'full_name', ''),
           nullif(u.raw_user_meta_data ->> 'name', ''),
           '')::text,
         coalesce(
           nullif(u.raw_user_meta_data ->> 'monti_avatar_url', ''),
           nullif(u.raw_user_meta_data ->> 'avatar_url', ''),
           nullif(u.raw_user_meta_data ->> 'picture', ''),
           '')::text,
         m.role,
         m.created_at,
         m.invited_by
    from public.org_members m
    join auth.users u on u.id = m.user_id
   where m.org_id = p_org
   order by m.created_at asc;
end $function$;

revoke all on function public.org_members_with_identity(uuid) from public, anon;
grant execute on function public.org_members_with_identity(uuid) to authenticated;


-- ── 2. apply_plan_entitlements was callable by anyone ─────────────────────
-- The function has no caller check of any kind -- deliberately, because it was
-- meant to be reachable only by the service role, which lib/entitlements.ts
-- holds and the browser never sees. 2026-08-05-teams.sql:536 says exactly that
-- and revokes it.
--
-- The revoke is not in effect. The live body updates `where id = p_org` where
-- the file says `where o.id = p_org`, so the function was re-created out of band
-- at some point after that file ran -- and `create or replace` on a function
-- whose privileges were revoked does not restore them, but `drop function` +
-- `create function` does: the new function starts with EXECUTE granted to
-- PUBLIC, and a revoke written once in an older file is not re-run.
--
-- Which made this a single unauthenticated HTTP call, with the anon key that
-- ships inside the launcher bundle:
--
--     POST /rest/v1/rpc/apply_plan_entitlements
--     {"p_org": "<any org uuid>", "p_plan": "enterprise"}
--     -> profile_limit null (unlimited), seat_limit 25, automation_limit 100
--
-- It does not touch organizations.plan or billing_status, so nothing in the
-- billing tables would have looked wrong. The limits are what the launcher and
-- the triggers actually enforce, so the paywall was the only casualty.
--
-- `from public` as well as from the two roles. Revoking from anon and
-- authenticated alone leaves the PUBLIC grant standing, and PUBLIC includes
-- them both -- which is the precise reason the original revoke, which named
-- only those two roles, would not have held even if it had been re-run.
revoke all on function public.apply_plan_entitlements(uuid, text)
  from public, anon, authenticated;


-- ── 3. Every other SECURITY DEFINER function, same treatment ──────────────
-- None of these is exploitable by anon today: each one opens with an auth.uid()
-- null check or an is_org_member gate, so an anonymous call gets a 28000 or a
-- 42501 rather than data. They are revoked anyway, for two reasons.
--
-- First, an unauthenticated caller reaching a function at all is a rehearsal for
-- the day somebody adds a code path before the auth check. Second, this is what
-- Supabase's own security advisor flags
-- (anon_security_definer_function_executable), and a permanent shelf of known
-- warnings is how the one that matters gets missed.
revoke all on function public.accept_org_invite(text)                          from public, anon;
revoke all on function public.create_org_invite(uuid, text, text)              from public, anon;
revoke all on function public.peek_org_invite(text)                            from public, anon;
revoke all on function public.offer_handoff(uuid, text, text[], uuid, text)    from public, anon;
revoke all on function public.accept_handoff(uuid)                             from public, anon;
revoke all on function public.cancel_handoff(uuid)                             from public, anon;
revoke all on function public.decline_handoff(uuid)                            from public, anon;
revoke all on function public.set_assignee(uuid, text, text, uuid)             from public, anon;
revoke all on function public.set_assignees(uuid, text, text[], uuid)          from public, anon;

grant execute on function public.accept_org_invite(text)                       to authenticated;
grant execute on function public.create_org_invite(uuid, text, text)           to authenticated;
grant execute on function public.peek_org_invite(text)                         to authenticated;
grant execute on function public.offer_handoff(uuid, text, text[], uuid, text) to authenticated;
grant execute on function public.accept_handoff(uuid)                          to authenticated;
grant execute on function public.cancel_handoff(uuid)                          to authenticated;
grant execute on function public.decline_handoff(uuid)                         to authenticated;
grant execute on function public.set_assignee(uuid, text, text, uuid)          to authenticated;
grant execute on function public.set_assignees(uuid, text, text[], uuid)       to authenticated;

-- The trigger functions, from BOTH roles. These take no arguments, read NEW, and
-- are meaningless outside the trigger that fires them -- a REST call to one is
-- never anything but an attempt to see what happens. bootstrap_org, is_org_member
-- and is_org_admin already have no anon grant; they are listed for completeness
-- of the audit rather than because they need changing.
revoke all on function public.enforce_seat_limit()       from public, anon, authenticated;
revoke all on function public.enforce_profile_limit()    from public, anon, authenticated;
revoke all on function public.enforce_automation_limit() from public, anon, authenticated;


-- ── 4. Table grants the anon role should never have had ───────────────────
-- anon holds INSERT, UPDATE, DELETE and TRUNCATE on these four. Not exploitable
-- today: RLS is enabled on all of them and every policy names `to authenticated`,
-- so an anonymous request matches no policy and is refused before the grant is
-- consulted.
--
-- It is still wrong, and the failure mode is nasty. A grant is the thing RLS
-- falls back to; the day somebody writes a policy without a `to` clause -- which
-- defaults to PUBLIC -- these four tables are open to the internet, and nothing
-- in the diff of that change would say so.
revoke all on public.automations     from anon;
revoke all on public.automation_runs from anon;
revoke all on public.handoffs        from anon;
revoke all on public.org_invites     from anon;


-- ── Verify ────────────────────────────────────────────────────────────────
-- Both should return zero rows.

-- Anything still reachable by anon:
select p.proname
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.prokind = 'f'
   and has_function_privilege('anon', p.oid, 'EXECUTE');

-- Anything anon can still write:
select table_name, privilege_type
  from information_schema.role_table_grants
 where table_schema = 'public'
   and grantee = 'anon'
   and privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE');
