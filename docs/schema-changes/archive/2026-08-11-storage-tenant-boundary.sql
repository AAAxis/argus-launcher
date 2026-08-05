-- 2026-08-11 -- the `global` bucket had no tenant boundary. APPLIED ALREADY.
--
-- Unlike every other file here, this one was not pasted into the SQL editor by
-- hand -- it was applied through the Management API on 2026-08-11 and is
-- recorded here afterwards, because the hole was live and enumerable. Re-running
-- it is a no-op.
--
-- WHAT WAS WRONG. All four policies on storage.objects had exactly one
-- predicate: `bucket_id = 'global'`. No path check, no org, no owner. Combined
-- with the bucket being public, that meant:
--
--   1. SELECT was granted to `anon`. The anon key ships inside the launcher
--      bundle, so anyone could `storage.from('global').list('profile-cookies')`
--      and enumerate every object in the bucket across every tenant -- and a
--      public bucket serves each of those over plain HTTPS with no auth. The
--      bucket holds `profile-cookies/<id>/<ts>-*.json`, which are the session
--      cookies a customer's profiles are signed in with. Unguessable object
--      URLs were the only protection, and a listable bucket removes the
--      "unguessable".
--
--   2. INSERT/UPDATE/DELETE were granted to every authenticated user with the
--      same bucket-only predicate, so anyone who signed up for a free account
--      could overwrite or delete any other tenant's cookie jars, avatars, org
--      logos and shared extension zips.
--
-- Found by an audit on 2026-08-11, after 2026-08-09 closed the equivalent hole
-- in the Postgres layer. The lesson is that `storage.objects` is a table like
-- any other and needs the same tenant predicate the rest of the schema has --
-- it was the one place the org id never appeared.


-- ── 1. Stop anon enumerating ──────────────────────────────────────────────
-- `to authenticated` instead of `to anon, authenticated`.
--
-- The bucket deliberately STAYS public, so /object/public/<bucket>/<path>
-- downloads are unaffected -- electron/main.cjs consumes cookie files by public
-- URL and holds no Supabase credentials of its own (src/db/cookieSets.ts:205,
-- :226), so flipping the bucket private here would break cookie injection at
-- launch for every customer. That is section 3 below, and it needs a code
-- change rather than a policy.
--
-- This does not make the cookies private. It makes them un-enumerable, which is
-- the difference between "an attacker needs a URL you gave them" and "an
-- attacker asks for the list".
drop policy if exists "shared extensions are readable" on storage.objects;
create policy "global bucket is listable by signed-in users"
on storage.objects for select to authenticated
using (bucket_id = 'global');


-- ── 2. A tenant boundary on writes ────────────────────────────────────────
-- Two ways to qualify, because the object paths are not uniformly org-keyed:
--
--   avatars/<user id>/<ts>.<ext>                    -- the user's own
--   org-logos/<org id>/<ts>.<ext>                   -- org-keyed
--   profile-avatars/<org id>/<profile id>/<ts>.<ext> -- org-keyed
--   profile-cookies/<profile or cookie-set id>/<ts>-<name>
--   shared-extensions/<extension id>.zip
--
-- The last two carry no org in the path, so they qualify on `owner` -- the
-- uploader -- rather than on membership. The consequence, stated plainly: a
-- teammate can no longer replace a cookie file or an extension zip that a
-- DIFFERENT teammate uploaded. That degrades rather than breaks;
-- isStorageNotWritable() (src/db/cookieSets.ts:274) already treats an RLS
-- refusal as "bucket not writable" and falls back to an inline data: URL, which
-- is the same path a missing bucket takes.
--
-- INSERT is left permissive on purpose. Cookie files are uploaded BEFORE the
-- row that will reference them exists -- cloudCookieFromSelection is called with
-- "a fresh cookie-set id for the shared library" (src/lib/cookieUpload.ts:9-10)
-- -- so an insert policy that joined back to cookie_sets would refuse the very
-- first write of every import. Creating a new object at a fresh path harms no
-- other tenant; replacing and deleting are what do.
drop policy if exists "authenticated users can update shared extensions" on storage.objects;
drop policy if exists "authenticated users can delete shared extensions" on storage.objects;

create policy "global bucket updates are tenant scoped"
on storage.objects for update to authenticated
using (
  bucket_id = 'global' and (
    owner = auth.uid()
    or ( (storage.foldername(name))[1] in ('org-logos','profile-avatars')
         and (storage.foldername(name))[2] ~ '^[0-9a-fA-F-]{36}$'
         and public.is_org_member(((storage.foldername(name))[2])::uuid) )
  )
)
with check (
  bucket_id = 'global' and (
    owner = auth.uid()
    or ( (storage.foldername(name))[1] in ('org-logos','profile-avatars')
         and (storage.foldername(name))[2] ~ '^[0-9a-fA-F-]{36}$'
         and public.is_org_member(((storage.foldername(name))[2])::uuid) )
  )
);

create policy "global bucket deletes are tenant scoped"
on storage.objects for delete to authenticated
using (
  bucket_id = 'global' and (
    owner = auth.uid()
    or ( (storage.foldername(name))[1] in ('org-logos','profile-avatars')
         and (storage.foldername(name))[2] ~ '^[0-9a-fA-F-]{36}$'
         and public.is_org_member(((storage.foldername(name))[2])::uuid) )
  )
);


-- ── 3. STILL OPEN: cookies live in a public bucket ────────────────────────
-- NOT FIXED HERE, and the reason is a code dependency rather than a policy one.
--
-- `public = true` means /object/public/global/<path> serves any object to anyone
-- who has the URL, with no auth and no RLS consulted. Sections 1 and 2 stop the
-- list and stop cross-tenant writes; they do NOT stop somebody who has ever
-- obtained a cookie URL from using it forever. Those URLs are stored in
-- profiles.cookie_import_url, which every member of the org can read.
--
-- The fix is a private bucket plus signed URLs, and it needs three changes that
-- have to ship together:
--   - a new private bucket for profile-cookies/ (leave avatars, logos and
--     extension zips where they are -- none of them is a credential);
--   - uploadCookieFile returns a path rather than a public URL, and
--     createSignedUrl is called at launch time;
--   - electron/main.cjs is handed a signed URL by the renderer instead of
--     resolving cookie_import_url itself -- it has no Supabase client and must
--     not grow one.
-- Existing rows keep public URLs, so the migration also has to move the objects
-- and rewrite those columns.
--
-- Until that ships, treat every cookie URL ever issued as compromised.


-- ── Verify ────────────────────────────────────────────────────────────────
-- Expect three policies, all `{authenticated}`, and NO row naming anon.
select policyname, cmd, roles::text
  from pg_policies where schemaname='storage' and tablename='objects'
 order by cmd;

-- Expect zero rows: nothing in the bucket should be reachable by anon.
select policyname from pg_policies
 where schemaname='storage' and tablename='objects' and 'anon' = any(roles);
