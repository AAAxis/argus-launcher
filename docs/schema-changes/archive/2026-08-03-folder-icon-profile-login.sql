-- 2026-08-03 -- folder icons, and the account login a profile is signed into.
--
-- There is no supabase/migrations/ in this workspace and the Supabase CLI is not
-- installed, so this file is a record of a change applied by hand in the SQL
-- editor of project jpsmdjtxuxlkyuotwxfg -- not something a tool replays. Run it
-- once; it is idempotent.
--
-- Grants and RLS on these tables are table-level (see 0001_multitenant_core),
-- so the existing org_id policies cover the new columns with no policy change.

-- folders.icon -- a key into FOLDER_ICONS (src/data/folderIcons.ts), not a URL
-- or an SVG. An unknown key falls back to the plain folder glyph client-side,
-- so removing an icon from that map can never break a folder row.
alter table public.folders
add column if not exists icon text;

-- profiles.email / profiles.password -- the login for whatever account the
-- profile is signed into, matching MontiProfile.email/password in src/types.ts.
--
-- These are a bug fix, not a new feature: the profile editor has had "Account
-- email" and "Account password" inputs all along, but ProfileRow had no such
-- columns and the mappers never wrote them, so both fields were silently
-- discarded on save. Stored in plaintext, the same way proxies.password already
-- is -- there is no separate encrypted store in this app, and pretending one
-- column is protected when its neighbour is not would be worse than consistent.
alter table public.profiles
add column if not exists email text;

alter table public.profiles
add column if not exists password text;
