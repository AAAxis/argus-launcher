-- Rename the launcher's `profiles` table to `browser_profiles`.
--
-- Why: the launcher can share a Supabase project with other apps (e.g. a fintech
-- schema that already owns `public.profiles` for its KYC users). `profiles` is too
-- generic a name to hold; `browser_profiles` says what the row actually is and
-- removes the collision. The client reads/writes `browser_profiles` (src/db/profiles.ts).
--
-- On a fresh launcher project the baseline created `public.profiles`; this renames
-- it. Foreign keys, indexes, the RLS policies and the row-limit trigger follow the
-- table automatically. The SECURITY DEFINER functions below hard-code the table
-- name in their bodies, so they are re-created verbatim except for that name.

alter table if exists public.profiles rename to browser_profiles;

-- enforce_profile_limit(): counts rows in the (now renamed) table.
create or replace function public.enforce_profile_limit() returns trigger
    language plpgsql security definer set search_path to 'public', 'pg_temp' as $$
declare lim int; used int;
begin
  select profile_limit into lim from public.organizations where id = new.org_id for no key update;
  if lim is null then return new; end if;
  select count(*) into used from public.browser_profiles where org_id = new.org_id and deleted_at is null;
  if used >= lim then
    raise exception 'profile_limit_reached' using errcode = 'check_violation', hint = 'Upgrade the plan to add more profiles.';
  end if;
  return new;
end $$;

-- accept_handoff(): the profile branch targets the renamed table.
create or replace function public.accept_handoff(p_id uuid) returns void
    language plpgsql security definer set search_path to 'public', 'pg_temp' as $$
declare uid uuid := auth.uid(); h public.handoffs%rowtype;
begin
  if uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  select * into h from public.handoffs where id = p_id for update;
  if h.id is null then raise exception 'handoff_not_found' using errcode = 'check_violation'; end if;
  if h.to_user <> uid then raise exception 'handoff_not_yours' using errcode = 'check_violation'; end if;
  if h.status <> 'pending' then raise exception 'handoff_not_pending' using errcode = 'check_violation'; end if;
  if h.kind = 'proxy' then
    update public.proxies set assigned_to = uid where id = h.item_id and org_id = h.org_id;
  elsif h.kind = 'cookie_set' then
    update public.cookie_sets set assigned_to = uid where id = h.item_id and org_id = h.org_id;
  elsif h.kind = 'automation' then
    update public.automations set assigned_to = uid where id = h.item_id and org_id = h.org_id;
  else
    update public.browser_profiles set assigned_to = uid where id = h.item_id and org_id = h.org_id;
  end if;
  if not found then
    update public.handoffs set status = 'accepted', resolved_at = now() where id = h.id;
    raise exception 'item_gone' using errcode = 'check_violation';
  end if;
  update public.handoffs set status = 'accepted', resolved_at = now() where id = h.id;
end $$;

-- offer_handoff(): resolves the profile item name from the renamed table.
create or replace function public.offer_handoff(p_org uuid, p_kind text, p_ids text[], p_to uuid, p_note text default null)
    returns table(handoff_id uuid, handoff_item_id text)
    language plpgsql security definer set search_path to 'public', 'pg_temp' as $$
declare uid uuid := auth.uid(); src text; nm text;
begin
  if uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if not public.is_org_member(p_org) then raise exception 'not a member of that organization' using errcode = '42501'; end if;
  if p_to = uid then raise exception 'cannot_share_with_yourself' using errcode = 'check_violation'; end if;
  if not exists (select 1 from public.org_members m where m.org_id = p_org and m.user_id = p_to) then
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
    if p_kind = 'proxy' then
      select coalesce(nullif(x.name, ''), x.host, 'Untitled') into nm from public.proxies x where x.id = src and x.org_id = p_org;
    elsif p_kind = 'cookie_set' then
      select coalesce(nullif(x.name, ''), 'Untitled') into nm from public.cookie_sets x where x.id = src and x.org_id = p_org;
    elsif p_kind = 'automation' then
      select coalesce(nullif(x.name, ''), 'Untitled') into nm from public.automations x where x.id = src and x.org_id = p_org;
    else
      select coalesce(nullif(x.name, ''), 'Untitled') into nm from public.browser_profiles x where x.id = src and x.org_id = p_org;
    end if;
    if nm is null then raise exception 'item_not_found: %', src using errcode = 'check_violation'; end if;
    update public.handoffs set status = 'cancelled', resolved_at = now()
     where org_id = p_org and kind = p_kind and item_id = src and to_user = p_to and status = 'pending';
    return query
    insert into public.handoffs (org_id, kind, item_id, item_name, from_user, to_user, note)
         values (p_org, p_kind, src, nm, uid, p_to, nullif(trim(coalesce(p_note, '')), ''))
      returning handoffs.id, handoffs.item_id;
  end loop;
end $$;

-- set_assignee(): the profile branch targets the renamed table.
create or replace function public.set_assignee(p_org uuid, p_kind text, p_id text, p_to uuid) returns void
    language plpgsql security definer set search_path to 'public', 'pg_temp' as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if not public.is_org_member(p_org) then raise exception 'not a member of that organization' using errcode = '42501'; end if;
  if p_to is not null and not exists (select 1 from public.org_members m where m.org_id = p_org and m.user_id = p_to) then
    raise exception 'not_a_teammate' using errcode = 'check_violation';
  end if;
  if p_kind = 'proxy' then
    update public.proxies set assigned_to = p_to where id = p_id and org_id = p_org;
  elsif p_kind = 'cookie_set' then
    update public.cookie_sets set assigned_to = p_to where id = p_id and org_id = p_org;
  elsif p_kind = 'automation' then
    update public.automations set assigned_to = p_to where id = p_id and org_id = p_org;
  elsif p_kind = 'profile' then
    update public.browser_profiles set assigned_to = p_to where id = p_id and org_id = p_org;
  else raise exception 'invalid_kind' using errcode = 'check_violation';
  end if;
  if not found then raise exception 'item_not_found: %', p_id using errcode = 'check_violation'; end if;
end $$;

-- set_assignees(): the profile branch targets the renamed table.
create or replace function public.set_assignees(p_org uuid, p_kind text, p_ids text[], p_to uuid) returns integer
    language plpgsql security definer set search_path to 'public', 'pg_temp' as $$
declare touched integer;
begin
  if auth.uid() is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if not public.is_org_member(p_org) then raise exception 'not a member of that organization' using errcode = '42501'; end if;
  if p_to is not null and not exists (select 1 from public.org_members m where m.org_id = p_org and m.user_id = p_to) then
    raise exception 'not_a_teammate' using errcode = 'check_violation';
  end if;
  if p_ids is null or array_length(p_ids, 1) is null then return 0; end if;
  if p_kind = 'proxy' then
    update public.proxies set assigned_to = p_to where id = any(p_ids) and org_id = p_org;
  elsif p_kind = 'cookie_set' then
    update public.cookie_sets set assigned_to = p_to where id = any(p_ids) and org_id = p_org;
  elsif p_kind = 'automation' then
    update public.automations set assigned_to = p_to where id = any(p_ids) and org_id = p_org;
  elsif p_kind = 'profile' then
    update public.browser_profiles set assigned_to = p_to where id = any(p_ids) and org_id = p_org;
  else raise exception 'invalid_kind' using errcode = 'check_violation';
  end if;
  get diagnostics touched = row_count;
  return touched;
end $$;

-- purge_expired_data(): the trashed-profiles sweep targets the renamed table.
create or replace function public.purge_expired_data() returns void
    language plpgsql security definer set search_path = public, pg_temp as $$
declare runs bigint; trashed_profiles bigint; trashed_cookies bigint; trashed_automations bigint; invites bigint; settled_handoffs bigint; notices bigint;
begin
  delete from public.automation_runs where started_at < now() - interval '14 days';
  get diagnostics runs = row_count;
  delete from public.browser_profiles where deleted_at is not null and deleted_at < now() - interval '30 days';
  get diagnostics trashed_profiles = row_count;
  delete from public.cookie_sets where deleted_at is not null and deleted_at < now() - interval '30 days';
  get diagnostics trashed_cookies = row_count;
  delete from public.automations where deleted_at is not null and deleted_at < now() - interval '30 days';
  get diagnostics trashed_automations = row_count;
  delete from public.org_invites where status in ('accepted', 'revoked') and coalesce(accepted_at, created_at) < now() - interval '30 days';
  get diagnostics invites = row_count;
  delete from public.handoffs where status <> 'pending' and coalesce(resolved_at, created_at) < now() - interval '30 days';
  get diagnostics settled_handoffs = row_count;
  delete from public.notifications where created_at < now() - interval '30 days';
  get diagnostics notices = row_count;
  raise log 'purge_expired_data: runs=% profiles=% cookie_sets=% automations=% invites=% handoffs=% notifications=%',
    runs, trashed_profiles, trashed_cookies, trashed_automations, invites, settled_handoffs, notices;
end $$;
