-- Support ticket attachments: a jsonb list on the ticket plus a private bucket.
--
-- Attachments are screenshots, and screenshots carry PII -- account pages,
-- billing details, whatever was on screen. So unlike `global` this bucket is
-- not public. Every object is written and signed by the service-role client in
-- landing/app/api/support: the browser never touches storage directly, which
-- is why no client policy grants anything here.

alter table public.support_tickets
  add column if not exists attachments jsonb not null default '[]'::jsonb;

alter table public.support_tickets
  add constraint support_tickets_attachments_is_array
  check (jsonb_typeof(attachments) = 'array');

comment on column public.support_tickets.attachments is
  'Array of {path, name, size, type} for objects in the private support bucket. Written only by landing/app/api/support via the service role; the admin page signs the paths for viewing.';

-- The bucket-level mime and size limits back up the route''s own validation.
-- 4MB total per ticket is enforced by the route; per-object 4MB here.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('support', 'support', false, 4194304,
        array['image/png','image/jpeg','image/webp','image/gif'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Deny by decision, like payment_events: a RESTRICTIVE policy so "no client
-- access" survives any future permissive policy someone adds to
-- storage.objects. The service role bypasses RLS, which is the only path
-- uploads and signed URLs use. For rows in other buckets the predicate is
-- true, so this ANDs harmlessly with the `global` policies.
drop policy if exists "support bucket is service-role only" on storage.objects;
create policy "support bucket is service-role only"
  on storage.objects
  as restrictive for all to authenticated, anon
  using (bucket_id <> 'support')
  with check (bucket_id <> 'support');
