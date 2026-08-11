-- 2026-08-04 -- folders for proxies.
--
-- Same situation as the two files beside this one: there is no
-- supabase/migrations/ in this workspace and the Supabase CLI is not installed,
-- so this file is a record of a change applied by hand in the SQL editor of
-- project jpsmdjtxuxlkyuotwxfg -- not something a tool replays. Run it once; it
-- is idempotent.
--
-- Run it BEFORE shipping the build that expects these columns. src/db/folders.ts
-- and src/db/proxies.ts name their columns explicitly, so a select against a
-- database missing either one fails that whole table's read -- and because
-- useCloudData loads with Promise.allSettled, the symptom is "my folders and
-- proxies are gone" while the rows sit untouched in Postgres. That is exactly
-- what the folders.color migration did before it was applied.
--
-- Grants and RLS on both tables are table-level (see 0001_multitenant_core), so
-- the existing org_id policies cover the new columns with no policy change.

-- folders.kind -- 'profile' (what every existing row is, hence the default) or
-- 'proxy'. Reusing this table rather than adding a proxy_folders table is
-- deliberate: a new table would need its whole grant and policy set written by
-- hand, while a new column inherits the ones already on `folders`. The two
-- kinds are separate namespaces that happen to share storage -- the client
-- splits them apart on load and no UI ever mixes them.
alter table public.folders
add column if not exists kind text not null default 'profile';

-- proxies.folder_id -- exactly the shape profiles.folder_id already has, down
-- to ON DELETE SET NULL: deleting a folder must never delete what is in it, it
-- must drop its contents back into "All proxies".
--
-- `text`, not `uuid`. Ids in this schema are filesystem-safe strings rather
-- than real uuids -- a profile id doubles as its on-disk directory name under
-- MontiProfiles/<id>, which is what the *_id_fs_safe CHECKs are about -- so
-- folders.id is text and a uuid column here cannot reference it:
--   ERROR 42804: Key columns "folder_id" and "id" are of incompatible types.
--
-- Nothing here constrains a proxy to a kind = 'proxy' folder. The UI only ever
-- offers the right kind, and a CHECK cannot reach another table anyway -- a
-- trigger to enforce it would cost more than the mistake it prevents.
alter table public.proxies
add column if not exists folder_id text
  references public.folders(id) on delete set null;
