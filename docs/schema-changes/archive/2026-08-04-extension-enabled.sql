-- 2026-08-04 -- an on/off switch for each shared extension.
--
-- Same situation as the other files here: there is no supabase/migrations/ in
-- this workspace and the Supabase CLI is not installed, so this file is a
-- record of a change applied by hand in the SQL editor of project
-- jpsmdjtxuxlkyuotwxfg -- not something a tool replays. Run it once; it is
-- idempotent.
--
-- Grants and RLS on this table are table-level, so the existing org_id policies
-- cover the new column with no policy change.

-- shared_extensions.enabled -- whether profiles actually launch with this
-- extension. The three bundled extensions have had this switch since
-- built_in_extensions landed; store- and folder-shared ones were
-- install-or-delete, which made "keep it in the library but stop loading it"
-- impossible to express.
--
-- `not null default true` rather than nullable: every existing row is loading
-- into every profile today, so the migration must not change what any profile
-- launches with. The client still reads it as `enabled !== false` (see
-- rowToExtension in src/db/mappers.ts) because a client on the old build reads
-- a row that has no such column at all and must get the same answer.
alter table public.shared_extensions
add column if not exists enabled boolean not null default true;
