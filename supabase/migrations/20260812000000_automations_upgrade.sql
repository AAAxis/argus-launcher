-- Automations upgrade: identity, status, attribution, schedules, stars,
-- personal Telegram. Spec: docs/superpowers/specs/2026-08-09-automations-upgrade-design.md
--
-- Everything here is additive. Nothing in the renderer selects the new columns
-- until this is applied -- a missing column fails the whole table's select and
-- the workspace degrades that table to [] (the folders.color incident).

-- ---------------------------------------------------------------------------
-- automations: identity, denormalized last run, attribution, schedule
-- ---------------------------------------------------------------------------

-- Card identity. `icon` is the profile-avatar grammar: 'brand:<slug>' where the
-- slug names an entry in src/data/tagPresets.ts, or null for the default
-- workflow glyph. No uploads -- the curated set is what keeps MCP able to set
-- an icon by name. `color` is a ProfileColorKey ('slate'|'blue'|...) or a
-- '#rrggbb' literal, tinting the icon plate.
alter table public.automations add column if not exists icon text;
alter table public.automations add column if not exists color text;

-- Denormalized verdict of the newest finished run, written by the renderer on
-- the same path that seals the run row (recordRunOutcome in
-- src/db/automations.ts, guarded by last_run_at < finished_at so a stale
-- disk-buffered flush cannot regress a newer verdict). REPORTED, never
-- recomputed -- automation_runs holds the truth; these exist so the card can
-- show a status without reading the runs table per automation per render.
alter table public.automations add column if not exists last_run_at timestamptz;
alter table public.automations add column if not exists last_run_status text;

-- Attribution. created_by (uuid, default auth.uid()) already exists on this
-- table. created_via distinguishes a human save from an agent authoring over
-- MCP; created_by_label carries the agent/key name for the mcp case, because
-- the uuid behind an MCP write is whichever human's launcher answered, which
-- is exactly the misattribution this column corrects.
alter table public.automations add column if not exists created_via text not null default 'user';
alter table public.automations drop constraint if exists automations_created_via_check;
alter table public.automations add constraint automations_created_via_check
  check (created_via in ('user', 'mcp'));
alter table public.automations add column if not exists created_by_label text;

-- Who last saved. Maintained by trigger rather than by the mappers because the
-- mappers are pure and have no auth context -- the same reasoning that put
-- `default auth.uid()` on created_by.
alter table public.automations add column if not exists updated_by uuid
  references auth.users (id) on delete set null;

create or replace function public.set_automation_updated_by()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  new.updated_by := auth.uid();
  return new;
end;
$$;

drop trigger if exists trg_automation_updated_by on public.automations;
create trigger trg_automation_updated_by
  before update on public.automations
  for each row execute function public.set_automation_updated_by();

-- The schedule document, null when the automation has none. Shape (validated
-- in src/automations/schedule.ts, the only writer):
--   {enabled, kind: 'interval'|'daily'|'weekly',
--    everyMinutes?, at? 'HH:MM', days? int[], profileIds: text[]}
-- A jsonb column rather than a table: one schedule per automation, edited only
-- in the automation modal, read only by the renderer's scheduler tick.
alter table public.automations add column if not exists schedule jsonb;

-- ---------------------------------------------------------------------------
-- automation_stars: per-user favourites (the notification_reads pattern)
-- ---------------------------------------------------------------------------
--
-- A row per (automation, user), insert/delete only -- never a starred_by[]
-- array on automations, for the same reason notification_reads is not a
-- read_by[] array: two people starring at once must not read-modify-write the
-- same value. org_id rides along so the workspace load can filter on it
-- (rule 1 in src/db/index.ts) without joining automations.
create table if not exists public.automation_stars (
  org_id        uuid not null references public.organizations (id) on delete cascade,
  automation_id text not null references public.automations (id) on delete cascade,
  user_id       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  starred_at    timestamptz not null default now(),
  primary key (automation_id, user_id)
);

alter table public.automation_stars enable row level security;

revoke all on public.automation_stars from anon, authenticated;
grant select, insert, delete on public.automation_stars to authenticated;
grant all on public.automation_stars to service_role;

create index if not exists automation_stars_org_user_idx
  on public.automation_stars (org_id, user_id);

-- Only ever about yourself, in all three directions -- a star is an opinion,
-- not workspace data.
create policy "own automation stars"
  on public.automation_stars for select to authenticated
  using (user_id = auth.uid());

create policy "star own automations"
  on public.automation_stars for insert to authenticated
  with check (user_id = auth.uid() and public.is_org_member(org_id));

create policy "unstar own automations"
  on public.automation_stars for delete to authenticated
  using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- automation_telegram_prefs: per-user, per-automation personal notifications
-- ---------------------------------------------------------------------------
--
-- Independent of automations.notify_on (the org-connector path): this is "I,
-- personally, want a Telegram message about this automation", and it follows
-- the same shouldNotify semantics ('failure' includes partial; cancelled never
-- sends).
create table if not exists public.automation_telegram_prefs (
  org_id        uuid not null references public.organizations (id) on delete cascade,
  automation_id text not null references public.automations (id) on delete cascade,
  user_id       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  notify_on     text not null,
  primary key (automation_id, user_id),
  constraint telegram_prefs_notify_on_check check (notify_on in ('always', 'failure'))
);

alter table public.automation_telegram_prefs enable row level security;

revoke all on public.automation_telegram_prefs from anon, authenticated;
grant select, insert, update, delete on public.automation_telegram_prefs to authenticated;
grant all on public.automation_telegram_prefs to service_role;

create index if not exists automation_telegram_prefs_org_user_idx
  on public.automation_telegram_prefs (org_id, user_id);

create policy "own telegram prefs"
  on public.automation_telegram_prefs for select to authenticated
  using (user_id = auth.uid());

create policy "set own telegram prefs"
  on public.automation_telegram_prefs for insert to authenticated
  with check (user_id = auth.uid() and public.is_org_member(org_id));

create policy "update own telegram prefs"
  on public.automation_telegram_prefs for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "clear own telegram prefs"
  on public.automation_telegram_prefs for delete to authenticated
  using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- user_telegram: the linked chat, one row per user
-- ---------------------------------------------------------------------------
--
-- NOTE: this file is preserved as APPLIED (2026-08-09, the landing-webhook
-- design). The local-linking rework -- org bot columns, launcher-writable
-- user_telegram, dropping telegram_link_codes -- lives in
-- 20260813000000_telegram_local_link.sql. Do not edit this file again; it has
-- run.
create table if not exists public.user_telegram (
  user_id           uuid primary key references auth.users (id) on delete cascade,
  chat_id           text not null,
  telegram_username text,
  linked_at         timestamptz not null default now()
);

alter table public.user_telegram enable row level security;

revoke all on public.user_telegram from anon, authenticated;
grant select, delete on public.user_telegram to authenticated;
grant all on public.user_telegram to service_role;

create policy "read own telegram link"
  on public.user_telegram for select to authenticated
  using (user_id = auth.uid());

create policy "unlink own telegram"
  on public.user_telegram for delete to authenticated
  using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- telegram_link_codes: one-time deep-link codes (dropped by 20260813)
-- ---------------------------------------------------------------------------
create table if not exists public.telegram_link_codes (
  code       text primary key,
  user_id    uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.telegram_link_codes enable row level security;

revoke all on public.telegram_link_codes from anon, authenticated;
grant all on public.telegram_link_codes to service_role;
