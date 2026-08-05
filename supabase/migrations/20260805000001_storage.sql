-- Storage: the `global` bucket and its policies.
--
-- Split out of the baseline because `supabase db dump` covers the public and
-- prelaunch schemas only -- it does not emit storage.buckets rows or the
-- policies on storage.objects. Both are transcribed here from the live project
-- so a fresh database is actually usable.
--
-- One bucket serves every kind of upload, separated by path prefix:
--
--   profile-avatars/<orgId>/<profileId>/<ts>.<ext>   launcher, src/db/profiles.ts
--   profile-cookies/<keyId>/<ts>-<name>              launcher, src/db/cookieSets.ts
--   org-logos/<orgId>/<ts>.<ext>                     both, lib/org-profile.ts
--   account avatars                                  both, src/db/account.ts
--   shared extension zips                            launcher, src/db/extensions.ts
--
-- The bucket is public: cookie payloads are fetched by the Electron main
-- process, which holds no Supabase credentials and so cannot present a token.
-- That is why `cookie_sets.source_url` is a plain URL.

insert into storage.buckets (id, name, public, file_size_limit)
values ('global', 'global', true, 52428800)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit;

-- Reads: any signed-in user may list the bucket. Anonymous reads happen through
-- the public URL rather than through this policy.
drop policy if exists "global bucket is listable by signed-in users" on storage.objects;
create policy "global bucket is listable by signed-in users"
  on storage.objects for select to authenticated
  using (bucket_id = 'global');

-- Writes: unrestricted within the bucket. Uploads are named by the client, so
-- the tenant boundary on this one is the path convention above, not the policy.
drop policy if exists "authenticated users can upload shared extensions" on storage.objects;
create policy "authenticated users can upload shared extensions"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'global');

-- Updates and deletes are tenant scoped: you may touch what you uploaded, or
-- anything under org-logos/<orgId>/ and profile-avatars/<orgId>/ for an org you
-- belong to. The uuid regex is what stops foldername()[2] being read as an org
-- id when the path does not carry one.
drop policy if exists "global bucket updates are tenant scoped" on storage.objects;
create policy "global bucket updates are tenant scoped"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'global'
    and (
      owner = auth.uid()
      or (
        (storage.foldername(name))[1] = any (array['org-logos', 'profile-avatars'])
        and (storage.foldername(name))[2] ~ '^[0-9a-fA-F-]{36}$'
        and is_org_member(((storage.foldername(name))[2])::uuid)
      )
    )
  )
  with check (
    bucket_id = 'global'
    and (
      owner = auth.uid()
      or (
        (storage.foldername(name))[1] = any (array['org-logos', 'profile-avatars'])
        and (storage.foldername(name))[2] ~ '^[0-9a-fA-F-]{36}$'
        and is_org_member(((storage.foldername(name))[2])::uuid)
      )
    )
  );

drop policy if exists "global bucket deletes are tenant scoped" on storage.objects;
create policy "global bucket deletes are tenant scoped"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'global'
    and (
      owner = auth.uid()
      or (
        (storage.foldername(name))[1] = any (array['org-logos', 'profile-avatars'])
        and (storage.foldername(name))[2] ~ '^[0-9a-fA-F-]{36}$'
        and is_org_member(((storage.foldername(name))[2])::uuid)
      )
    )
  );
