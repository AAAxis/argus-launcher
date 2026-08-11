-- 2026-08-07 -- assigning directly, and claiming a profile on the way in.
--
-- Same situation as every file beside this one: there is no supabase/migrations/
-- in this workspace and the Supabase CLI is not installed, so this is a record
-- of a change applied by hand in the SQL editor of project jpsmdjtxuxlkyuotwxfg
-- -- not something a tool replays. Run it once; it is idempotent.
--
-- RUN IT BEFORE SHIPPING THE BUILD THAT EXPECTS IT. The launcher's new
-- "Assigned to" picker calls set_assignee with a teammate's id, which the
-- version of that function shipped in 2026-08-06-handoffs.sql refuses outright
-- -- so against an un-migrated database every assignment to a colleague fails
-- with "Share it with them instead so they can accept it."
--
--
-- ── What this changes about the model, and what it does not ───────────────
--
-- 2026-08-06-handoffs.sql made a deliberate choice: you could claim an item for
-- yourself or drop one you held, but handing work to somebody ELSE had to go
-- through an offer they accepted. The reasoning was consent -- work should not
-- land on your plate because a colleague decided it should.
--
-- In use that proved to be the wrong default for the common case. A team
-- dividing a pool of profiles is not negotiating; one person is doing the
-- filing, and making every row a two-step negotiation turned an afternoon of
-- organising into an inbox of forty notifications for the person on the
-- receiving end. So assignment becomes direct, and the offer becomes the
-- deliberate act it should have been all along -- still there, via ShareModal,
-- for when you actually want somebody to agree before it becomes theirs.
--
-- What has NOT changed, and must not: assignment is not permission. Every
-- member of the org can already see, launch and edit every profile, proxy,
-- cookie set and automation -- org_id is the only scope on any of them. This
-- file adds no policy and narrows no access. It changes who a row NAMES, and
-- nothing else. An assignment is a label saying who is on the hook, and taking
-- one off somebody does not lock them out of anything.


-- ── Check this first ──────────────────────────────────────────────────────
-- Everything below assumes organizations.id is uuid, the same assumption
-- 2026-08-05-teams.sql and 2026-08-06-handoffs.sql document. If this says text,
-- replace every `uuid` org id below with `text` before running the rest.
select data_type
  from information_schema.columns
 where table_schema = 'public'
   and table_name = 'organizations'
   and column_name = 'id';


-- ── Claim a profile on insert ─────────────────────────────────────────────
-- A profile you create is yours until you say otherwise. Previously every new
-- row arrived unassigned, so a workspace that had just imported two hundred
-- profiles showed two hundred em dashes in the Assigned column and no way to
-- tell whose import it had been.
--
-- The default lives in Postgres rather than in the launcher for two reasons.
-- It covers every insert path at once -- the profile editor, the CSV import,
-- the MCP tools and the local HTTP API -- so a path added later cannot forget
-- it. And auth.uid() cannot be forged by a client, exactly like the created_by
-- default it sits beside (2026-08-05-teams.sql).
--
-- Crucially this fires on INSERT only. Re-importing a CSV that updates rows a
-- colleague already holds does not re-claim them, because an UPDATE never
-- consults a column default.
--
-- profiles alone, on purpose. proxies, cookie_sets and automations keep their
-- current behaviour: a proxy is shared infrastructure that everybody draws
-- from, and stamping the first person to add one as its owner would fill their
-- "Assigned to me" with plumbing they never took responsibility for.
alter table public.profiles alter column assigned_to set default auth.uid();


-- ── set_assignee ──────────────────────────────────────────────────────────
-- Assign to anyone on the team, or to nobody.
--
-- Replaces the version in 2026-08-06-handoffs.sql, whose guard was "yourself or
-- nobody" (raising use_offer_handoff for anybody else). See the note at the top
-- of this file for why that changed.
--
-- Dropped first rather than CREATE OR REPLACE, for the reason the previous file
-- records: `create or replace function` cannot change a return type, and
-- re-running a corrected migration against an old signature is how
-- 2026-08-05-teams.sql shipped a create_org_invite that only failed at CALL
-- time.
drop function if exists public.set_assignee(uuid, text, text, uuid);

create function public.set_assignee(p_org uuid, p_kind text, p_id text, p_to uuid)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  -- is_org_member, not is_org_admin. Dividing a shared pool between peers is
  -- the entire feature; gating it behind admin would stop the people doing the
  -- work from organising it.
  if not public.is_org_member(p_org) then
    raise exception 'not a member of that organization' using errcode = '42501';
  end if;
  -- The one guard that has to survive the loosening above. Without it any uuid
  -- would do, and a profile could be assigned to somebody who cannot see the
  -- workspace it lives in -- an assignment that would never appear in anyone's
  -- list and that nobody could act on or clear.
  if p_to is not null and not exists (
    select 1 from public.org_members m where m.org_id = p_org and m.user_id = p_to
  ) then
    raise exception 'not_a_teammate' using errcode = 'check_violation';
  end if;

  if p_kind = 'proxy' then
    update public.proxies set assigned_to = p_to where id = p_id and org_id = p_org;
  elsif p_kind = 'cookie_set' then
    update public.cookie_sets set assigned_to = p_to where id = p_id and org_id = p_org;
  elsif p_kind = 'automation' then
    update public.automations set assigned_to = p_to where id = p_id and org_id = p_org;
  elsif p_kind = 'profile' then
    update public.profiles set assigned_to = p_to where id = p_id and org_id = p_org;
  else
    raise exception 'invalid_kind' using errcode = 'check_violation';
  end if;

  if not found then
    raise exception 'item_not_found: %', p_id using errcode = 'check_violation';
  end if;
end $function$;


-- ── set_assignees ─────────────────────────────────────────────────────────
-- The same thing for many items at once.
--
-- Exists for the import dialog, which finishes by pointing everything it just
-- created at one person. Doing that through set_assignee would be one round
-- trip per profile -- two hundred RPCs for one import, each with its own
-- membership check, any of which could fail on its own and leave the batch half
-- applied.
--
-- Returns the number of rows actually updated rather than void, so the caller
-- can tell "assigned 200" from an id list that silently matched nothing.
drop function if exists public.set_assignees(uuid, text, text[], uuid);

create function public.set_assignees(p_org uuid, p_kind text, p_ids text[], p_to uuid)
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  touched integer;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if not public.is_org_member(p_org) then
    raise exception 'not a member of that organization' using errcode = '42501';
  end if;
  if p_to is not null and not exists (
    select 1 from public.org_members m where m.org_id = p_org and m.user_id = p_to
  ) then
    raise exception 'not_a_teammate' using errcode = 'check_violation';
  end if;

  -- An empty list is success, not an error. The import calls this
  -- unconditionally, and a file whose every row was an update legitimately
  -- creates nothing to assign.
  if p_ids is null or array_length(p_ids, 1) is null then
    return 0;
  end if;

  -- No `if not found` raise, unlike set_assignee. A single-item call naming a
  -- row that does not exist is a bug worth surfacing; a bulk call that matches
  -- 199 of 200 ids is a row deleted by somebody else mid-import, and failing
  -- the whole batch over it would undo nothing and help no one. The count says
  -- what happened.
  if p_kind = 'proxy' then
    update public.proxies set assigned_to = p_to
     where id = any(p_ids) and org_id = p_org;
  elsif p_kind = 'cookie_set' then
    update public.cookie_sets set assigned_to = p_to
     where id = any(p_ids) and org_id = p_org;
  elsif p_kind = 'automation' then
    update public.automations set assigned_to = p_to
     where id = any(p_ids) and org_id = p_org;
  elsif p_kind = 'profile' then
    update public.profiles set assigned_to = p_to
     where id = any(p_ids) and org_id = p_org;
  else
    raise exception 'invalid_kind' using errcode = 'check_violation';
  end if;

  get diagnostics touched = row_count;
  return touched;
end $function$;


grant execute on function public.set_assignee(uuid, text, text, uuid) to authenticated;
grant execute on function public.set_assignees(uuid, text, text[], uuid) to authenticated;


-- ── Sanity ────────────────────────────────────────────────────────────────
-- Replace the ids with a real org you belong to, a real profile in it, and a
-- teammate's user id.
--
-- The first must now SUCCEED -- it is exactly the call the old function
-- refused, and it is the check most likely to rot:
--
--   select public.set_assignee(
--     '00000000-0000-0000-0000-000000000000', 'profile',
--     'some-profile-id', '11111111-1111-1111-1111-111111111111');
--
-- The second must still fail with "not_a_teammate", which is the guard that
-- keeps a row from naming somebody who cannot see it:
--
--   select public.set_assignee(
--     '00000000-0000-0000-0000-000000000000', 'profile',
--     'some-profile-id', '99999999-9999-9999-9999-999999999999');
--
-- And confirm the default landed. This must print "auth.uid()":
--
--   select column_default from information_schema.columns
--    where table_schema = 'public' and table_name = 'profiles'
--      and column_name = 'assigned_to';
