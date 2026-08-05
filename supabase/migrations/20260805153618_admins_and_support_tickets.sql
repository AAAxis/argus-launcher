-- public.admins and public.support_tickets: the two tables landing/ has always
-- read but which only ever existed in the `prelaunch` schema.
--
-- Both were left behind by 0000a_prelaunch_schema_aside, which moved the old
-- single-tenant schema out of `public` and revoked it from anon/authenticated.
-- Neither was recreated, and PostgREST fails the *whole* select on an unknown
-- relation, so:
--
--   * lib/admin.ts isAdmin() errored and returned false for everyone, which made
--     /admin and every /api/admin/* route unreachable. Fail-closed, so not a
--     hole -- but invisible, because "table missing" and "not an admin" produce
--     the identical answer.
--   * app/api/support/route.ts inserted every customer support ticket into
--     nothing. It logged and returned 500; the messages were simply lost.
--
-- prelaunch.support_tickets is empty, so nothing is migrated. prelaunch.admins
-- holds the rows that were meant to be the admin list, so they are copied over.
-- The `prelaunch` copies are left alone: this migration adds, it does not tidy.
--
-- NOTE ON GRANTS. Default privileges in this database grant *everything* on a
-- new table in `public` to anon, authenticated and service_role (see
-- pg_default_acl). So `create table` alone would hand anon full DML on the admin
-- list. Every revoke below is load-bearing; do not drop them on the assumption
-- that RLS is enough. RLS filters rows for a role that already holds the grant.

-- ---------------------------------------------------------------------------
-- admins
-- ---------------------------------------------------------------------------

create table if not exists public.admins (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.admins enable row level security;

revoke all on public.admins from anon, authenticated;

-- Same reasoning as payment_events in 20260805000002: "no policy" and "deny
-- everyone" look identical from the outside, and only one of them is a
-- decision. A RESTRICTIVE policy also cannot be satisfied by adding a
-- permissive one later, so the denial survives a future mistake.
drop policy if exists "admins are service role only" on public.admins;

create policy "admins are service role only"
  on public.admins
  as restrictive
  for all
  to authenticated, anon
  using (false)
  with check (false);

comment on table public.admins is
  'Staff who can reach /admin. Read only by the service-role client in landing/lib/admin.ts; no client may read or write. Manage by inserting/deleting rows here -- no redeploy needed.';

-- Carry over whoever was already on the list.
insert into public.admins (user_id, created_at)
select a.user_id, a.created_at
  from prelaunch.admins a
 where exists (select 1 from auth.users u where u.id = a.user_id)
    on conflict (user_id) do nothing;

-- ---------------------------------------------------------------------------
-- support_tickets
-- ---------------------------------------------------------------------------

create table if not exists public.support_tickets (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid references public.organizations (id) on delete set null,
  user_id    uuid not null references auth.users (id) on delete cascade,
  email      text,
  subject    text not null,
  message    text not null,
  status     text not null default 'open' check (status in ('open', 'closed')),
  created_at timestamptz not null default now()
);

alter table public.support_tickets enable row level security;

-- A customer files their own tickets and reads them back. They may not edit or
-- withdraw one, and they may not touch `status` -- that is the admin's word on
-- whether the ticket is handled, so UPDATE and DELETE stay with the service
-- role. Same shape as org_invites, which also grants SELECT without INSERT.
revoke all on public.support_tickets from anon, authenticated;
grant select, insert on public.support_tickets to authenticated;

drop policy if exists support_insert_own on public.support_tickets;
create policy support_insert_own on public.support_tickets
  for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists support_select_own on public.support_tickets;
create policy support_select_own on public.support_tickets
  for select to authenticated
  using (user_id = auth.uid());

create index if not exists support_tickets_created_idx
  on public.support_tickets (created_at desc);

comment on table public.support_tickets is
  'Customer support messages from landing /support. The filer may insert and read their own; only the service role may change status. email and org_id are derived server-side from the session, never accepted from the client.';
