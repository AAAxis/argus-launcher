-- Which workspace a person is looking at, and how many they may have.
--
-- Two surfaces have to agree on one answer, and before this neither asked. The
-- launcher kept localStorage['monti.activeOrgId'], which is per machine and per
-- install. The website open-coded "the org I belong to with the earliest
-- created_at" (landing/lib/ensure-org.ts, whose own docstring flags it as a
-- placeholder for this migration). Those two rules disagree the moment somebody
-- accepts an invitation into a workspace older than their own -- which on
-- 2026-08-07 was true of every multi-org account in this database. Both
-- pochtmanrca@gmail.com and polskoydm@gmail.com resolved on the web to Simnetiq
-- LTD, created 08-03, rather than to the workspace they own, so their billing
-- page, their plan page and their support tickets all pointed at a company that
-- is not theirs.
--
-- bootstrap_org had the same bug in a quieter form: `select org_id from
-- org_members where user_id = uid limit 1` with no ORDER BY, so which workspace
-- a returning user was handed was whatever the planner reached first. Stable in
-- practice, undefined in principle, and undefined is not a thing to hang billing
-- on.
--
-- After this there is exactly one definition of "which workspace" --
-- public.active_org() -- and the launcher, the website and the bootstrap path
-- all read it.

-- ─────────────────────────────────────────────────────────────────────────────
-- Where the choice lives
-- ─────────────────────────────────────────────────────────────────────────────
--
-- A table, not auth.users.raw_user_meta_data, where monti_display_name,
-- monti_avatar_url and monti_table_columns already live. Three reasons, in
-- order of weight:
--
--  1. The launcher reads user_metadata off the CACHED session object -- see
--     src/org.tsx, which builds displayName and avatarUrl from the User handed
--     to it by onAuthStateChange. That object refreshes on TOKEN_REFRESHED,
--     roughly hourly. A workspace switched on the website would therefore stay
--     invisible in a running launcher for up to an hour, which is the single
--     thing this migration exists to prevent.
--  2. updateUser() is a read-modify-write of the whole metadata blob. Adding a
--     fourth writer, on a hotter path than the other three, invites lost updates
--     between two open windows.
--  3. A SECURITY DEFINER function cannot correct metadata. active_org() below
--     has to verify that the stored id is still a live membership; from a table
--     that is one join, and Supabase Auth owns the other row.
create table if not exists public.user_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,

  -- ON DELETE SET NULL rather than CASCADE: a workspace going away must not take
  -- the person's settings row with it. Null here means "no choice on record",
  -- which active_org() already handles as its ordinary case.
  active_org_id uuid references public.organizations(id) on delete set null,

  -- When we last asked an invited-only user whether they also want a workspace
  -- of their own. Account-level rather than a column on an org, because the
  -- question is about the person: an org column would re-ask them from every
  -- workspace they are ever invited into. Stamped on either answer -- taking it
  -- or declining -- for the same reason organizations.onboarded_at is. See the
  -- header of src/components/modals/WorkspaceSetupModal.tsx.
  personal_workspace_prompt_at timestamptz,

  updated_at timestamptz not null default now()
);

alter table public.user_settings enable row level security;

-- Read-only to clients. Every write goes through one of the SECURITY DEFINER
-- functions below, because active_org_id has to be a membership the caller
-- actually holds and a column grant cannot express that. Nothing is lost: no
-- client has a reason to write this row except through set_active_org.
revoke all on table public.user_settings from anon, authenticated;
grant select on table public.user_settings to authenticated;

drop policy if exists "user_settings_select" on public.user_settings;
create policy "user_settings_select" on public.user_settings
  for select to authenticated
  using (user_id = auth.uid());

-- ─────────────────────────────────────────────────────────────────────────────
-- The caps
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Functions rather than literals because each number is read from two places --
-- the guard inside create_workspace and the trigger that backs it -- and two
-- copies of a number drift. Both are inside function bodies, which is exactly
-- where a drifted constant hides.
--
-- The two differ because they cost different things. Being a member of somebody
-- else's workspace costs that workspace a seat, which its owner already pays
-- for, so ten is generous and harmless. Owning one costs us a free tier: every
-- workspace created here starts on `free` with profile_limit 5, so the owned cap
-- multiplied by five is the number of profiles one account can have for nothing.
-- Three keeps that at fifteen. Raising a cap later is painless; lowering one
-- after people have exceeded it is not, which is why the tighter number is the
-- one that ships.
create or replace function public.membership_cap()
returns int language sql immutable as $$ select 10 $$;

create or replace function public.owned_workspace_cap()
returns int language sql immutable as $$ select 3 $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Which workspace is active
-- ─────────────────────────────────────────────────────────────────────────────
--
-- STABLE, and deliberately does not persist its fallback. This runs on every
-- dashboard request and on every launcher resolve; writing from it would put a
-- row lock on a read path to record an answer that is already deterministic --
-- the same input gives the same result next time. Only an explicit switch
-- writes.
--
-- The fallback prefers a workspace you own. "Earliest membership overall" was
-- the old website rule and it is the bug: an invitation into a company older
-- than your own silently retargets your billing at it. Preferring what you own
-- means the default is always your own data, and one click changes it for good.
create or replace function public.active_org()
returns uuid
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  uid    uuid := auth.uid();
  stored uuid;
  chosen uuid;
begin
  if uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  select s.active_org_id into stored
    from public.user_settings s
   where s.user_id = uid;

  -- Re-checked every time rather than trusted. Somebody removed from a
  -- workspace must stop resolving to it immediately, and the ON DELETE SET NULL
  -- on the column only covers the case where the workspace itself was deleted.
  if stored is not null and exists (
       select 1 from public.org_members m
        where m.org_id = stored and m.user_id = uid) then
    return stored;
  end if;

  select m.org_id into chosen
    from public.org_members m
   where m.user_id = uid
   -- org_id last so the ordering is total. Two memberships created inside one
   -- transaction share a created_at, and without a tiebreak this would be the
   -- same unordered `limit 1` that bootstrap_org is being fixed for below.
   order by (m.role = 'owner') desc, m.created_at asc, m.org_id asc
   limit 1;

  -- Null when they belong to nothing at all. Callers treat that as "bootstrap
  -- one" (bootstrap_org, ensureOrg) or as "no workspace yet" (the dashboard).
  return chosen;
end $function$;

-- Everything the launcher needs about the account, in one round trip.
--
-- Split out from active_org() rather than folded into it because the website
-- needs only the id and should not pay to learn about a prompt it never shows.
-- The launcher Promise.all's this with listMyOrgs, so it costs no wall-clock on
-- the startup path -- which is only true while they stay parallel. Do not
-- sequence them.
create or replace function public.account_state()
returns table (active_org_id uuid, personal_workspace_prompt_at timestamptz)
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  return query
    select public.active_org(),
           (select s.personal_workspace_prompt_at
              from public.user_settings s
             where s.user_id = uid);
end $function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Switching
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.set_active_org(p_org uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if p_org is null then
    raise exception 'org_required' using errcode = 'check_violation';
  end if;

  -- Not merely belt-and-braces over RLS: this row is read back by active_org()
  -- and the id it returns is handed to the checkout route. A value written here
  -- that the caller is not a member of would be an org they cannot see but can
  -- be billed for.
  if not exists (
       select 1 from public.org_members m
        where m.org_id = p_org and m.user_id = uid) then
    raise exception 'not_a_member' using errcode = '42501';
  end if;

  insert into public.user_settings (user_id, active_org_id)
       values (uid, p_org)
  on conflict (user_id) do update
     set active_org_id = excluded.active_org_id,
         updated_at    = now();

  return p_org;
end $function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Creating a second workspace
-- ─────────────────────────────────────────────────────────────────────────────
--
-- SECURITY DEFINER for the same reason bootstrap_org is: `organizations` has no
-- INSERT policy and no INSERT grant, so a client insert is refused by design and
-- this is the only door.
--
-- The new workspace gets free / 5 profiles / 1 seat -- exactly what bootstrap_org
-- gives the first one, and deliberately NOT the creator's current plan. An
-- entitlement is bought per organization (subscriptions.org_id, and
-- app/api/checkout charges one org), and every limit column is service-role-only
-- precisely so that no client path can raise one. Inheriting would hand out a
-- free copy of a paid plan on every press of "Create workspace". The dialog says
-- so in as many words; if that copy ever disappears this is the first support
-- ticket.
create or replace function public.create_workspace(
  p_name text default null,
  p_org_type text default null)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  uid    uuid := auth.uid();
  owned  int;
  new_id uuid;
  nm     text;
begin
  if uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if p_org_type is not null and p_org_type not in ('solo', 'business') then
    raise exception 'invalid_org_type' using errcode = 'check_violation';
  end if;

  -- The same key bootstrap_org takes, so the two cannot interleave for one
  -- person -- and so two fast presses of "Create workspace" cannot both read
  -- owned = 2 and both succeed.
  perform pg_advisory_xact_lock(hashtextextended(uid::text, 0));

  select count(*) into owned
    from public.org_members m
   where m.user_id = uid and m.role = 'owner';

  -- Checked here as well as in the trigger below. The trigger is the guarantee,
  -- because it covers every path in; this is what makes the refusal happen
  -- before an organizations row is inserted and rolled back, and the advisory
  -- lock is what makes it race-free.
  if owned >= public.owned_workspace_cap() then
    raise exception 'owned_workspace_limit_reached'
      using errcode = 'check_violation',
            hint = 'Leave or hand over one of your own workspaces first.';
  end if;

  nm := coalesce(nullif(trim(p_name), ''), 'New workspace');

  insert into public.organizations (name, plan, profile_limit, seat_limit, org_type, onboarded_at)
       values (nm, 'free', 5, 1, p_org_type,
               -- Stamped when the type was answered, which the create dialog
               -- always does. Left null otherwise, so a workspace made by some
               -- future caller that does not ask still gets the setup prompt.
               -- Without this the "Who is this workspace for?" modal would open
               -- over a workspace on the next launch and ask a question its
               -- owner answered thirty seconds earlier.
               case when p_org_type is null then null else now() end)
    returning id into new_id;

  insert into public.org_members (org_id, user_id, role)
       values (new_id, uid, 'owner');

  -- Active immediately. Creating a workspace and not being taken to it is not a
  -- thing anybody wants, and doing it here means the launcher's optimistic local
  -- switch and the server already agree before the dialog closes.
  insert into public.user_settings (user_id, active_org_id)
       values (uid, new_id)
  on conflict (user_id) do update
     set active_org_id = excluded.active_org_id,
         updated_at    = now();

  return new_id;
end $function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Ten memberships, three owned
-- ─────────────────────────────────────────────────────────────────────────────
--
-- On org_members rather than in each caller, because there are three ways in --
-- bootstrap_org, create_workspace and accept_org_invite -- and only a trigger
-- covers all three. accept_org_invite is the one that matters: it is the path
-- nobody would think to add a guard to, and it is how a person ends up in their
-- tenth workspace.
--
-- Keyed on new.user_id, not auth.uid(). accept_org_invite inserts for the
-- caller, but a service-role backfill inserts for somebody else and has to be
-- counted against that person.
--
-- Not a security boundary, and not pretending to be one: two invites accepted in
-- the same instant can both read nine. The cap is a courtesy against runaway
-- accounts, and no constraint can express "at most ten rows per user".
create or replace function public.enforce_workspace_limit()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  total int;
  owned int;
begin
  select count(*), count(*) filter (where m.role = 'owner')
    into total, owned
    from public.org_members m
   where m.user_id = new.user_id;

  if total >= public.membership_cap() then
    raise exception 'workspace_limit_reached'
      using errcode = 'check_violation',
            hint = 'Leave a workspace before joining or creating another.';
  end if;

  if new.role = 'owner' and owned >= public.owned_workspace_cap() then
    raise exception 'owned_workspace_limit_reached'
      using errcode = 'check_violation',
            hint = 'Leave or hand over one of your own workspaces first.';
  end if;

  return new;
end $function$;

-- The name is load-bearing. Postgres fires BEFORE ROW triggers in alphabetical
-- order, and 'trg_member_workspace_limit' sorts before 'trg_seat_limit', so this
-- one goes first. The two collide in exactly one case -- somebody already in ten
-- workspaces accepting an invite into a seat-full one -- and
-- workspace_limit_reached is the better thing to show them, because it is the
-- one they can act on alone. Clearing seat_limit_reached needs the other
-- workspace's owner to buy a seat.
drop trigger if exists trg_member_workspace_limit on public.org_members;
create trigger trg_member_workspace_limit
  before insert on public.org_members
  for each row execute function public.enforce_workspace_limit();

-- ─────────────────────────────────────────────────────────────────────────────
-- The one-shot prompt for people who arrived by invitation
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Somebody invited into a team has no workspace of their own and never gets
-- asked for one: bootstrap_org returns the workspace they were invited into and
-- stops. This records that we asked, once, so the launcher can stop.
create or replace function public.dismiss_personal_workspace_prompt()
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  insert into public.user_settings (user_id, personal_workspace_prompt_at)
       values (uid, now())
  on conflict (user_id) do update
     set personal_workspace_prompt_at = now(),
         updated_at = now();
end $function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- bootstrap_org: stop handing back an arbitrary membership
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Only the existing-membership lookup changes: it now delegates to active_org()
-- instead of running its own unordered `limit 1`. Everything else -- the
-- advisory lock added by 20260806140000 after the double-org incident, the
-- email-derived default name, the free/5/1 entitlements -- is unchanged.
--
-- Delegating rather than copying the ORDER BY is the point. There is now one
-- definition of "which workspace", and the launcher, the website and this
-- function all read it.
create or replace function public.bootstrap_org(org_name text default null)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  uid      uuid := auth.uid();
  existing uuid;
  new_id   uuid;
  nm       text;
begin
  if uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  -- Serialize concurrent bootstraps for this user and nobody else.
  perform pg_advisory_xact_lock(hashtextextended(uid::text, 0));

  -- Must come after the lock. Before it, this is the read that raced.
  existing := public.active_org();
  if existing is not null then
    return existing;
  end if;

  select coalesce(
           nullif(trim(org_name), ''),
           nullif(split_part(u.email, '@', 2), '') || ' team',
           'My team')
    into nm
    from auth.users u
   where u.id = uid;

  insert into public.organizations (name, plan, profile_limit, seat_limit)
       values (coalesce(nm, 'My team'), 'free', 5, 1)
    returning id into new_id;

  insert into public.org_members (org_id, user_id, role)
       values (new_id, uid, 'owner');

  return new_id;
end $function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- The workspace's identity is the owner's to set
-- ─────────────────────────────────────────────────────────────────────────────
--
-- organizations_update was is_org_member(id), bounded by a column grant that
-- allows only the workspace's own details -- name, org_type, legal_name,
-- country, website, logo_url, industry, onboarded_at, built_in_extensions. The
-- limits and the plan were never client-writable and still are not.
--
-- That was defensible when your only workspace was your own. It is not now.
-- After this migration a person can sit in ten workspaces, most of them somebody
-- else's, and "a colleague can see the workspace" and "a colleague can rename it
-- and replace its logo" are very different sentences. Both apps already behave
-- as though the policy were owner-only: landing/components/dashboard/
-- BusinessForm.tsx says outright that "UI on the role is the only thing stopping
-- a colleague from renaming the" workspace. A client-side gate compensating for
-- a permissive policy is a bug that has not been found yet.
--
-- RLS policies cannot be scoped to columns, so the one genuinely member-writable
-- column moves to its own function below.
drop policy if exists "organizations_update" on public.organizations;
create policy "organizations_update" on public.organizations
  for update to authenticated
  using (public.is_org_owner(id))
  with check (public.is_org_owner(id));

-- The exception, kept as one. A bundled extension is a shared runtime setting
-- rather than branding, and the Extensions tab has let any member toggle it
-- since it shipped -- see the comment on updateBuiltInExtensions in
-- src/db/orgs.ts, which records that as intentional.
--
-- Raises rather than no-ops on a non-member, because RLS filtering an UPDATE
-- returns success-with-no-rows and the caller's `.select()` guard exists only to
-- turn that back into an error. Doing it here means the error is the same
-- whichever way the caller checks.
create or replace function public.set_built_in_extensions(p_org uuid, p_value jsonb)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  if not public.is_org_member(p_org) then
    raise exception 'not_a_member' using errcode = '42501';
  end if;
  if jsonb_typeof(p_value) is distinct from 'object' then
    raise exception 'invalid_extension_toggles' using errcode = 'check_violation';
  end if;

  update public.organizations
     set built_in_extensions = p_value
   where id = p_org;
end $function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Grants
-- ─────────────────────────────────────────────────────────────────────────────
grant execute on function public.membership_cap()                       to authenticated;
grant execute on function public.owned_workspace_cap()                  to authenticated;
grant execute on function public.active_org()                           to authenticated;
grant execute on function public.account_state()                        to authenticated;
grant execute on function public.set_active_org(uuid)                   to authenticated;
grant execute on function public.create_workspace(text, text)           to authenticated;
grant execute on function public.dismiss_personal_workspace_prompt()    to authenticated;
grant execute on function public.set_built_in_extensions(uuid, jsonb)   to authenticated;

-- No backfill, deliberately. active_org() over an empty user_settings already
-- produces the corrected answer for every account that exists: verified on
-- 2026-08-07 that it returns "gmail.com team" for pochtmanrca@gmail.com and
-- "Holylabs Ltd" for polskoydm@gmail.com, where the old rule returned Simnetiq
-- LTD for both. A backfill would have to pick a value, and the only value it
-- could pick without asking anybody is the one the fallback already gives -- so
-- it would add nothing except a row freezing today's answer against a future
-- change to the rule.
