-- 2026-08-05 -- automations: workflows, attachment, run history, entitlement.
--
-- Same situation as the files beside this one: there is no supabase/migrations/
-- in this workspace and the Supabase CLI is not installed, so this file is a
-- record of a change applied by hand in the SQL editor of project
-- jpsmdjtxuxlkyuotwxfg -- not something a tool replays. Run it once; it is
-- idempotent.
--
-- RUN IT BEFORE SHIPPING THE BUILD THAT EXPECTS THESE COLUMNS. src/db/profiles.ts
-- names its columns explicitly in COLUMNS, so a select against a database
-- missing automation_id fails the WHOLE profiles read -- and because
-- useCloudData loads with Promise.allSettled, the symptom is "all my profiles
-- are gone" while the rows sit untouched in Postgres. That is exactly what the
-- folders.color migration did before it was applied.

-- ── Check this first ──────────────────────────────────────────────────────
-- Everything below assumes organizations.id is uuid. If it is text, every
-- org_id declared uuid here fails with
--   ERROR 42804: Key columns "org_id" and "id" are of incompatible types
-- which is the same failure 2026-08-04-proxy-folders.sql documents for
-- folder_id. Run this by itself, and if it says text, replace `org_id uuid`
-- with `org_id text` in both tables below before running the rest.
select data_type
from information_schema.columns
where table_schema = 'public'
  and table_name = 'organizations'
  and column_name = 'id';

-- ── automations ───────────────────────────────────────────────────────────
-- A workflow: an ordered list of steps run against one profile's browser over
-- CDP. `steps` is AutomationStep[] exactly as src/automations/types.ts
-- serializes it, validated client-side against electron/automation/step-schema.json.
--
-- id is text, not uuid, for the same reason profiles.id and folders.id are:
-- ids in this schema are filesystem-safe strings (a run's artifacts live under
-- <userData>/AutomationRuns/<id>), and a uuid column here could not be
-- referenced from profiles.automation_id, which must be text to match.
--
-- jsonb rather than json for `steps`: it is the column a later index on step
-- types would have to reach into, and it normalizes key order so two saves of
-- the same workflow compare equal.
create table if not exists public.automations (
  id              text primary key,
  org_id          uuid not null references public.organizations(id) on delete cascade,
  name            text not null,
  description     text,
  steps           jsonb not null default '[]'::jsonb,
  -- Default variables every run starts with. A run may override per key.
  variables       jsonb not null default '{}'::jsonb,
  -- Offers itself as a tile on every generated browser start page. Org-wide
  -- rather than per-profile: the profile's own attachment is the one-per-profile
  -- slot, and pins are the many-to-many case that would otherwise need a join
  -- table. If per-profile tile sets are ever wanted, that join table is the
  -- upgrade path and this column is what it replaces.
  pinned          boolean not null default false,
  -- Runner policy as columns rather than inside `steps`, so the list view can
  -- show them without parsing the payload.
  timeout_ms      integer not null default 300000,
  close_on_finish boolean not null default false,
  created_by      uuid,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  -- The same shape as profiles_id_fs_safe: this id becomes a directory name.
  constraint automations_id_fs_safe check (id ~ '^[A-Za-z0-9._-]{1,64}$')
);

create index if not exists automations_org_idx on public.automations (org_id);

alter table public.automations enable row level security;

-- Mirrors the policy set 0001_multitenant_core put on profiles. is_org_member
-- and is_org_admin are the predicates that file defines; is_org_member is the
-- one every per-org table reads through (see the note in src/db/orgs.ts).
drop policy if exists "org members read automations" on public.automations;
create policy "org members read automations" on public.automations
  for select to authenticated using (public.is_org_member(org_id));

drop policy if exists "org members insert automations" on public.automations;
create policy "org members insert automations" on public.automations
  for insert to authenticated with check (public.is_org_member(org_id));

drop policy if exists "org members update automations" on public.automations;
create policy "org members update automations" on public.automations
  for update to authenticated using (public.is_org_member(org_id))
                              with check (public.is_org_member(org_id));

drop policy if exists "org members delete automations" on public.automations;
create policy "org members delete automations" on public.automations
  for delete to authenticated using (public.is_org_member(org_id));

-- ── attachment ────────────────────────────────────────────────────────────
-- Which automation runs when this profile launches. One per profile, on
-- purpose: the on-launch trigger fires exactly once, so "what runs when I click
-- Launch" must have exactly one answer -- the same argument profiles.cookie_set_id
-- is built on, and the reason neither has a join table.
--
-- ON DELETE SET NULL for the same reason folder_id has it: deleting the
-- automation must detach the profiles using it, never delete them.
alter table public.profiles
add column if not exists automation_id text
  references public.automations(id) on delete set null;

-- ── run history ───────────────────────────────────────────────────────────
-- One row per run, started when the run starts so a crash still leaves a
-- record. The runner also writes run.json to disk on every status transition
-- and flushes it here on next launch, which is what makes history honest when
-- the window was closed mid-run rather than merely best-effort.
create table if not exists public.automation_runs (
  id              text primary key,
  org_id          uuid not null references public.organizations(id) on delete cascade,
  automation_id   text references public.automations(id) on delete set null,
  -- Denormalized so a run still reads after its automation is deleted. This is
  -- why automations do not need a soft delete.
  automation_name text not null default '',
  profile_id      text,
  profile_name    text not null default '',
  -- manual | launch | start-page | mcp | api
  trigger         text not null default 'manual',
  -- running | ok | partial | failed | cancelled.
  -- `partial` is its own status rather than folded into ok: a run where a step
  -- failed under onError:'continue' did not do what it says on the tin, and
  -- calling that ok is how "half of it silently didn't work" hides.
  status          text not null default 'running',
  started_at      timestamptz not null default now(),
  finished_at     timestamptz,
  duration_ms     integer,
  step_count      integer not null default 0,
  failed_step_id  text,
  error           text,
  -- Where `extract` output lands. This column is the only reason the extract
  -- step is not phantom data.
  vars            jsonb not null default '{}'::jsonb,
  -- Capped at 2000 entries / 256 KB by the runner before insert. A 1000-
  -- iteration loop would otherwise write a jsonb column nobody can read.
  -- Screenshots are filenames on disk, never base64 -- see
  -- monti_monitoring_results.screenshot_base64 for why not.
  log             jsonb not null default '[]'::jsonb,
  created_at      timestamptz not null default now()
);

create index if not exists automation_runs_org_started_idx
  on public.automation_runs (org_id, started_at desc);
create index if not exists automation_runs_automation_idx
  on public.automation_runs (automation_id, started_at desc);

alter table public.automation_runs enable row level security;

drop policy if exists "org members read runs" on public.automation_runs;
create policy "org members read runs" on public.automation_runs
  for select to authenticated using (public.is_org_member(org_id));

drop policy if exists "org members insert runs" on public.automation_runs;
create policy "org members insert runs" on public.automation_runs
  for insert to authenticated with check (public.is_org_member(org_id));

drop policy if exists "org members update runs" on public.automation_runs;
create policy "org members update runs" on public.automation_runs
  for update to authenticated using (public.is_org_member(org_id))
                                with check (public.is_org_member(org_id));

drop policy if exists "org members delete runs" on public.automation_runs;
create policy "org members delete runs" on public.automation_runs
  for delete to authenticated using (public.is_org_member(org_id));

-- ── entitlement ───────────────────────────────────────────────────────────
-- The plan-level cap on saved automations. A column on organizations, exactly
-- like profile_limit -- deliberately NOT a lookup on organizations.plan.
--
-- landing/LANDING.md:96-128 records that the site and the database disagree
-- about plan keys (the site says free|base|pro|team, the database says
-- free|starter|base|team|enterprise). Reading an integer column means the
-- launcher never has to know which spelling is live, so that bug cannot reach
-- the gate. It touches only the one-time backfill below.
--
-- null means unlimited, the same convention profile_limit uses.
--
-- 0002 revoked client UPDATE on organizations and re-granted it for
-- (name, built_in_extensions) only, so this column is service-role only and an
-- org cannot raise its own cap. Nothing further to grant.
-- Superseded by 2026-08-05-free-tier-two-automations.sql, which moves the
-- default to 2 and lifts existing free orgs off 0. Left as it shipped -- this
-- file is the record of what was applied, not the current intent.
alter table public.organizations
add column if not exists automation_limit integer default 0;

-- Backfill. !! CONFIRM WHICH KEY SET IS LIVE BEFORE RUNNING !!
--   select distinct plan from public.organizations;
-- The CASE below covers both spellings so it is correct either way. Delete the
-- half that does not apply rather than leaving a mapping for a key that cannot
-- exist -- a dead branch here reads as though both key sets are supported.
update public.organizations set automation_limit = case plan
  when 'free'       then 0
  when 'starter'    then 0
  when 'base'       then 0
  when 'pro'        then 10     -- site key, sold as "Team" at $159
  when 'team'       then 10     -- db key, the $159/300-profile tier
  when 'enterprise' then 100
  else 0
end
where automation_limit is null or automation_limit = 0;

-- Enforced in the database, not only in the client -- the same belt-and-braces
-- trg_profile_limit already gives profiles.
create or replace function public.enforce_automation_limit()
returns trigger language plpgsql security definer
set search_path = public as $$
declare
  cap integer;
  used integer;
begin
  select automation_limit into cap from public.organizations where id = new.org_id;
  if cap is null then
    return new;                       -- unlimited
  end if;
  select count(*) into used from public.automations where org_id = new.org_id;
  if used >= cap then
    raise exception 'automation_limit_reached' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

-- BEFORE INSERT, which is why src/db/automations.ts splits create/replace and
-- never upserts: Postgres fires BEFORE INSERT triggers for
-- `insert ... on conflict do update` even when the conflict path is taken, so
-- an upsert used to EDIT an automation would raise automation_limit_reached
-- whenever the org is at its cap. That is the bug src/db/profiles.ts:27-40
-- documents for profiles; do not reintroduce it here.
drop trigger if exists trg_automation_limit on public.automations;
create trigger trg_automation_limit
before insert on public.automations
for each row execute function public.enforce_automation_limit();

-- ── Check it worked ───────────────────────────────────────────────────────
-- Expect three rows: automations (table), automation_runs (table),
-- organizations.automation_limit and profiles.automation_id (columns).
select 'table' as kind, table_name as name, '' as column_name
from information_schema.tables
where table_schema = 'public' and table_name in ('automations', 'automation_runs')
union all
select 'column', table_name, column_name
from information_schema.columns
where table_schema = 'public'
  and (
    (table_name = 'profiles' and column_name = 'automation_id') or
    (table_name = 'organizations' and column_name = 'automation_limit')
  )
order by kind, name;
