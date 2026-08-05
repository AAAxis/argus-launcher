-- 2026-08-04 -- the cookie library grows folders, tags and a trash.
--
-- Same situation as the three files beside this one: there is no
-- supabase/migrations/ in this workspace and the Supabase CLI is not installed,
-- so this file is a record of a change applied by hand in the SQL editor of
-- project jpsmdjtxuxlkyuotwxfg -- not something a tool replays. Run it once; it
-- is idempotent.
--
-- Run it BEFORE shipping the build that expects these columns. src/db/
-- cookieSets.ts names its columns explicitly, so a select against a database
-- missing any one of them fails that whole table's read -- and because
-- useCloudData loads with Promise.allSettled, the symptom is "my cookie-sets
-- are gone" while the rows sit untouched in Postgres. That is exactly what the
-- folders.color migration did before it was applied.
--
-- Grants and RLS on this table are table-level (see 0001_multitenant_core), so
-- the existing org_id policies cover the new columns with no policy change.
--
-- Note what is NOT here: folders.kind needs no change to gain a third value.
-- It is `text not null default 'profile'` with no CHECK (see
-- 2026-08-04-proxy-folders.sql), so 'cookie' is a widening of the union in
-- src/types.ts and nothing else. A cookie folder is a folder.

-- cookie_sets.folder_id -- exactly the shape profiles.folder_id and
-- proxies.folder_id already have, down to ON DELETE SET NULL: deleting a folder
-- must never delete what is in it, it must drop its contents back into
-- "All cookie-sets".
--
-- `text`, not `uuid`, for the same reason proxies.folder_id is text: ids in
-- this schema are filesystem-safe strings rather than real uuids, so folders.id
-- is text and a uuid column here cannot reference it --
--   ERROR 42804: Key columns "folder_id" and "id" are of incompatible types.
--
-- Nothing here constrains a cookie-set to a kind = 'cookie' folder. The UI only
-- ever offers the right kind, and a CHECK cannot reach another table anyway.
alter table public.cookie_sets
add column if not exists folder_id text
  references public.folders(id) on delete set null;

-- cookie_sets.tags -- the same free-text text[] profiles.tags is, read through
-- the same tagKey()/tagPresetFor() catalog in src/lib/tags.ts and capped at
-- MAX_PROFILE_TAGS by the same normalizeTags(). Deliberately the same column
-- type and the same vocabulary rather than a cookie-specific one: a set tagged
-- "instagram" and a profile tagged "Instagram" are the same idea, and the
-- shared brand catalog is what makes them render alike.
--
-- Defaulted rather than nullable so array length and containment never have to
-- guard for null. The client still types it nullable (src/db/rows.ts) so a read
-- that predates this migration maps cleanly instead of to undefined behaviour.
alter table public.cookie_sets
add column if not exists tags text[] not null default '{}'::text[];

-- cookie_sets.deleted_at -- the soft-delete stamp, identical in meaning and
-- retention (30 days, TRASH_RETENTION_DAYS in src/lib/trash.ts) to
-- profiles.deleted_at. Nullable with no default: a row that has never been
-- trashed carries null, and the Trash view is `deleted_at is not null`.
--
-- Soft-deleting a set deliberately does NOT lean on any FK -- the row still
-- exists, so profiles.cookie_set_id would still resolve. The client unassigns
-- referencing profiles explicitly when a set is trashed (useCookieActions.
-- softDelete), because a trashed set that could still seed a browser launch
-- would be a lie.
alter table public.cookie_sets
add column if not exists deleted_at timestamptz;

-- The Trash sweep on every load is `delete ... where deleted_at < cutoff` and
-- the tab's default view is `deleted_at is null`; both are org-scoped, so the
-- useful index is the pair. Cheap on a table this size -- it exists so the
-- sweep does not seq-scan once a workspace has thousands of sets.
create index if not exists cookie_sets_org_deleted_idx
on public.cookie_sets (org_id, deleted_at);

-- cookie_sets.cookies already exists (docs/supabase-migrations.sql) and has
-- always been '[]'. Nothing to add here -- but from this build on it is
-- written: the parsed cookie array lands there so the inspector can open a set
-- without a Storage round trip, and an edit is one row update.
--
-- source_url keeps being written alongside it and stays the source of truth for
-- a launch, because electron/main.cjs fetches that URL and has no Supabase
-- credentials of its own (by design -- see the comment on uploadCookieFile).
-- The two must never disagree: every write path updates cookies, count and
-- source_url together.

-- ── Check it worked ───────────────────────────────────────────────────────
-- Expect three rows: cookie_sets.deleted_at, cookie_sets.folder_id,
-- cookie_sets.tags.
select table_name, column_name, data_type
from information_schema.columns
where table_schema = 'public'
  and table_name = 'cookie_sets'
  and column_name in ('folder_id', 'tags', 'deleted_at')
order by column_name;
