-- 2026-08-05 -- the picture a profile shows in the Name column.
--
-- There is no supabase/migrations/ in this workspace and the Supabase CLI is not
-- installed, so this file is a record of a change applied by hand in the SQL
-- editor of project jpsmdjtxuxlkyuotwxfg -- not something a tool replays. Run it
-- once; it is idempotent.
--
-- Grants and RLS on these tables are table-level (see 0001_multitenant_core),
-- so the existing org_id policies cover the new column with no policy change.

-- profiles.avatar -- one text column carrying a tagged union, the same shape
-- folders.icon already uses for `flag:US` alongside its FOLDER_ICONS keys:
--
--   'brand:<slug>'  a slug from TAG_PRESETS (src/data/tagPresets.ts), drawn as
--                   that brand's own mark -- instagram, facebook, x, tiktok, …
--   'https://…'     a picture, uploaded to the `global` storage bucket under
--                   profile-avatars/<org id>/<profile id>/<ms>.<ext>, or pasted
--   null            the initials-on-colour plate every profile had before this
--
-- Never markup, never a data: URI. Anything the client does not recognize
-- downgrades to the initials plate, so dropping a brand from the catalog costs
-- a profile its logo instead of breaking the row.
--
-- Two columns were considered (avatar_kind + avatar_value) and rejected for the
-- reason folders.icon is one column: a second column can disagree with the
-- first, and there is no state where the pair means more than the prefix does.
alter table public.profiles
add column if not exists avatar text;
