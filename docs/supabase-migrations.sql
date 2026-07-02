alter table public.argus_cloud_state
add column if not exists shared_bookmarks jsonb not null default '[]'::jsonb;
