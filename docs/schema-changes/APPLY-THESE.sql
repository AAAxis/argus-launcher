-- Catch-up: every schema change this workspace has recorded but not applied.
--
-- Paste the whole file into the SQL editor of Supabase project
-- jpsmdjtxuxlkyuotwxfg and run it once. Every statement is
-- `add column if not exists`, so running it again is a no-op and running it
-- when some columns already exist is fine.
--
-- Why this file exists: the launcher names its columns explicitly in every
-- select (src/db/*.ts), so a column that is in the code but not in the database
-- fails that whole table's read. useCloudData loads with Promise.allSettled, so
-- the symptom is "my proxies and folders are gone" with a toast naming the
-- column -- the rows are untouched in Postgres, the read just never landed.
--
-- Grants and RLS on both tables are table-level (0001_multitenant_core), so the
-- existing org_id policies cover all of these with no policy change.

-- ── 2026-08-03 ────────────────────────────────────────────────────────────
-- folders.icon -- a key into FOLDER_ICONS (src/data/folderIcons.ts), or a
-- "flag:<ISO>" country key. Never a URL or an SVG; an unknown value falls back
-- to the plain folder glyph client-side.
alter table public.folders
add column if not exists icon text;

-- profiles.email / profiles.password -- the login for whatever account the
-- profile is signed into. The editor has had these inputs all along but the
-- columns never existed, so both were silently discarded on save.
alter table public.profiles
add column if not exists email text;

alter table public.profiles
add column if not exists password text;

-- ── 2026-08-04, folder colour ─────────────────────────────────────────────
-- folders.color -- a PROFILE_COLORS key or a #rrggbb, exactly like
-- profiles.color. Anything profileColorStyle() does not recognize downgrades to
-- the neutral accent rather than breaking the folder.
alter table public.folders
add column if not exists color text;

-- ── 2026-08-04, proxy folders ─────────────────────────────────────────────
-- folders.kind -- 'profile' (what every existing row is, hence the default) or
-- 'proxy'. Both libraries share this table; the client splits them on load.
alter table public.folders
add column if not exists kind text not null default 'profile';

-- proxies.folder_id -- the same shape profiles.folder_id has, down to
-- ON DELETE SET NULL: deleting a folder drops its proxies back into
-- "All proxies" rather than deleting them.
--
-- `text`, not `uuid`: ids in this schema are filesystem-safe strings (a profile
-- id is also its on-disk directory name), so folders.id is text and a uuid
-- column cannot reference it.
alter table public.proxies
add column if not exists folder_id text
  references public.folders(id) on delete set null;

-- ── 2026-08-04, cookie library ────────────────────────────────────────────
-- cookie_sets.folder_id -- the same shape and the same ON DELETE SET NULL the
-- other two folder_ids have, and `text` for the same reason: folders.id is
-- text, so a uuid column here cannot reference it.
--
-- folders.kind needs nothing new to gain a third value -- it has no CHECK, so
-- 'cookie' is a client-side widening only.
alter table public.cookie_sets
add column if not exists folder_id text
  references public.folders(id) on delete set null;

-- cookie_sets.tags -- the same text[] profiles.tags is, read through the same
-- tag catalog and capped by the same normalizeTags().
alter table public.cookie_sets
add column if not exists tags text[] not null default '{}'::text[];

-- cookie_sets.deleted_at -- the soft-delete stamp, same meaning and same
-- 30-day retention as profiles.deleted_at. Trashing a set also unassigns the
-- profiles using it, client-side: a trashed set that could still seed a launch
-- would be a lie.
alter table public.cookie_sets
add column if not exists deleted_at timestamptz;

-- Both the Trash sweep and the default view filter on (org_id, deleted_at).
create index if not exists cookie_sets_org_deleted_idx
on public.cookie_sets (org_id, deleted_at);

-- ── 2026-08-04, extension on/off ──────────────────────────────────────────
-- shared_extensions.enabled -- whether profiles actually launch with this
-- extension. Store- and folder-shared extensions were install-or-delete, so
-- "keep it in the library but stop loading it" could not be expressed.
--
-- `not null default true`, so the migration cannot change what any existing
-- profile launches with. The client still reads it as `enabled !== false`,
-- because a client on the old build sees no such column and has to reach the
-- same answer.
alter table public.shared_extensions
add column if not exists enabled boolean not null default true;

-- ── 2026-08-05, profile avatar ────────────────────────────────────────────
-- profiles.avatar -- what the Name column draws instead of the initials plate.
-- A tagged union in one text column, same shape as folders.icon: `brand:<slug>`
-- for a TAG_PRESETS brand mark, an https URL for an uploaded or pasted picture,
-- null for the initials. Anything unrecognized downgrades to the initials.
alter table public.profiles
add column if not exists avatar text;

-- ── 2026-08-05, automations ───────────────────────────────────────────────
-- NOT INLINED HERE. Run 2026-08-05-automations.sql next, as its own paste.
--
-- Everything above is `add column if not exists`, which is why it is safe to
-- keep one copy in each file. The automations change creates two tables, eight
-- policies and a trigger, so a second copy would be two things to keep in step
-- instead of one -- and it opens with a column-type check whose answer decides
-- what the rest of that file should say.
--
-- Run it after this file: profiles.automation_id references automations(id),
-- so the table has to exist first.

-- ── 2026-08-05, the two automations follow-ups ────────────────────────────
-- ALSO NOT INLINED HERE, and both run *after* 2026-08-05-automations.sql --
-- each touches something that file creates. In order:
--
--   1. 2026-08-05-automation-tags.sql
--      Adds automations.tags. Load-bearing, not cosmetic: src/db/automations.ts
--      names every column in its select, so without this column that table's
--      whole read fails, and useCloudData's Promise.allSettled turns it into
--      "my automations are gone" rather than an error pointing here. Apply it
--      before shipping a build that reads it.
--
--   2. 2026-08-05-free-tier-two-automations.sql
--      Moves organizations.automation_limit off 0 for free/starter, so the
--      feature is visible without paying. Read its header before running --
--      it flags that 'base' appears in the original 0-mapping while the site
--      sells it as a paid tier, and asks you to confirm the live key set
--      first.
--
--   3. 2026-08-05-teams.sql
--      org_invites, the three membership RPCs, created_by defaults, and the
--      apply_plan_entitlements function the website has always called and
--      never had. Deliberately NOT folded into this file: it opens with a
--      `drop table public.org_invites`, which would break the promise at the
--      top of this one that every statement here is a no-op on a second run.
--      Read its header before running -- it asks you to confirm org_invites
--      is still empty first, and it flags that applying it to the one live
--      org (plan 'team', seat_limit set by hand to 10) re-maps that org to 25
--      seats.
--
-- All three are safe to re-run EXCEPT the org_invites drop in (3); see above.

-- ── Check it worked ───────────────────────────────────────────────────────
-- Expect eleven rows: cookie_sets.deleted_at, cookie_sets.folder_id,
-- cookie_sets.tags, folders.color, folders.icon, folders.kind,
-- profiles.avatar, profiles.email, profiles.password, proxies.folder_id,
-- shared_extensions.enabled.
select table_name, column_name
from information_schema.columns
where table_schema = 'public'
  and (
    (table_name = 'folders' and column_name in ('icon', 'color', 'kind')) or
    (table_name = 'profiles' and column_name in ('avatar', 'email', 'password')) or
    (table_name = 'proxies' and column_name = 'folder_id') or
    (table_name = 'cookie_sets' and column_name in ('folder_id', 'tags', 'deleted_at')) or
    (table_name = 'shared_extensions' and column_name = 'enabled')
  )
order by table_name, column_name;
