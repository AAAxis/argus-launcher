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

-- Per-profile check results reported by external automation (e.g. a Hive
-- QA/monitoring sweep) via POST /v1/monitoring/report. Anty's main process
-- forwards the write to the renderer, which inserts here as the signed-in
-- user -- the automation caller never gets a Supabase key of its own.
create table if not exists public.argus_monitoring_results (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  run_id text not null,
  profile_id text not null,
  ok boolean not null,
  detail text,
  screenshot_base64 text,
  created_at timestamptz not null default now()
);

create index if not exists argus_monitoring_results_user_run_idx
on public.argus_monitoring_results (user_id, run_id);

alter table public.argus_monitoring_results enable row level security;

drop policy if exists "users can read their own monitoring results" on public.argus_monitoring_results;
create policy "users can read their own monitoring results"
on public.argus_monitoring_results
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "users can insert their own monitoring results" on public.argus_monitoring_results;
create policy "users can insert their own monitoring results"
on public.argus_monitoring_results
for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "users can delete their own monitoring results" on public.argus_monitoring_results;
create policy "users can delete their own monitoring results"
on public.argus_monitoring_results
for delete
to authenticated
using (auth.uid() = user_id);
