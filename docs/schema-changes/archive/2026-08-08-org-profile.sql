-- 2026-08-08 -- who the workspace belongs to: solo or business, and the details.
--
-- Same situation as every file beside this one: there is no supabase/migrations/
-- in this workspace and the Supabase CLI is not installed, so this is a record
-- of a change applied by hand in the SQL editor of project jpsmdjtxuxlkyuotwxfg
-- -- not something a tool replays. Run it once; it is idempotent.
--
-- WHAT THIS CLOSES. Nothing has ever asked a customer who they are. bootstrap_org
-- creates an organization silently at first sign-in and names it from the signup
-- address, which is why the plan-welcome dialog greets people with "You've joined
-- gmail.com team". Nothing records whether a workspace is one freelancer or a
-- company, what country it is in, or what it is called -- so the answer to "who
-- is actually buying this" cannot be got from the database at all.
--
-- These columns are DESCRIPTIVE, not functional. Nothing gates on org_type and
-- nothing prices off country; the tiers stay exactly as they are. That is a
-- deliberate decision (owners', 2026-08-05) and worth keeping true -- the moment
-- a limit reads one of these columns, this stops being a profile and starts being
-- an entitlement, and it will need the service-role treatment plan and the limits
-- already get.
--
-- RUN IT BEFORE SHIPPING THE BUILD THAT READS THESE COLUMNS. Both apps name every
-- column explicitly in their selects (src/db/orgs.ts:24, landing/lib/ensure-org.ts:24),
-- so a column that is in the code but not in the database fails the whole
-- organizations read -- and useCloudData loads with Promise.allSettled, so the
-- symptom is a signed-in user staring at an empty workspace, not an error that
-- points here.


-- ── Check this first ──────────────────────────────────────────────────────
-- Everything below assumes organizations.id is uuid, the same assumption
-- 2026-08-05-automations.sql and 2026-08-05-teams.sql both document.
select data_type
from information_schema.columns
where table_schema = 'public'
  and table_name = 'organizations'
  and column_name = 'id';


-- ── The columns ───────────────────────────────────────────────────────────
-- All nullable. A workspace that predates this change has null everywhere and
-- renders as "—", which is the honest answer; there is deliberately no backfill,
-- because inventing a country or a company for an existing customer is exactly
-- the phantom data House Rule 6 forbids.

-- 'solo' or 'business'. Checked rather than free text: this is the one column
-- here that anything downstream will group by, and a column that can also hold
-- 'Business', 'BUSINESS' and 'sole trader' cannot be grouped by at all.
alter table public.organizations
add column if not exists org_type text;

-- The company's registered/trading name, kept SEPARATE from organizations.name.
--
-- They look like duplicates and are not. `name` is what this workspace is called
-- -- on a team that is often "Marketing" or "Client accounts", and an admin can
-- rename it whenever they like. `legal_name` is the business behind it, which
-- does not change when someone tidies up their workspace names and is the same
-- string across every workspace that business owns. Collapsing the two would make
-- the second question unanswerable the first time a customer renames anything.
--
-- Onboarding does write both on the way through -- see the note at the bottom.
alter table public.organizations
add column if not exists legal_name text;

-- ISO 3166-1 alpha-2, uppercase. Constrained for the same reason org_type is:
-- 'DE', 'de', 'Germany' and 'Deutschland' are four spellings of one fact, and a
-- column holding all four answers no question.
--
-- This is descriptive only. It is NOT tax-determination data and must not become
-- it: the Merchant of Record collects and remits VAT and is the party that needs
-- evidence of where a customer is, so a self-declared country typed into an
-- onboarding form has no tax weight and should never be given any.
alter table public.organizations
add column if not exists country text;

-- The company's public site, so a business claim can be sanity-checked by hand.
-- http as well as https: the point is to be able to look, and refusing to store
-- a customer's real address because it is not on https helps nobody.
alter table public.organizations
add column if not exists website text;

-- A public URL in the `global` bucket, written by the logo picker. Same shape and
-- the same bucket as a user avatar (src/db/account.ts:171), including the
-- timestamped object path -- a stable path is served from cache by URL alone, so
-- a replaced logo would keep rendering as the old one everywhere.
--
-- No new storage policy is needed: the four policies in supabase-migrations.sql
-- :36-63 are bucket-wide (`bucket_id = 'global'`) with no prefix restriction, so
-- an authenticated user can already write under org-logos/.
alter table public.organizations
add column if not exists logo_url text;

-- The gate, and the reason it is a timestamp rather than `org_type is not null`.
--
-- A solo user answers one question and skips the rest, so every other column here
-- is legitimately null for them. Gating on org_type would work today and break the
-- day someone is allowed to un-answer it; gating on "did we ask" is the thing we
-- actually mean, and it also records when -- which is what makes "how many signups
-- abandoned onboarding this week" answerable.
alter table public.organizations
add column if not exists onboarded_at timestamptz;


-- ── Constraints ───────────────────────────────────────────────────────────
-- Added separately from the columns above, and guarded, because `add column if
-- not exists` silently skips its inline constraints on a second run -- so a check
-- written inline would be absent on any database where the column already existed.
-- These blocks are re-runnable and say what they did.
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.organizations'::regclass
       and conname = 'organizations_org_type_check'
  ) then
    alter table public.organizations
      add constraint organizations_org_type_check
      check (org_type is null or org_type in ('solo', 'business'));
  end if;

  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.organizations'::regclass
       and conname = 'organizations_country_check'
  ) then
    alter table public.organizations
      add constraint organizations_country_check
      check (country is null or country ~ '^[A-Z]{2}$');
  end if;

  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.organizations'::regclass
       and conname = 'organizations_website_check'
  ) then
    alter table public.organizations
      add constraint organizations_website_check
      check (website is null or website ~* '^https?://.');
  end if;
end $$;

-- How many businesses, from where. The one query this whole file exists to make
-- possible, so it gets an index rather than a sequential scan over every org.
create index if not exists organizations_profile_idx
  on public.organizations (org_type, country);


-- ── The grant, which is the part that is easy to miss ─────────────────────
-- Without this the onboarding form saves nothing and reports success.
--
-- 0002 revoked UPDATE on organizations wholesale and re-granted it column by
-- column -- today just (name, built_in_extensions) -- precisely so that a client
-- cannot raise its own profile_limit or hand itself a paid plan. A new column is
-- therefore unwritable by anyone but the service role until it is named here.
--
-- RLS still applies on top: the UPDATE policy is is_org_admin, so a member of
-- someone else's workspace gains nothing from this grant. And because RLS filters
-- rows rather than erroring, the client must ask for the row back after writing
-- (the .select() idiom in src/db/orgs.ts:106-118) or a refusal arrives as
-- success-with-no-rows and the form appears to save.
--
-- onboarded_at is in the list on purpose. A user setting their own workspace's
-- flag early only means they skip a form about themselves; keeping it server-side
-- would need an RPC for no benefit.
grant update (org_type, legal_name, country, website, logo_url, onboarded_at)
  on public.organizations to authenticated;


-- ── peek_org_invite, widened ──────────────────────────────────────────────
-- So the /join page can show the invitee the company they are being invited to,
-- with its logo, instead of an auto-generated workspace name.
--
-- Dropped before it is created, not `create or replace`: that cannot change a
-- function's return type, and the column names in `returns table (...)` are part
-- of that type. 2026-08-05-teams.sql:154-163 records what happens otherwise --
-- the statement fails, the PREVIOUS version stays installed, and it then fails at
-- call time pointing at a file that no longer contains the bug.
--
-- Disclosure is unchanged in kind. This function already returns the org name and
-- the target address to whoever holds a valid token, on the reasoning that the
-- token IS the credential and it was sent to that address. A company name and a
-- public logo are the same class of fact -- less revealing, if anything, than the
-- email address already returned. A bad token still returns no rows and says
-- nothing at all.
--
-- Safe to run before the site reads the new columns: landing/app/join/[token]/
-- page.tsx casts the row to its own PeekRow type, so extra columns are ignored.
drop function if exists public.peek_org_invite(text);

create function public.peek_org_invite(p_token text)
returns table (
  org_name          text,
  org_legal_name    text,
  org_logo_url      text,
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

  -- Alias-qualified throughout, like every other function in this schema: the
  -- OUT names above are plpgsql variables, and an unqualified column would be
  -- ambiguous at CALL time rather than at CREATE time -- so it would ship.
  return query
  select o.name::text,
         o.legal_name::text,
         o.logo_url::text,
         i.role::text,
         i.status::text,
         i.email::text,
         i.expires_at
    from public.org_invites i
    join public.organizations o on o.id = i.org_id
   where i.token = p_token;
end $function$;

grant execute on function public.peek_org_invite(text) to authenticated;


-- ── A note on what onboarding writes ──────────────────────────────────────
-- No SQL here; this is the contract the two clients follow.
--
-- A business answer writes legal_name AND, when the workspace still carries the
-- name bootstrap_org gave it, copies that value into `name` as well. Both apps
-- already display `name` in a dozen places -- Settings, the Team roster, the
-- invite -- and rewiring all of them to fall back to legal_name would be a wide
-- change to fix a first-run default. Copying it once at the only moment we know
-- the name is still the automatic one is smaller and has the same effect.
--
-- After that the two are independent: renaming the workspace does not touch
-- legal_name, which is the entire reason they are separate columns.


-- ── Check it worked ───────────────────────────────────────────────────────
-- Expect six rows.
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name = 'organizations'
  and column_name in
      ('org_type', 'legal_name', 'country', 'website', 'logo_url', 'onboarded_at')
order by column_name;

-- Expect six rows, all privilege_type = 'UPDATE'. If this comes back empty the
-- grant did not land and every onboarding save will silently do nothing.
select column_name, privilege_type
from information_schema.column_privileges
where table_schema = 'public'
  and table_name = 'organizations'
  and grantee = 'authenticated'
  and privilege_type = 'UPDATE'
  and column_name in
      ('org_type', 'legal_name', 'country', 'website', 'logo_url', 'onboarded_at')
order by column_name;

-- Expect three rows.
select conname
from pg_constraint
where conrelid = 'public.organizations'::regclass
  and conname in ('organizations_org_type_check',
                  'organizations_country_check',
                  'organizations_website_check')
order by conname;

-- Expect seven columns, including org_legal_name and org_logo_url.
select p.proname, pg_get_function_result(p.oid) as returns
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'peek_org_invite';
