alter table public.argus_cloud_state
add column if not exists shared_bookmarks jsonb not null default '[]'::jsonb;

alter table public.argus_cloud_state
add column if not exists folders jsonb not null default '[]'::jsonb;

alter table public.argus_cloud_state
add column if not exists custom_statuses jsonb not null default '[]'::jsonb;

alter table public.argus_cloud_state
add column if not exists cookies jsonb not null default '[]'::jsonb;

alter table public.argus_cloud_state
add column if not exists built_in_extensions jsonb not null default '{}'::jsonb;

-- Public storage bucket used by:
--   - shared-extensions/<id>.zip for local extension packages
--
-- The app first tries to upload zipped unpacked extensions to this public
-- bucket under shared-extensions/<id>.zip. If the bucket is missing, newer launcher builds fall back to an
-- inline data URL so users are not blocked, but this bucket is still preferred
-- for large/team-shared extensions.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'global',
  'global',
  true,
  52428800,
  null
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "shared extensions are readable" on storage.objects;
create policy "shared extensions are readable"
on storage.objects
for select
to anon, authenticated
using (bucket_id = 'global');

drop policy if exists "authenticated users can upload shared extensions" on storage.objects;
create policy "authenticated users can upload shared extensions"
on storage.objects
for insert
to authenticated
with check (bucket_id = 'global');

drop policy if exists "authenticated users can update shared extensions" on storage.objects;
create policy "authenticated users can update shared extensions"
on storage.objects
for update
to authenticated
using (bucket_id = 'global')
with check (bucket_id = 'global');

drop policy if exists "authenticated users can delete shared extensions" on storage.objects;
create policy "authenticated users can delete shared extensions"
on storage.objects
for delete
to authenticated
using (bucket_id = 'global');
