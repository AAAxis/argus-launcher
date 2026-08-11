-- Which site a profile's stored credentials are for.
--
-- profiles.email and profiles.password have been there since the baseline, and
-- nothing has ever recorded what they log into. That association lived only in
-- whoever created the profile's head, or implicitly in the CSS selector of an
-- automation's `type` step -- so a profile handed to a colleague carried a
-- username and a password with no way to say where they go.
--
-- Nullable text, and deliberately not a URL domain type or a CHECK: the field
-- takes whatever the start_urls column already takes, and a bare "example.com"
-- is what people type. The launcher validates it the same lenient way it
-- validates a start page (no whitespace) and no more -- see startUrlProblem in
-- src/tables/profileColumns.tsx.
--
-- No index. Nothing filters or joins on this; it is read with its row.
--
-- AFTER APPLYING THIS, REGENERATE THE TYPES:
--
--   supabase gen types typescript --linked --schema public > src/db/database.types.ts
--
-- src/db/database.types.ts is generated, but the three profiles blocks in it
-- were hand-edited to carry login_url when this migration was written -- the
-- drift guard in src/db/rows.schema-check.ts fails the build otherwise, and the
-- column could not be built against until the migration had been run. The
-- hand-written lines are exactly what the generator emits; regenerating is
-- confirmation, not a fix.
alter table public.profiles
  add column if not exists login_url text;

comment on column public.profiles.login_url is
  'The sign-in page the stored email/password belong to. Reference only -- the '
  'launcher never fills these in; an automation reads them as {{profile.login_url}}.';
