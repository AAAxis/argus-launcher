-- 2026-08-05 -- teams: invites, the membership lifecycle, and a real plan->limits function.
--
-- Same situation as every file beside this one: there is no supabase/migrations/
-- in this workspace and the Supabase CLI is not installed, so this is a record
-- of a change applied by hand in the SQL editor of project jpsmdjtxuxlkyuotwxfg
-- -- not something a tool replays. Run it once; it is idempotent.
--
-- WHAT THIS CLOSES. Two of the four plans are named for teams, but nothing could
-- put a second person in an organization. org_members_insert is
-- `with check is_org_admin(org_id)`, so an invitee can never insert their own
-- membership row -- which is why accept_org_invite below has to be
-- SECURITY DEFINER rather than a plain client insert. And nothing anywhere could
-- raise organizations.seat_limit above the 1 that bootstrap_org hardcodes, so
-- the seat trigger has never had anything to enforce.
--
-- RUN IT BEFORE SHIPPING THE BUILD THAT EXPECTS THESE FUNCTIONS. src/db/team.ts
-- calls all three RPCs by name; a build shipped against a database without them
-- shows an empty Team tab and a "Could not save" toast, with the rows sitting
-- untouched in Postgres.

-- ── Check this first ──────────────────────────────────────────────────────
-- Everything below assumes organizations.id is uuid, the same assumption
-- 2026-08-05-automations.sql documents. If this says text, replace every
-- `uuid` org id below with `text` before running the rest.
select data_type
from information_schema.columns
where table_schema = 'public'
  and table_name = 'organizations'
  and column_name = 'id';

-- org_invites existed in this database but was referenced by zero lines in
-- either repo and held zero rows, so this file drops and recreates it rather
-- than reconciling it column by column.
--
-- That is the one destructive statement here, and it is guarded rather than
-- trusted: the block below refuses to continue if the table has ever been
-- written to. The rest of the file is re-runnable by design -- every function
-- is dropped and recreated, and every alter is a default change -- because the
-- first version of this migration could NOT be re-run, and correcting it in
-- place is what the whole exercise turned out to need.
do $$
begin
  if to_regclass('public.org_invites') is not null
     and exists (select 1 from public.org_invites) then
    raise exception
      'org_invites has rows -- refusing to drop it. Reconcile by hand before re-running.';
  end if;
end $$;


-- ── org_invites ───────────────────────────────────────────────────────────
-- A pending offer of a seat. The row is the invite, not the membership: joining
-- writes org_members and flips this to 'accepted', so the roster and the audit
-- trail stay separable.
--
-- `role` deliberately has no 'owner'. You cannot invite someone as owner --
-- ownership is held by whoever ran bootstrap_org, and transferring it is a
-- separate feature nobody has asked for yet. org_members.role keeps its own
-- wider check; this one is narrower on purpose.
drop table if exists public.org_invites;

create table public.org_invites (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations(id) on delete cascade,
  -- Stored as typed. Matching is always case-insensitive (see the unique index
  -- below and accept_org_invite), because an address is not case-sensitive but
  -- people type it both ways.
  email        text not null,
  role         text not null default 'member'
                 check (role in ('admin', 'member')),
  -- Minted by create_org_invite, never by a client. See that function.
  token        text not null unique,
  status       text not null default 'pending'
                 check (status in ('pending', 'accepted', 'revoked')),
  invited_by   uuid references auth.users(id) on delete set null,
  accepted_by  uuid references auth.users(id) on delete set null,
  -- Seven days. An invite that never expires is a permanent key to the
  -- workspace sitting in someone's chat history.
  expires_at   timestamptz not null default now() + interval '7 days',
  created_at   timestamptz not null default now(),
  accepted_at  timestamptz
);

-- One live invite per address per org. Partial on 'pending' so the same person
-- can be re-invited after a revoke, and so the history of accepted invites is
-- not what blocks a re-invite when someone leaves and comes back.
create unique index org_invites_pending_email
  on public.org_invites (org_id, lower(email))
  where status = 'pending';

create index org_invites_org_idx on public.org_invites (org_id, status);

alter table public.org_invites enable row level security;

-- Every policy is is_org_admin, including select.
--
-- The invitee is deliberately NOT given a select policy. They reach their invite
-- through accept_org_invite, which takes the token and is SECURITY DEFINER --
-- so knowing (or guessing) an org id never exposes who else has been invited,
-- and a token is only ever useful to the address it was issued to.
create policy org_invites_select on public.org_invites
  for select to authenticated using (public.is_org_admin(org_id));

create policy org_invites_update on public.org_invites
  for update to authenticated
  using (public.is_org_admin(org_id))
  with check (public.is_org_admin(org_id));

create policy org_invites_delete on public.org_invites
  for delete to authenticated using (public.is_org_admin(org_id));

-- No INSERT policy, and no insert grant below. Creating an invite means minting
-- a token and reserving a seat, both of which have to happen server-side and
-- atomically -- so create_org_invite is the only way in. A client that could
-- insert directly could choose its own token.
grant select, update, delete on public.org_invites to authenticated;


-- ── create_org_invite ─────────────────────────────────────────────────────
-- Mints an invite, reserving a seat against the org's limit.
--
-- The seat check here is NECESSARY, not belt-and-braces. enforce_seat_limit()
-- counts org_members only, so without this an admin could queue twenty invites
-- against three seats and every one of those people would discover the problem
-- only as they tried to join -- after being told they had been invited.
-- Counting pending invites is what makes the refusal land on the admin who can
-- do something about it.
-- Dropped first, not just CREATE OR REPLACE.
--
-- `create or replace function` CANNOT change a function's return type, and the
-- column names in `returns table (...)` are part of that type. So the moment
-- this signature changed, re-running the file failed on this statement with
-- "cannot change return type of existing function" and left the PREVIOUS
-- version installed — which then failed at call time with "column reference
-- \"id\" is ambiguous", pointing at a file that no longer contained the bug.
--
-- Every function in this file is dropped before it is created, for the same
-- reason: a migration you cannot re-run is a migration you cannot correct.
drop function if exists public.create_org_invite(uuid, text, text);

create function public.create_org_invite(
  p_org uuid,
  p_email text,
  p_role text default 'member'
)
-- The OUT columns are prefixed rather than named id/token/expires_at.
--
-- `returns table (...)` declares each name as a plpgsql variable, so a bare
-- `expires_at` in the seat-count subquery below would be ambiguous between that
-- variable and org_invites.expires_at -- and Postgres raises that at CALL time,
-- not at CREATE time, so it would have shipped and failed on the first invite
-- anyone tried to send. src/db/team.ts reads these names.
returns table (invite_id uuid, invite_token text, invite_expires_at timestamptz)
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  uid       uuid := auth.uid();
  lim       int;
  used      int;
  addr      text := lower(trim(p_email));
  new_token text;
begin
  if uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  if not public.is_org_admin(p_org) then
    raise exception 'only an owner or admin can invite people'
      using errcode = '42501';
  end if;

  if addr = '' or addr not like '%_@_%.__%' then
    raise exception 'invalid_email' using errcode = 'check_violation';
  end if;

  if p_role not in ('admin', 'member') then
    raise exception 'invalid_role' using errcode = 'check_violation';
  end if;

  -- Nobody who is already here. Without this the invite is created, the person
  -- follows the link, and accept_org_invite refuses on the primary key -- which
  -- is a confusing way to learn they were already a colleague.
  if exists (
    select 1
      from public.org_members m
      join auth.users u on u.id = m.user_id
     where m.org_id = p_org and lower(u.email) = addr
  ) then
    raise exception 'already_a_member' using errcode = 'check_violation';
  end if;

  -- `for no key update` on the org row, matching enforce_seat_limit(), so two
  -- admins inviting at the same moment cannot both pass the check.
  --
  -- Every column below is alias-qualified. Renaming the OUT params was enough
  -- to make these unambiguous, but only by coincidence of what those params are
  -- now called -- and plpgsql reports that class of mistake at CALL time, so it
  -- ships. Qualifying makes it independent of the signature.
  select o.seat_limit into lim
    from public.organizations o
   where o.id = p_org
     for no key update;

  -- null is unlimited, the convention profile_limit and the seat trigger use.
  if lim is not null then
    select (select count(*) from public.org_members m where m.org_id = p_org)
         + (select count(*) from public.org_invites i
             where i.org_id = p_org and i.status = 'pending' and i.expires_at > now())
      into used;

    if used >= lim then
      raise exception 'seat_limit_reached'
        using errcode = 'check_violation',
              hint = 'Upgrade the plan or revoke a pending invite to add more people.';
    end if;
  end if;

  -- Generated here rather than accepted from the caller: a client-chosen token
  -- is a forgery surface, and this is the credential that grants access to the
  -- whole workspace.
  --
  -- Two uuids, dashes stripped: 64 hex characters, ~244 bits of randomness, and
  -- URL-safe by construction so it survives being pasted into a chat window.
  --
  -- NOT gen_random_bytes/encode, which was the obvious way to write this and is
  -- wrong here: gen_random_bytes belongs to pgcrypto, which Supabase installs
  -- into the `extensions` schema, and this function pins search_path to
  -- public+pg_temp. It would have resolved fine in the SQL editor and then
  -- failed with "function gen_random_bytes(integer) does not exist" the first
  -- time the app called it. gen_random_uuid() is in pg_catalog, so it needs no
  -- extension and no search_path widening.
  new_token := replace(gen_random_uuid()::text, '-', '') ||
               replace(gen_random_uuid()::text, '-', '');

  -- Supersede any earlier pending invite to the same address rather than
  -- colliding with the partial unique index. Re-inviting someone is a normal
  -- thing to do when the first link got lost.
  update public.org_invites
     set status = 'revoked'
   where org_id = p_org and lower(email) = addr and status = 'pending';

  return query
  insert into public.org_invites (org_id, email, role, token, invited_by)
       values (p_org, addr, p_role, new_token, uid)
    returning org_invites.id, org_invites.token, org_invites.expires_at;
end $function$;

-- Sanity: this must return one row with a token, not an "ambiguous column"
-- error. Replace the uuid with a real org you administer, then revoke it again
-- from the Team tab.
--   select * from public.create_org_invite('00000000-0000-0000-0000-000000000000',
--                                          'someone@example.com', 'member');


-- ── accept_org_invite ─────────────────────────────────────────────────────
-- The load-bearing one. org_members_insert is `with check is_org_admin(org_id)`,
-- so an invitee -- who is by definition not yet a member, let alone an admin --
-- can never insert their own membership row. This is the only path in.
--
-- Note it is NOT exempt from trg_seat_limit: SECURITY DEFINER bypasses RLS, not
-- triggers. So the database remains the real gate on the last seat even though
-- create_org_invite already reserved one, which is what makes a race between
-- two people accepting the final seat resolve correctly.
-- ── peek_org_invite ───────────────────────────────────────────────────────
-- What the /join page shows before you press the button: which workspace, what
-- role, and which address the invite was meant for.
--
-- This exists so that page needs NO service-role key. The first version read
-- org_invites with the admin client, because every policy on that table is
-- is_org_admin and an invitee cannot select their own invite — but that made a
-- page whose entire job is to welcome somebody depend on a production secret.
-- With SUPABASE_SERVICE_ROLE_KEY unset (as it is in local .env.local, and as it
-- would be on any preview deploy), a perfectly good invite rendered as "this
-- link isn't valid".
--
-- Revealing the org name and the target address to whoever holds a valid token
-- is not a leak: the token IS the credential, it was sent to that address, and
-- the person needs both facts to know whether they are in the right place. A
-- bad token returns no rows and therefore says nothing at all.
--
-- authenticated only. The page redirects to sign-in first, so anon never needs
-- it, and not granting it there means a scraper cannot probe tokens unauthenticated.
drop function if exists public.peek_org_invite(text);

create function public.peek_org_invite(p_token text)
returns table (
  org_name          text,
  invite_role       text,
  invite_status     text,
  invite_email      text,
  invite_expires_at timestamptz
)
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  -- Alias-qualified throughout, like every other function here: the OUT names
  -- above are plpgsql variables, and an unqualified column would be ambiguous
  -- at CALL time rather than at CREATE time.
  return query
  select o.name::text, i.role::text, i.status::text, i.email::text, i.expires_at
    from public.org_invites i
    join public.organizations o on o.id = i.org_id
   where i.token = p_token;
end $function$;

grant execute on function public.peek_org_invite(text) to authenticated;


drop function if exists public.accept_org_invite(text);

create function public.accept_org_invite(p_token text)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  uid    uuid := auth.uid();
  addr   text;
  invite public.org_invites%rowtype;
begin
  if uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  select lower(email) into addr from auth.users where id = uid;

  select * into invite
    from public.org_invites
   where token = p_token
     for update;

  if invite.id is null then
    raise exception 'invite_not_found' using errcode = 'check_violation';
  end if;
  if invite.status = 'accepted' then
    raise exception 'invite_already_accepted' using errcode = 'check_violation';
  end if;
  if invite.status = 'revoked' then
    raise exception 'invite_revoked' using errcode = 'check_violation';
  end if;
  if invite.expires_at <= now() then
    raise exception 'invite_expired' using errcode = 'check_violation';
  end if;

  -- The address check is what makes a leaked link inert. A token that reached
  -- the wrong inbox, or a group chat, is useless to anyone but the person it
  -- was issued to.
  if addr is null or addr <> lower(invite.email) then
    raise exception 'invite_wrong_account' using errcode = 'check_violation';
  end if;

  -- Idempotent for the case where someone was added by another route between
  -- the invite going out and the link being followed.
  if exists (
    select 1 from public.org_members
     where org_id = invite.org_id and user_id = uid
  ) then
    update public.org_invites
       set status = 'accepted', accepted_by = uid, accepted_at = now()
     where id = invite.id;
    return invite.org_id;
  end if;

  insert into public.org_members (org_id, user_id, role, invited_by)
       values (invite.org_id, uid, invite.role, invite.invited_by);

  update public.org_invites
     set status = 'accepted', accepted_by = uid, accepted_at = now()
   where id = invite.id;

  return invite.org_id;
end $function$;


-- ── org_members_with_identity ─────────────────────────────────────────────
-- The roster. org_members holds ids and nothing else, and Supabase does not
-- expose auth.users to clients, so a member list cannot be built by a join from
-- the launcher -- it would render a column of uuids.
--
-- A function rather than a public mirror of auth.users: no second copy to keep
-- in sync, and this exposes exactly the four identity fields the roster needs
-- to the people already entitled to see them. The metadata keys are the private
-- ones src/db/account.ts:17-18 writes, deliberately not the provider's own
-- avatar_url/full_name, which Google overwrites on every sign-in -- so the
-- precedence below has to mirror accountDisplayName()/accountAvatarUrl().
drop function if exists public.org_members_with_identity(uuid);

create function public.org_members_with_identity(p_org uuid)
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

  -- SUPERSEDED -- DO NOT COPY THIS QUERY. It has no `where m.org_id = p_org`,
  -- so the membership check above is decorative: pass it for any org you belong
  -- to and this returns every user of the product. Fixed 2026-08-09; see
  -- 2026-08-09-roster-leak-and-grants.sql for the version that is live.
  return query
  select m.user_id,
         u.email::text,
         coalesce(
           nullif(u.raw_user_meta_data ->> 'argus_display_name', ''),
           nullif(u.raw_user_meta_data ->> 'full_name', ''),
           nullif(u.raw_user_meta_data ->> 'name', ''),
           '')::text,
         coalesce(
           nullif(u.raw_user_meta_data ->> 'argus_avatar_url', ''),
           nullif(u.raw_user_meta_data ->> 'avatar_url', ''),
           nullif(u.raw_user_meta_data ->> 'picture', ''),
           '')::text,
         m.role,
         m.created_at,
         m.invited_by
    from public.org_members m
    join auth.users u on u.id = m.user_id
   order by m.created_at asc;
end $function$;


grant execute on function public.create_org_invite(uuid, text, text) to authenticated;
grant execute on function public.accept_org_invite(text) to authenticated;
grant execute on function public.org_members_with_identity(uuid) to authenticated;


-- ── created_by, made real ─────────────────────────────────────────────────
-- Both columns have existed all along and neither has ever been written: they
-- are in the explicit COLUMNS select lists (src/db/profiles.ts:8,
-- src/db/automations.ts:8) but no insert supplies them and no mapper reads
-- them. On a one-person org that costs nothing; on a team it is the difference
-- between a shared pool and an anonymous one.
--
-- A DEFAULT rather than a value written by the client, because it then cannot
-- be forged or forgotten, and it fixes every existing insert path at once --
-- the profile editor, the CSV importer, the clone action and the automation
-- bridge's profile patch -- without touching any of them.
alter table public.profiles    alter column created_by set default auth.uid();
alter table public.automations alter column created_by set default auth.uid();

-- Existing rows keep null and render as "—". Deliberately NOT backfilled to the
-- org owner: inventing an author for a row whose author is genuinely unknown is
-- the phantom data House Rule 6 forbids, and "—" is the honest answer.


-- ── apply_plan_entitlements ───────────────────────────────────────────────
-- Three files call this by name (landing/lib/entitlements.ts:31,
-- landing/lib/plans.ts:1-8, launcher/src/plans.ts:1-10) and it has never
-- existed, so applyPlanToOrg has always thrown at step 2 -- a paid upgrade set
-- organizations.plan and then failed. That is why no org has ever had its
-- seat_limit, profile_limit or automation_limit set by anything but hand.
--
-- WHICH NUMBERS THESE ARE. The site and this database disagree about plan
-- spellings (landing/LANDING.md:96-128), and reconciling that is deliberately
-- out of scope here. So this maps by what the SITE SELLS, because
-- applyPlanToOrg is the only caller and it writes the site's keys:
--
--     key          card label     price   profiles  seats  automations
--     free         Free           $0             5      1            2
--     base         Base           $89          100      1           10
--     pro          Team           $159         300     10           10
--     team         Enterprise     $299        1000     25          100
--
-- The database's own older vocabulary is mapped to its nearest equivalent so a
-- legacy row is never left on free defaults:
--     starter   -> base's shape but 60 profiles (the $10/60 tier)
--     enterprise-> team's shape with profile_limit null (unlimited)
--
-- Two deliberate choices worth keeping:
--
-- 1. free stays at 5 profiles, matching bootstrap_org and what trg_profile_limit
--    has always enforced -- NOT the 10 the site's card advertises. Fixing that
--    card is out of scope, and quietly doubling every free org's cap from a
--    migration is not the way to decide it.
--
-- 2. An unrecognised plan RAISES rather than falling through to free. A plan
--    string this function has never heard of means the mapping is stale, and
--    silently downgrading a paying customer to the free tier is the worst
--    possible way to report that.
drop function if exists public.apply_plan_entitlements(uuid, text);

create function public.apply_plan_entitlements(p_org uuid, p_plan text)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  p_profiles    int;
  p_seats       int;
  p_automations int;
begin
  case lower(trim(p_plan))
    when 'free'       then p_profiles :=    5; p_seats :=  1; p_automations :=   2;
    when 'starter'    then p_profiles :=   60; p_seats :=  1; p_automations :=   2;
    when 'base'       then p_profiles :=  100; p_seats :=  1; p_automations :=  10;
    when 'pro'        then p_profiles :=  300; p_seats := 10; p_automations :=  10;
    when 'team'       then p_profiles := 1000; p_seats := 25; p_automations := 100;
    when 'enterprise' then p_profiles := null; p_seats := 25; p_automations := 100;
    else
      raise exception 'unknown_plan: %', p_plan using errcode = 'check_violation';
  end case;

  update public.organizations o
     set profile_limit    = p_profiles,
         seat_limit       = p_seats,
         automation_limit = p_automations
   where o.id = p_org;

  if not found then
    raise exception 'organization_not_found' using errcode = 'check_violation';
  end if;
end $function$;

-- Service-role only. The whole point of the 0002 column grants is that a client
-- cannot raise its own caps, and a function that does it for them would undo
-- that in one line.
revoke execute on function public.apply_plan_entitlements(uuid, text) from authenticated, anon;
