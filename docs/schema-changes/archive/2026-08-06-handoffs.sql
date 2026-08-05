-- 2026-08-06 -- handing an item to a teammate: assignment, and the offer that
-- precedes it.
--
-- Same situation as every file beside this one: there is no supabase/migrations/
-- in this workspace and the Supabase CLI is not installed, so this is a record
-- of a change applied by hand in the SQL editor of project jpsmdjtxuxlkyuotwxfg
-- -- not something a tool replays. Run it once; it is idempotent.
--
-- RUN IT BEFORE SHIPPING THE BUILD THAT EXPECTS THESE FUNCTIONS. src/db/shared.ts
-- calls all four RPCs by name; a build shipped against a database without them
-- shows an empty Shared view and a "Could not save" toast, with the rows sitting
-- untouched in Postgres.
--
--
-- ── THIS REPLACES 2026-08-06-shared-items.sql. READ THIS PART. ─────────────
--
-- An earlier version of this feature was built cross-organization: a
-- shared_items table holding a frozen snapshot, and an accept that COPIED the
-- snapshot into the recipient's org. If that file was applied to this database
-- -- it was -- the teardown below removes it. Nothing is lost that matters: it
-- never shipped in a build, so the only rows it can hold are test sends.
--
-- Why it was the wrong model. Sharing outside the workspace is already served
-- by CSV export, and sharing INSIDE the workspace cannot be a copy: profiles,
-- proxies, cookie_sets and automations are scoped by org_id and by nothing
-- else, so two colleagues already see the same rows. Copying one to a teammate
-- would hand them a duplicate of something already on their screen, and the
-- old share_items even refused it outright (`already_in_your_workspace`).
--
-- What a team actually needs from "share this with Anna" is not access -- she
-- has it -- but a HAND-OFF: this one is yours now. So the primitive is an
-- assignment, and the share is an offer of one that Anna can accept or decline.
-- Access never changes; who is on the hook does.


-- ── Check this first ──────────────────────────────────────────────────────
-- Everything below assumes organizations.id is uuid, the same assumption
-- 2026-08-05-teams.sql documents. If this says text, replace every `uuid` org
-- id below with `text` before running the rest.
select data_type
  from information_schema.columns
 where table_schema = 'public'
   and table_name = 'organizations'
   and column_name = 'id';


-- ── Teardown of the cross-org attempt ─────────────────────────────────────
-- Functions first, then the table they read: dropping the table while a
-- SECURITY DEFINER function still references it leaves a function that fails at
-- call time rather than at drop time.
--
-- Unguarded, unlike 2026-08-05-teams.sql's refusal to drop a non-empty
-- org_invites. That guard existed because an invite is a live credential
-- somebody may be holding; a shared_items row is an offer from a build that was
-- never released, and there is no client anywhere that can still act on one.
drop function if exists public.share_items(uuid, text, text[], text, text, boolean, boolean);
drop function if exists public.accept_shared_item(uuid, uuid);
drop function if exists public.decline_shared_item(uuid);
drop function if exists public.revoke_shared_item(uuid);
drop function if exists public.list_shared_inbox();
drop function if exists public.jsonb_text_array(jsonb);
drop table if exists public.shared_items;


-- ── assigned_to ───────────────────────────────────────────────────────────
-- Who is on the hook for this row. NOT who can see it -- every member of the
-- org can see all four of these tables and that does not change here.
--
-- References auth.users rather than org_members, and ON DELETE SET NULL: a
-- person who leaves the workspace leaves their work behind (removeMember's
-- dialog promises exactly that), so the row survives and simply becomes
-- unassigned. A foreign key to org_members with a cascade would delete the
-- profile along with the membership, which is the opposite of the promise.
--
-- Idempotent: `add column if not exists` so the file can be re-run.
alter table public.profiles
  add column if not exists assigned_to uuid references auth.users(id) on delete set null;
alter table public.proxies
  add column if not exists assigned_to uuid references auth.users(id) on delete set null;
alter table public.cookie_sets
  add column if not exists assigned_to uuid references auth.users(id) on delete set null;
alter table public.automations
  add column if not exists assigned_to uuid references auth.users(id) on delete set null;

-- Partial: "what is assigned to me" is the only question these are asked, and
-- most rows in a young workspace are assigned to nobody.
create index if not exists profiles_assigned_idx
  on public.profiles (org_id, assigned_to) where assigned_to is not null;
create index if not exists proxies_assigned_idx
  on public.proxies (org_id, assigned_to) where assigned_to is not null;
create index if not exists cookie_sets_assigned_idx
  on public.cookie_sets (org_id, assigned_to) where assigned_to is not null;
create index if not exists automations_assigned_idx
  on public.automations (org_id, assigned_to) where assigned_to is not null;

-- No new RLS. Existing policies on all four tables are is_org_member(org_id)
-- for select and update, which is already right: a teammate may set an
-- assignment, and everyone can see who holds one. Adding a policy here would
-- narrow a column on a table whose whole design is that it is shared.


-- ── handoffs ──────────────────────────────────────────────────────────────
-- The offer. Separate from the assignment for the same reason org_invites is
-- separate from org_members: the pending state and the settled state answer
-- different questions, and squashing them would make "who holds this" depend on
-- whether somebody has read their notifications.
create table if not exists public.handoffs (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,

  kind        text not null
                check (kind in ('profile', 'proxy', 'cookie_set', 'automation')),
  -- text, not uuid: a profile's id is also its on-disk directory name, so
  -- profiles.id is text (0005 / profiles_id_fs_safe) and this column has to
  -- hold ids from all four tables.
  item_id     text not null,
  -- Denormalised at offer time, and deliberately. The inbox has to say WHAT is
  -- being handed over, and the four tables have no common shape to join to --
  -- a union over all of them, per notification, to render a name is a lot of
  -- machinery for one string. If the item is renamed before the offer is
  -- answered, the inbox shows the name it had when it was sent, which is also
  -- the name the sender was looking at.
  item_name   text not null default '',

  from_user   uuid references auth.users(id) on delete set null,
  to_user     uuid not null references auth.users(id) on delete cascade,

  note        text,
  status      text not null default 'pending'
                check (status in ('pending', 'accepted', 'declined', 'cancelled')),

  created_at  timestamptz not null default now(),
  resolved_at timestamptz
);

-- One live offer per item per person. Partial on 'pending' so the same item can
-- be offered again after a decline, and so history never blocks a re-send.
create unique index if not exists handoffs_pending_unique
  on public.handoffs (org_id, kind, item_id, to_user)
  where status = 'pending';

create index if not exists handoffs_inbox
  on public.handoffs (to_user, status);
create index if not exists handoffs_org_idx
  on public.handoffs (org_id, status);

alter table public.handoffs enable row level security;

-- Everyone in the org reads them.
--
-- Note how much simpler this is than the cross-org version, which needed a
-- SECURITY DEFINER function just to render an inbox: there, "who sent this"
-- lived in an auth.users the recipient could not join to. Here both people are
-- members of one org, so the launcher already holds the roster in
-- CloudState.members and resolves names client-side. No RPC, no second copy of
-- the identity-precedence logic in org_members_with_identity.
drop policy if exists handoffs_select on public.handoffs;
create policy handoffs_select on public.handoffs
  for select to authenticated using (public.is_org_member(org_id));

-- select only. Every mutation goes through a function below, because each one
-- has to touch two tables at once (the offer and the item's assigned_to) and a
-- client that could write handoffs directly could mark an offer accepted
-- without ever taking the assignment.
grant select on public.handoffs to authenticated;


-- ── offer_handoff ─────────────────────────────────────────────────────────
-- Offers one or more items of a single kind to one teammate.
--
-- Dropped first, not just CREATE OR REPLACE: `create or replace function`
-- cannot change a return type, and re-running a corrected migration against an
-- old signature is how 2026-08-05-teams.sql shipped a create_org_invite that
-- only failed at CALL time.
drop function if exists public.offer_handoff(uuid, text, text[], uuid, text);

create function public.offer_handoff(
  p_org   uuid,
  p_kind  text,
  p_ids   text[],
  p_to    uuid,
  p_note  text default null
)
-- Prefixed OUT names. `returns table (...)` declares each as a plpgsql
-- variable, so a bare `id` below would be ambiguous against a real column --
-- and plpgsql raises that at CALL time, not at CREATE time, so it ships.
returns table (handoff_id uuid, handoff_item_id text)
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  uid  uuid := auth.uid();
  src  text;
  nm   text;
begin
  if uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  -- is_org_member, not is_org_admin. Handing work to a colleague is not an
  -- administrative act, and gating it behind admin would stop peers dividing a
  -- shared pool between themselves -- which is the entire feature.
  if not public.is_org_member(p_org) then
    raise exception 'not a member of that organization' using errcode = '42501';
  end if;

  if p_to = uid then
    raise exception 'cannot_share_with_yourself' using errcode = 'check_violation';
  end if;

  -- The recipient must be in the SAME org. Without this, any user id would do,
  -- and an item could be assigned to somebody who cannot see the workspace it
  -- lives in -- an assignment nobody could ever act on or clear.
  if not exists (
    select 1 from public.org_members m where m.org_id = p_org and m.user_id = p_to
  ) then
    raise exception 'not_a_teammate' using errcode = 'check_violation';
  end if;

  if p_kind not in ('profile', 'proxy', 'cookie_set', 'automation') then
    raise exception 'invalid_kind' using errcode = 'check_violation';
  end if;

  if p_ids is null or array_length(p_ids, 1) is null then
    raise exception 'nothing_selected' using errcode = 'check_violation';
  end if;

  foreach src in array p_ids loop
    nm := null;

    -- Each lookup is scoped to p_org as well as to the id. RLS would enforce it
    -- anyway for a normal caller, but this function is SECURITY DEFINER and so
    -- runs without it -- the org filter here IS the tenant boundary.
    if p_kind = 'proxy' then
      select coalesce(nullif(x.name, ''), x.host, 'Untitled') into nm
        from public.proxies x where x.id = src and x.org_id = p_org;
    elsif p_kind = 'cookie_set' then
      select coalesce(nullif(x.name, ''), 'Untitled') into nm
        from public.cookie_sets x where x.id = src and x.org_id = p_org;
    elsif p_kind = 'automation' then
      select coalesce(nullif(x.name, ''), 'Untitled') into nm
        from public.automations x where x.id = src and x.org_id = p_org;
    else
      select coalesce(nullif(x.name, ''), 'Untitled') into nm
        from public.profiles x where x.id = src and x.org_id = p_org;
    end if;

    -- Skipping silently would leave the sender believing they handed over four
    -- things when they handed over three.
    if nm is null then
      raise exception 'item_not_found: %', src using errcode = 'check_violation';
    end if;

    -- Supersede any earlier pending offer of the same item to the same person
    -- rather than colliding with the partial unique index. Re-sending is a
    -- normal thing to do when the first one went unanswered.
    update public.handoffs
       set status = 'cancelled', resolved_at = now()
     where org_id = p_org and kind = p_kind and item_id = src
       and to_user = p_to and status = 'pending';

    return query
    insert into public.handoffs (org_id, kind, item_id, item_name, from_user, to_user, note)
         values (p_org, p_kind, src, nm, uid, p_to,
                 nullif(trim(coalesce(p_note, '')), ''))
      returning handoffs.id, handoffs.item_id;
  end loop;
end $function$;


-- ── accept_handoff ────────────────────────────────────────────────────────
-- Takes the assignment. This is the only thing "approve" does, and it is worth
-- being precise about what it does not do: it grants no access, copies nothing,
-- and moves no data. The recipient could already see the item. What changes is
-- that the row now names them.
drop function if exists public.accept_handoff(uuid);

create function public.accept_handoff(p_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  uid uuid := auth.uid();
  h   public.handoffs%rowtype;
begin
  if uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  select * into h from public.handoffs where id = p_id for update;

  if h.id is null then
    raise exception 'handoff_not_found' using errcode = 'check_violation';
  end if;
  -- Only the addressee. Membership is not enough: everyone in the org can READ
  -- this row under handoffs_select, so without this any colleague could accept
  -- an assignment meant for someone else.
  if h.to_user <> uid then
    raise exception 'handoff_not_yours' using errcode = 'check_violation';
  end if;
  if h.status <> 'pending' then
    raise exception 'handoff_not_pending' using errcode = 'check_violation';
  end if;

  -- No limit trigger can fire here: this is an UPDATE of one column, not an
  -- insert, so unlike the copy model this cannot fail on a plan cap.
  if h.kind = 'proxy' then
    update public.proxies set assigned_to = uid where id = h.item_id and org_id = h.org_id;
  elsif h.kind = 'cookie_set' then
    update public.cookie_sets set assigned_to = uid where id = h.item_id and org_id = h.org_id;
  elsif h.kind = 'automation' then
    update public.automations set assigned_to = uid where id = h.item_id and org_id = h.org_id;
  else
    update public.profiles set assigned_to = uid where id = h.item_id and org_id = h.org_id;
  end if;

  -- The item was deleted between the offer and the answer. Recorded as accepted
  -- anyway: the offer is genuinely finished, and leaving it pending would put a
  -- permanent unanswerable row in somebody's inbox.
  if not found then
    update public.handoffs set status = 'accepted', resolved_at = now() where id = h.id;
    raise exception 'item_gone' using errcode = 'check_violation';
  end if;

  update public.handoffs set status = 'accepted', resolved_at = now() where id = h.id;
end $function$;


-- ── decline_handoff ───────────────────────────────────────────────────────
-- Recorded rather than deleted, so the sender can see it was answered. A
-- notification that silently disappears reads as a bug and prompts a re-send.
drop function if exists public.decline_handoff(uuid);

create function public.decline_handoff(p_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  update public.handoffs
     set status = 'declined', resolved_at = now()
   where id = p_id and to_user = auth.uid() and status = 'pending';

  if not found then
    raise exception 'handoff_not_pending' using errcode = 'check_violation';
  end if;
end $function$;


-- ── cancel_handoff ────────────────────────────────────────────────────────
-- Sender-side, pending only. Once accepted the assignment is real and the way
-- to undo it is to hand it back or clear it -- not to rewrite the offer that
-- produced it.
drop function if exists public.cancel_handoff(uuid);

create function public.cancel_handoff(p_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  owner_org uuid;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  select org_id into owner_org from public.handoffs where id = p_id;

  if owner_org is null then
    raise exception 'handoff_not_found' using errcode = 'check_violation';
  end if;
  if not public.is_org_member(owner_org) then
    raise exception 'not a member of that organization' using errcode = '42501';
  end if;

  update public.handoffs
     set status = 'cancelled', resolved_at = now()
   where id = p_id and status = 'pending';

  if not found then
    raise exception 'handoff_not_pending' using errcode = 'check_violation';
  end if;
end $function$;


-- ── set_assignee ──────────────────────────────────────────────────────────
-- Assign or unassign directly, with no offer in between.
--
-- SUPERSEDED BY 2026-08-07-assign-directly.sql. The version below is kept as
-- the record of what was applied on this date, but it is no longer the function
-- in the database and the paragraph after this one no longer describes the
-- product: assignment to a teammate is now direct, and the offer flow is the
-- deliberate alternative rather than the only road. Read that file before
-- reasoning about how assignment works today.
--
-- Two cases the offer flow cannot serve. Clearing an assignment -- the work is
-- finished, or the person left -- is nobody's to accept. And taking an
-- unclaimed item for yourself is not something you should have to send yourself
-- a notification to do.
--
-- Handing something to somebody ELSE still goes through offer_handoff: an
-- assignment that appeared on your plate without your agreement is exactly the
-- thing the approve step exists to prevent.
drop function if exists public.set_assignee(uuid, text, text, uuid);

create function public.set_assignee(p_org uuid, p_kind text, p_id text, p_to uuid)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if not public.is_org_member(p_org) then
    raise exception 'not a member of that organization' using errcode = '42501';
  end if;
  -- Yourself or nobody. Anyone else is a hand-off and needs their consent.
  if p_to is not null and p_to <> uid then
    raise exception 'use_offer_handoff' using errcode = 'check_violation',
      hint = 'Share it with them instead so they can accept it.';
  end if;

  if p_kind = 'proxy' then
    update public.proxies set assigned_to = p_to where id = p_id and org_id = p_org;
  elsif p_kind = 'cookie_set' then
    update public.cookie_sets set assigned_to = p_to where id = p_id and org_id = p_org;
  elsif p_kind = 'automation' then
    update public.automations set assigned_to = p_to where id = p_id and org_id = p_org;
  elsif p_kind = 'profile' then
    update public.profiles set assigned_to = p_to where id = p_id and org_id = p_org;
  else
    raise exception 'invalid_kind' using errcode = 'check_violation';
  end if;

  if not found then
    raise exception 'item_not_found: %', p_id using errcode = 'check_violation';
  end if;
end $function$;


grant execute on function public.offer_handoff(uuid, text, text[], uuid, text) to authenticated;
grant execute on function public.accept_handoff(uuid) to authenticated;
grant execute on function public.decline_handoff(uuid) to authenticated;
grant execute on function public.cancel_handoff(uuid) to authenticated;
grant execute on function public.set_assignee(uuid, text, text, uuid) to authenticated;


-- ── Sanity ────────────────────────────────────────────────────────────────
-- Replace the ids with a real org you belong to, a real profile in it, and a
-- teammate's user id. The first must return one row; the second must fail with
-- "cannot_share_with_yourself", which is the check most likely to rot.
--
--   select * from public.offer_handoff(
--     '00000000-0000-0000-0000-000000000000', 'profile',
--     array['some-profile-id'], '11111111-1111-1111-1111-111111111111', 'yours now');
--
-- And confirm the teardown landed -- this must return no rows:
--   select to_regclass('public.shared_items');
