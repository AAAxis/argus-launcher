-- 2026-08-04 -- a colour for each folder.
--
-- Same situation as 2026-08-03: there is no supabase/migrations/ in this
-- workspace and the Supabase CLI is not installed, so this file is a record of
-- a change applied by hand in the SQL editor of project jpsmdjtxuxlkyuotwxfg --
-- not something a tool replays. Run it once; it is idempotent.
--
-- Grants and RLS on this table are table-level (see 0001_multitenant_core), so
-- the existing org_id policies cover the new column with no policy change.

-- folders.color -- one of the six keys in PROFILE_COLORS (src/lib/profileColors.ts)
-- or a #rrggbb the user picked by hand, exactly like profiles.color already
-- holds. Not a token name and not CSS: profileColorStyle() resolves a key to
-- the --profile-* triple for the current theme, and anything it does not
-- recognize falls back to the neutral accent, so an unknown value can only ever
-- downgrade a folder rather than break it.
alter table public.folders
add column if not exists color text;
