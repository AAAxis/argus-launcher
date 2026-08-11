-- 2026-08-10 -- two roles, not three: the owner is the account holder, and
-- everyone else is a member with full access to the work.
--
-- Same situation as every file beside this one: there is no supabase/migrations/
-- in this workspace and the Supabase CLI is not installed, so this is a record
-- of a change applied by hand in the SQL editor of project jpsmdjtxuxlkyuotwxfg
-- -- not something a tool replays. Run it once; it is idempotent.
--
-- RUN 2026-08-09-roster-leak-and-grants.sql FIRST. It is independent of this
-- file and fixes two live defects; this one is a model change and can wait
-- behind it.
--
-- WHAT CHANGES, IN ONE SENTENCE. 'admin' disappears; a member may do anything to
-- the workspace's contents and settings; the owner alone controls who is in the
-- workspace and who holds an API token.
--
-- WHY THE MIDDLE ROLE WENT. It bought one distinction -- "can invite people but
-- did not pay" -- and charged for it everywhere: three roles in the type, a role
-- picker in the roster, a role selector in the invite dialog, a promotion path
-- with an escalation hole in it (see section 4), and a question on every new
-- feature about which of the three tiers it belongs to. The product is bought by
-- one person and used by their team. That is two roles.
--
-- WHAT A MEMBER MAY NOW DO THAT THEY COULD NOT. Rename the workspace, set its
-- legal name, country, website and logo, and toggle the built-in extensions.
-- Those are the columns 2026-08-08-org-profile.sql:165 grants at column level,
-- and that grant list is deliberately unchanged: plan, seat_limit, profile_limit,
-- automation_limit, billing_status and current_period_end are not in it and
-- remain unwritable by any client, whatever their role. The entitlement boundary
-- is enforced by the grant, not by the role -- which is why widening the role
-- here is safe.
--
-- NO DATA MIGRATION IS NEEDED, but the updates below run anyway: at the time of
-- writing no row in either table holds 'admin' (verified against production),
-- so they are no-ops that make the file safe to run against a database where
-- that stopped being true.


-- ── 1. is_org_owner ───────────────────────────────────────────────────────
-- Deliberately the same shape as is_org_member: sql rather than plpgsql, stable,
-- security definer, and search_path pinned. It is called from RLS policies on
-- every row of several tables, so it has to be inlinable and it has to be
-- immune to a caller planting a public.org_members of their own.
create or replace function public.is_org_owner(target uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select exists (
    select 1 from public.org_members
    where org_id = target
      and user_id = auth.uid()
      and role = 'owner'
  );
$function$;

revoke all on function public.is_org_owner(uuid) from public, anon;
grant execute on function public.is_org_owner(uuid) to authenticated;


-- ── 2. is_org_admin, kept as an alias that fails closed ───────────────────
-- DEPRECATED. Every policy and function below moves off it, so after this file
-- runs nothing in the database calls it. It is redefined rather than dropped
-- because "nothing calls it" is a claim about code I have read, and the cost of
-- being wrong is asymmetric: a dropped function makes any missed call site raise
-- 42883 and fail the request, while an alias makes it quietly enforce the
-- stricter rule. Owner-only is the safe direction to be wrong in.
--
-- Delete it once a release has gone by without it appearing in the logs.
create or replace function public.is_org_admin(target uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select public.is_org_owner(target);
$function$;

revoke all on function public.is_org_admin(uuid) from public, anon;
grant execute on function public.is_org_admin(uuid) to authenticated;


-- ── 3. Collapse the data, then narrow the constraints ─────────────────────
-- Order matters: the check constraint cannot be added while a row violates it.
-- An existing admin becomes a member and keeps every ability they actually used
-- day to day -- they lose only the ability to invite, remove and mint tokens.
update public.org_members set role = 'member' where role = 'admin';
update public.org_invites set role = 'member' where role = 'admin';

alter table public.org_members drop constraint if exists org_members_role_check;
alter table public.org_members
  add constraint org_members_role_check check (role in ('owner', 'member'));

-- Narrower than org_members' own check, exactly as it was before: you could
-- never invite an owner, and now you cannot invite anything but a member. The
-- column keeps its 'member' default, so create_org_invite's insert is unchanged.
alter table public.org_invites drop constraint if exists org_invites_role_check;
alter table public.org_invites
  add constraint org_invites_role_check check (role = 'member');


-- ── 4. org_members: no client writes at all, except leaving ───────────────
-- INSERT and UPDATE both go away completely, policy and grant.
--
-- The insert policy was `with check is_org_admin(org_id)`, which let an admin
-- write any user_id they liked straight into the table. That is a way into an
-- organization that never passes accept_org_invite, and so never passes the
-- `addr <> lower(invite.email)` check that is the only thing tying an invite to
-- a person -- an admin could add an account that had never been offered a seat
-- and never confirmed the address. accept_org_invite is SECURITY DEFINER and so
-- keeps working without this grant; it is now the only way in, which is what
-- src/db/team.ts:16-18 already claimed it was.
--
-- The update policy was `using/with check is_org_admin(org_id)` with no column
-- restriction and no restriction on the target row, while the check constraint
-- still permitted 'owner'. Both halves of the escalation followed:
--
--     update org_members set role = 'owner' where user_id = <self>;   -- promote
--     update org_members set role = 'member' where role = 'owner';    -- demote
--
-- With two roles there is nothing left for a client to update on this table, so
-- the whole surface goes rather than being narrowed.
drop policy if exists org_members_insert on public.org_members;
drop policy if exists org_members_update on public.org_members;
revoke insert, update on public.org_members from authenticated, anon;

-- SELECT is unchanged and stays is_org_member: the roster is a team-wide read,
-- and src/db/orgs.ts:8-11 depends on seeing every membership row of your own
-- orgs rather than only your own.

-- One policy, three jobs.
--
--   1. The owner removes a member.               is_org_owner(org_id)
--   2. A member leaves under their own steam.    user_id = auth.uid()
--   3. Nobody removes the owner, ever.           role <> 'owner'
--
-- (2) is new behaviour, not a restatement. Under is_org_admin a plain member's
-- delete of their own row matched no policy and returned success-with-no-rows,
-- so Leave was a button that silently did nothing -- which src/db/team.ts:205-209
-- documents accurately and then apologises for. It works now.
--
-- (3) makes an ownerless organization unreachable, which matters because nothing
-- reconstructs one: bootstrap_org only ever creates a NEW org for a user with no
-- membership at all, so an org whose owner row was deleted would keep its
-- profiles, proxies and billing and have nobody able to invite, remove or pay.
-- The cost is that an owner cannot leave; that is the ownership-transfer feature,
-- which does not exist yet and is not being faked here.
drop policy if exists org_members_delete on public.org_members;
create policy org_members_delete on public.org_members
  for delete to authenticated
  using (
    role <> 'owner'
    and (public.is_org_owner(org_id) or user_id = auth.uid())
  );


-- ── 5. org_invites: owner-only, and status is the only writable column ────
-- The policies move from is_org_admin to is_org_owner. There is still no INSERT
-- policy and no INSERT grant -- create_org_invite mints the token server-side,
-- for the reason 2026-08-05-teams.sql:112-115 gives -- and no policy for the
-- invitee, so knowing an org id still never reveals who else was invited.
drop policy if exists org_invites_select on public.org_invites;
create policy org_invites_select on public.org_invites
  for select to authenticated using (public.is_org_owner(org_id));

drop policy if exists org_invites_update on public.org_invites;
create policy org_invites_update on public.org_invites
  for update to authenticated
  using (public.is_org_owner(org_id))
  with check (public.is_org_owner(org_id));

drop policy if exists org_invites_delete on public.org_invites;
create policy org_invites_delete on public.org_invites
  for delete to authenticated using (public.is_org_owner(org_id));

-- The table-level UPDATE grant covered all eleven columns, which made an
-- outstanding invite editable in ways the UI never intended: re-point `email` at
-- a different address, rewrite `token`, or push `expires_at` out indefinitely and
-- hold a seat open forever. The client writes exactly one column
-- (src/db/team.ts:141 sets status to 'revoked'), so that is what it gets.
revoke insert, update on public.org_invites from authenticated;
grant update (status) on public.org_invites to authenticated;


-- ── 6. organizations: any member may edit the workspace's own details ─────
-- The widening the brief asked for. Safe because of the column grants rather
-- than because of anything here -- see the header. INSERT is still absent
-- entirely; bootstrap_org is the only thing that creates an organization.
drop policy if exists organizations_update on public.organizations;
create policy organizations_update on public.organizations
  for update to authenticated
  using (public.is_org_member(id))
  with check (public.is_org_member(id));


-- ── 7. api_tokens: owner-only ─────────────────────────────────────────────
-- A token is a credential that acts on the whole workspace and outlives the
-- session that minted it, so it stays with the person who owns the account.
-- SELECT remains is_org_member: the table stores token_hash and a prefix, never
-- the token itself (2026-08-05-teams.sql), so a member can see that tokens exist
-- and when they were last used without being able to use one.
drop policy if exists api_tokens_insert on public.api_tokens;
create policy api_tokens_insert on public.api_tokens
  for insert to authenticated with check (public.is_org_owner(org_id));

drop policy if exists api_tokens_update on public.api_tokens;
create policy api_tokens_update on public.api_tokens
  for update to authenticated
  using (public.is_org_owner(org_id))
  with check (public.is_org_owner(org_id));

drop policy if exists api_tokens_delete on public.api_tokens;
create policy api_tokens_delete on public.api_tokens
  for delete to authenticated using (public.is_org_owner(org_id));


-- ── 8. create_org_invite ──────────────────────────────────────────────────
-- Two changes in a body that is otherwise the one from 2026-08-05-teams.sql:
-- the gate is is_org_owner, and 'admin' is no longer an accepted role. The
-- signature keeps its third parameter and its default so that no client breaks
-- mid-rollout: an older launcher that still sends p_role => 'member' works, and
-- one that sends 'admin' now gets invalid_role instead of quietly creating a
-- role that no longer exists.
--
-- `create or replace` rather than drop-and-create, deliberately: dropping a
-- function resets its privileges to EXECUTE for PUBLIC, which is exactly how
-- apply_plan_entitlements ended up world-callable (see 2026-08-09). The explicit
-- revoke and grant at the end are the belt to that braces.
create or replace function public.create_org_invite(
  p_org uuid, p_email text, p_role text default 'member')
returns table (invite_id uuid, invite_token text, invite_expires_at timestamptz)
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  uid uuid := auth.uid(); lim int; used int;
  addr text := lower(trim(p_email)); new_token text;
begin
  if uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if not public.is_org_owner(p_org) then
    raise exception 'only the owner can invite people' using errcode = '42501';
  end if;
  if addr = '' or addr not like '%_@_%.__%' then
    raise exception 'invalid_email' using errcode = 'check_violation';
  end if;
  -- Was `p_role not in ('admin', 'member')`.
  if p_role is distinct from 'member' then
    raise exception 'invalid_role' using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.org_members m join auth.users u on u.id = m.user_id
              where m.org_id = p_org and lower(u.email) = addr) then
    raise exception 'already_a_member' using errcode = 'check_violation';
  end if;

  select o.seat_limit into lim from public.organizations o
   where o.id = p_org for no key update;

  if lim is not null then
    select (select count(*) from public.org_members m where m.org_id = p_org)
         + (select count(*) from public.org_invites i
             where i.org_id = p_org and i.status = 'pending' and i.expires_at > now())
      into used;
    if used >= lim then
      raise exception 'seat_limit_reached' using errcode = 'check_violation',
        hint = 'Upgrade the plan or revoke a pending invite to add more people.';
    end if;
  end if;

  -- gen_random_uuid(), not gen_random_bytes(): the latter is pgcrypto, which
  -- Supabase puts in the `extensions` schema this function's search_path excludes.
  new_token := replace(gen_random_uuid()::text, '-', '') ||
               replace(gen_random_uuid()::text, '-', '');

  update public.org_invites
     set status = 'revoked'
   where org_id = p_org and lower(email) = addr and status = 'pending';

  return query
  insert into public.org_invites (org_id, email, role, token, invited_by)
       values (p_org, addr, 'member', new_token, uid)
    returning org_invites.id, org_invites.token, org_invites.expires_at;
end $function$;

revoke all on function public.create_org_invite(uuid, text, text) from public, anon;
grant execute on function public.create_org_invite(uuid, text, text) to authenticated;


-- ── Verify ────────────────────────────────────────────────────────────────

-- No role anywhere but owner and member. Expect two rows at most.
select 'members' as src, role, count(*) from public.org_members group by 1, 2
union all
select 'invites', role, count(*) from public.org_invites group by 1, 2;

-- Who gates what. Expect is_org_owner on org_invites/api_tokens/org_members
-- delete, is_org_member on organizations update, and no is_org_admin at all.
select tablename, policyname, cmd, coalesce(qual, with_check) as gate
  from pg_policies
 where schemaname = 'public'
   and tablename in ('org_members', 'org_invites', 'organizations', 'api_tokens')
 order by tablename, policyname;

-- What a client may still write to the membership tables. Expect org_members
-- SELECT/DELETE and org_invites SELECT/DELETE plus UPDATE on status only.
select table_name, privilege_type, column_name
  from information_schema.column_privileges
 where table_schema = 'public'
   and table_name in ('org_members', 'org_invites')
   and grantee = 'authenticated'
   and privilege_type in ('INSERT', 'UPDATE')
 order by 1, 2, 3;
