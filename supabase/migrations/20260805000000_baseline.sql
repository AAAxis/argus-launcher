


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE SCHEMA IF NOT EXISTS "prelaunch";


ALTER SCHEMA "prelaunch" OWNER TO "postgres";


COMMENT ON SCHEMA "prelaunch" IS 'Dead schema from the abandoned browser-talks-to-Supabase architecture, moved out of public by 0000a so the multi-tenant schema in 0001-0004 could be applied. Retained for reference and for the 5 pre-existing accounts. Not exposed via PostgREST. Safe to drop once nobody needs the old organizations/subscriptions rows.';



COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE OR REPLACE FUNCTION "prelaunch"."apply_plan_entitlements"("p_org" "uuid", "p_plan" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_profile_limit  int;
  v_max_concurrent int;
  v_cloud_sync     boolean;
  v_api_access     boolean;
  v_automation     int;
begin
  case p_plan
    when 'base' then v_profile_limit:=100;  v_max_concurrent:=25;  v_cloud_sync:=true;  v_api_access:=false; v_automation:=0;
    when 'pro'  then v_profile_limit:=300;  v_max_concurrent:=50;  v_cloud_sync:=true;  v_api_access:=true;  v_automation:=10;
    when 'team' then v_profile_limit:=1000; v_max_concurrent:=100; v_cloud_sync:=true;  v_api_access:=true;  v_automation:=100;
    else /* free */  v_profile_limit:=10;   v_max_concurrent:=5;   v_cloud_sync:=false; v_api_access:=false; v_automation:=0;
  end case;

  insert into public.entitlements (org_id, key, value) values
    (p_org, 'profile_limit',    v_profile_limit::text),
    (p_org, 'max_concurrent',   v_max_concurrent::text),
    (p_org, 'cloud_sync',       v_cloud_sync::text),
    (p_org, 'api_access',       v_api_access::text),
    (p_org, 'automation_limit', v_automation::text)
  on conflict (org_id, key) do update set value = excluded.value;
end;
$$;


ALTER FUNCTION "prelaunch"."apply_plan_entitlements"("p_org" "uuid", "p_plan" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "prelaunch"."auth_has_role"("p_org" "uuid", "p_roles" "text"[]) RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select exists (
    select 1 from public.org_members
    where org_id = p_org and user_id = auth.uid()
      and status = 'active' and role = any(p_roles)
  )
$$;


ALTER FUNCTION "prelaunch"."auth_has_role"("p_org" "uuid", "p_roles" "text"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "prelaunch"."auth_org_ids"() RETURNS SETOF "uuid"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select org_id from public.org_members
  where user_id = auth.uid() and status = 'active'
$$;


ALTER FUNCTION "prelaunch"."auth_org_ids"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "prelaunch"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_org uuid;
begin
  insert into public.organizations (name, owner_user_id, plan)
  values (coalesce(new.raw_user_meta_data->>'org_name',
                   split_part(new.email, '@', 1) || '''s org'),
          new.id, 'free')
  returning id into v_org;

  insert into public.org_members (org_id, user_id, role, status)
  values (v_org, new.id, 'owner', 'active');

  perform public.apply_plan_entitlements(v_org, 'free');
  return new;
end;
$$;


ALTER FUNCTION "prelaunch"."handle_new_user"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "prelaunch"."set_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$ begin new.updated_at := now(); return new; end; $$;


ALTER FUNCTION "prelaunch"."set_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."accept_handoff"("p_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
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
end $$;


ALTER FUNCTION "public"."accept_handoff"("p_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."accept_org_invite"("p_token" "text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  uid    uuid := auth.uid();
  addr   text;
  invite public.org_invites%rowtype;
begin
  if uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  select lower(email) into addr from auth.users where id = uid;

  select * into invite
    from public.org_invites
   where token = p_token
     for update;

  if invite.id is null then
    raise exception 'invite_not_found' using errcode = 'check_violation';
  end if;
  if invite.status = 'accepted' then
    raise exception 'invite_already_accepted' using errcode = 'check_violation';
  end if;
  if invite.status = 'revoked' then
    raise exception 'invite_revoked' using errcode = 'check_violation';
  end if;
  if invite.expires_at <= now() then
    raise exception 'invite_expired' using errcode = 'check_violation';
  end if;

  -- The address check is what makes a leaked link inert. A token that reached
  -- the wrong inbox, or a group chat, is useless to anyone but the person it
  -- was issued to.
  if addr is null or addr <> lower(invite.email) then
    raise exception 'invite_wrong_account' using errcode = 'check_violation';
  end if;

  -- Idempotent for the case where someone was added by another route between
  -- the invite going out and the link being followed.
  if exists (
    select 1 from public.org_members
     where org_id = invite.org_id and user_id = uid
  ) then
    update public.org_invites
       set status = 'accepted', accepted_by = uid, accepted_at = now()
     where id = invite.id;
    return invite.org_id;
  end if;

  insert into public.org_members (org_id, user_id, role, invited_by)
       values (invite.org_id, uid, invite.role, invite.invited_by);

  update public.org_invites
     set status = 'accepted', accepted_by = uid, accepted_at = now()
   where id = invite.id;

  return invite.org_id;
end $$;


ALTER FUNCTION "public"."accept_org_invite"("p_token" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."apply_plan_entitlements"("p_org" "uuid", "p_plan" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  p_profiles    int;
  p_seats       int;
  p_automations int;
begin
  case lower(trim(p_plan))
    when 'free'       then p_profiles :=    5; p_seats :=  1; p_automations :=   2;
    when 'starter'    then p_profiles :=   60; p_seats :=  1; p_automations :=   2;
    when 'base'       then p_profiles :=  100; p_seats :=  1; p_automations :=  10;
    when 'pro'        then p_profiles :=  300; p_seats := 10; p_automations :=  10;
    when 'team'       then p_profiles := 1000; p_seats := 25; p_automations := 100;
    when 'enterprise' then p_profiles := null; p_seats := 25; p_automations := 100;
    else
      raise exception 'unknown_plan: %', p_plan using errcode = 'check_violation';
  end case;

  update public.organizations
     set profile_limit    = p_profiles,
         seat_limit       = p_seats,
         automation_limit = p_automations
   where id = p_org;

  if not found then
    raise exception 'organization_not_found' using errcode = 'check_violation';
  end if;
end $$;


ALTER FUNCTION "public"."apply_plan_entitlements"("p_org" "uuid", "p_plan" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."bootstrap_org"("org_name" "text" DEFAULT NULL::"text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  uid      uuid := auth.uid();
  existing uuid;
  new_id   uuid;
  nm       text;
begin
  if uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  select org_id into existing
    from public.org_members
   where user_id = uid
   limit 1;

  if existing is not null then
    return existing;
  end if;

  select coalesce(
           nullif(trim(org_name), ''),
           nullif(split_part(u.email, '@', 2), '') || ' team',
           'My team')
    into nm
    from auth.users u
   where u.id = uid;

  insert into public.organizations (name, plan, profile_limit, seat_limit)
       values (coalesce(nm, 'My team'), 'free', 5, 1)
    returning id into new_id;

  insert into public.org_members (org_id, user_id, role)
       values (new_id, uid, 'owner');

  return new_id;
end $$;


ALTER FUNCTION "public"."bootstrap_org"("org_name" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."cancel_handoff"("p_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
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
end $$;


ALTER FUNCTION "public"."cancel_handoff"("p_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_org_invite"("p_org" "uuid", "p_email" "text", "p_role" "text" DEFAULT 'member'::"text") RETURNS TABLE("invite_id" "uuid", "invite_token" "text", "invite_expires_at" timestamp with time zone)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
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
end $$;


ALTER FUNCTION "public"."create_org_invite"("p_org" "uuid", "p_email" "text", "p_role" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."decline_handoff"("p_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
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
end $$;


ALTER FUNCTION "public"."decline_handoff"("p_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."enforce_automation_limit"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  cap integer;
  used integer;
begin
  select automation_limit into cap from public.organizations where id = new.org_id;
  if cap is null then
    return new;                       -- unlimited
  end if;
  select count(*) into used from public.automations where org_id = new.org_id;
  if used >= cap then
    raise exception 'automation_limit_reached' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."enforce_automation_limit"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."enforce_profile_limit"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  lim  int;
  used int;
begin
  select profile_limit into lim
    from public.organizations
   where id = new.org_id
     for no key update;

  if lim is null then
    return new;
  end if;

  select count(*) into used
    from public.profiles
   where org_id = new.org_id and deleted_at is null;

  if used >= lim then
    raise exception 'profile_limit_reached'
      using errcode = 'check_violation',
            hint = 'Upgrade the plan to add more profiles.';
  end if;

  return new;
end $$;


ALTER FUNCTION "public"."enforce_profile_limit"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."enforce_seat_limit"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  lim  int;
  used int;
begin
  select seat_limit into lim
    from public.organizations
   where id = new.org_id
     for no key update;

  if lim is null then
    return new;
  end if;

  select count(*) into used
    from public.org_members
   where org_id = new.org_id;

  if used >= lim then
    raise exception 'seat_limit_reached'
      using errcode = 'check_violation',
            hint = 'Upgrade the plan or buy an extra seat to add members.';
  end if;

  return new;
end $$;


ALTER FUNCTION "public"."enforce_seat_limit"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_org_admin"("target" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  select public.is_org_owner(target);
$$;


ALTER FUNCTION "public"."is_org_admin"("target" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_org_member"("target" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  select exists (
    select 1 from public.org_members
    where org_id = target and user_id = auth.uid()
  );
$$;


ALTER FUNCTION "public"."is_org_member"("target" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_org_owner"("target" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  select exists (
    select 1 from public.org_members
    where org_id = target
      and user_id = auth.uid()
      and role = 'owner'
  );
$$;


ALTER FUNCTION "public"."is_org_owner"("target" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."offer_handoff"("p_org" "uuid", "p_kind" "text", "p_ids" "text"[], "p_to" "uuid", "p_note" "text" DEFAULT NULL::"text") RETURNS TABLE("handoff_id" "uuid", "handoff_item_id" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
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
end $$;


ALTER FUNCTION "public"."offer_handoff"("p_org" "uuid", "p_kind" "text", "p_ids" "text"[], "p_to" "uuid", "p_note" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."org_members_with_identity"("p_org" "uuid") RETURNS TABLE("user_id" "uuid", "email" "text", "display_name" "text", "avatar_url" "text", "role" "text", "created_at" timestamp with time zone, "invited_by" "uuid")
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
begin
  if not public.is_org_member(p_org) then
    raise exception 'not a member of that organization' using errcode = '42501';
  end if;

  return query
  select m.user_id,
         u.email::text,
         coalesce(
           nullif(u.raw_user_meta_data ->> 'monti_display_name', ''),
           nullif(u.raw_user_meta_data ->> 'full_name', ''),
           nullif(u.raw_user_meta_data ->> 'name', ''),
           '')::text,
         coalesce(
           nullif(u.raw_user_meta_data ->> 'monti_avatar_url', ''),
           nullif(u.raw_user_meta_data ->> 'avatar_url', ''),
           nullif(u.raw_user_meta_data ->> 'picture', ''),
           '')::text,
         m.role,
         m.created_at,
         m.invited_by
    from public.org_members m
    join auth.users u on u.id = m.user_id
   where m.org_id = p_org
   order by m.created_at asc;
end $$;


ALTER FUNCTION "public"."org_members_with_identity"("p_org" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."peek_org_invite"("p_token" "text") RETURNS TABLE("org_name" "text", "org_legal_name" "text", "org_logo_url" "text", "invite_role" "text", "invite_status" "text", "invite_email" "text", "invite_expires_at" timestamp with time zone)
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  -- Alias-qualified throughout, like every other function in this schema: the
  -- OUT names above are plpgsql variables, and an unqualified column would be
  -- ambiguous at CALL time rather than at CREATE time -- so it would ship.
  return query
  select o.name::text,
         o.legal_name::text,
         o.logo_url::text,
         i.role::text,
         i.status::text,
         i.email::text,
         i.expires_at
    from public.org_invites i
    join public.organizations o on o.id = i.org_id
   where i.token = p_token;
end $$;


ALTER FUNCTION "public"."peek_org_invite"("p_token" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_assignee"("p_org" "uuid", "p_kind" "text", "p_id" "text", "p_to" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  -- is_org_member, not is_org_admin. Dividing a shared pool between peers is
  -- the entire feature; gating it behind admin would stop the people doing the
  -- work from organising it.
  if not public.is_org_member(p_org) then
    raise exception 'not a member of that organization' using errcode = '42501';
  end if;
  -- The one guard that has to survive the loosening above. Without it any uuid
  -- would do, and a profile could be assigned to somebody who cannot see the
  -- workspace it lives in -- an assignment that would never appear in anyone's
  -- list and that nobody could act on or clear.
  if p_to is not null and not exists (
    select 1 from public.org_members m where m.org_id = p_org and m.user_id = p_to
  ) then
    raise exception 'not_a_teammate' using errcode = 'check_violation';
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
end $$;


ALTER FUNCTION "public"."set_assignee"("p_org" "uuid", "p_kind" "text", "p_id" "text", "p_to" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_assignees"("p_org" "uuid", "p_kind" "text", "p_ids" "text"[], "p_to" "uuid") RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  touched integer;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if not public.is_org_member(p_org) then
    raise exception 'not a member of that organization' using errcode = '42501';
  end if;
  if p_to is not null and not exists (
    select 1 from public.org_members m where m.org_id = p_org and m.user_id = p_to
  ) then
    raise exception 'not_a_teammate' using errcode = 'check_violation';
  end if;

  -- An empty list is success, not an error. The import calls this
  -- unconditionally, and a file whose every row was an update legitimately
  -- creates nothing to assign.
  if p_ids is null or array_length(p_ids, 1) is null then
    return 0;
  end if;

  -- No `if not found` raise, unlike set_assignee. A single-item call naming a
  -- row that does not exist is a bug worth surfacing; a bulk call that matches
  -- 199 of 200 ids is a row deleted by somebody else mid-import, and failing
  -- the whole batch over it would undo nothing and help no one. The count says
  -- what happened.
  if p_kind = 'proxy' then
    update public.proxies set assigned_to = p_to
     where id = any(p_ids) and org_id = p_org;
  elsif p_kind = 'cookie_set' then
    update public.cookie_sets set assigned_to = p_to
     where id = any(p_ids) and org_id = p_org;
  elsif p_kind = 'automation' then
    update public.automations set assigned_to = p_to
     where id = any(p_ids) and org_id = p_org;
  elsif p_kind = 'profile' then
    update public.profiles set assigned_to = p_to
     where id = any(p_ids) and org_id = p_org;
  else
    raise exception 'invalid_kind' using errcode = 'check_violation';
  end if;

  get diagnostics touched = row_count;
  return touched;
end $$;


ALTER FUNCTION "public"."set_assignees"("p_org" "uuid", "p_kind" "text", "p_ids" "text"[], "p_to" "uuid") OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "prelaunch"."admins" (
    "user_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "prelaunch"."admins" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "prelaunch"."api_keys" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "hashed_key" "text" NOT NULL,
    "scopes" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "created_by" "uuid",
    "last_used_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "prelaunch"."api_keys" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "prelaunch"."audit_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "actor_user_id" "uuid",
    "action" "text" NOT NULL,
    "target" "text",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "prelaunch"."audit_logs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "prelaunch"."entitlements" (
    "org_id" "uuid" NOT NULL,
    "key" "text" NOT NULL,
    "value" "text" NOT NULL
);


ALTER TABLE "prelaunch"."entitlements" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "prelaunch"."folders" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "parent_id" "uuid",
    "name" "text" NOT NULL
);


ALTER TABLE "prelaunch"."folders" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "prelaunch"."org_members" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "role" "text" NOT NULL,
    "invited_by" "uuid",
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "org_members_role_check" CHECK (("role" = ANY (ARRAY['owner'::"text", 'admin'::"text", 'manager'::"text", 'operator'::"text", 'viewer'::"text"]))),
    CONSTRAINT "org_members_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'invited'::"text", 'suspended'::"text"])))
);


ALTER TABLE "prelaunch"."org_members" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "prelaunch"."organizations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "owner_user_id" "uuid" NOT NULL,
    "plan" "text" DEFAULT 'free'::"text" NOT NULL,
    "billing_customer_id" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "organizations_plan_check" CHECK (("plan" = ANY (ARRAY['free'::"text", 'base'::"text", 'pro'::"text", 'team'::"text"])))
);


ALTER TABLE "prelaunch"."organizations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "prelaunch"."profiles" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "owner_user_id" "uuid",
    "name" "text" NOT NULL,
    "status" "text" DEFAULT 'idle'::"text",
    "tags" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "notes" "text",
    "color" "text",
    "folder_id" "uuid",
    "proxy_id" "uuid",
    "fingerprint" "jsonb",
    "encrypted_blob_path" "text",
    "version" integer DEFAULT 1 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "prelaunch"."profiles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "prelaunch"."proxies" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "host" "text" NOT NULL,
    "http_port" integer,
    "socks_port" integer,
    "username" "text",
    "password_enc" "text",
    "country" "text",
    "transport" "text",
    "status" "text" DEFAULT 'unchecked'::"text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "proxies_transport_check" CHECK (("transport" = ANY (ARRAY['http'::"text", 'socks5'::"text"])))
);


ALTER TABLE "prelaunch"."proxies" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "prelaunch"."scenario_runs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "scenario_id" "uuid" NOT NULL,
    "profile_id" "uuid",
    "status" "text" DEFAULT 'pending'::"text",
    "logs_path" "text",
    "started_at" timestamp with time zone,
    "finished_at" timestamp with time zone
);


ALTER TABLE "prelaunch"."scenario_runs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "prelaunch"."scenarios" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "definition" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "prelaunch"."scenarios" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "prelaunch"."subscriptions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "plan" "text" NOT NULL,
    "seats" integer DEFAULT 1 NOT NULL,
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "billing_order_id" "text",
    "current_period_end" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "subscriptions_plan_check" CHECK (("plan" = ANY (ARRAY['free'::"text", 'base'::"text", 'pro'::"text", 'team'::"text"])))
);


ALTER TABLE "prelaunch"."subscriptions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "prelaunch"."support_tickets" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid",
    "user_id" "uuid" NOT NULL,
    "email" "text",
    "subject" "text" NOT NULL,
    "message" "text" NOT NULL,
    "status" "text" DEFAULT 'open'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "support_tickets_status_check" CHECK (("status" = ANY (ARRAY['open'::"text", 'closed'::"text"])))
);


ALTER TABLE "prelaunch"."support_tickets" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "prelaunch"."team_members" (
    "team_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL
);


ALTER TABLE "prelaunch"."team_members" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "prelaunch"."teams" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "name" "text" NOT NULL
);


ALTER TABLE "prelaunch"."teams" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."api_tokens" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "name" "text",
    "token_hash" "text" NOT NULL,
    "prefix" "text" NOT NULL,
    "last_used_at" timestamp with time zone,
    "revoked_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."api_tokens" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."automation_runs" (
    "id" "text" NOT NULL,
    "org_id" "uuid" NOT NULL,
    "automation_id" "text",
    "automation_name" "text" DEFAULT ''::"text" NOT NULL,
    "profile_id" "text",
    "profile_name" "text" DEFAULT ''::"text" NOT NULL,
    "trigger" "text" DEFAULT 'manual'::"text" NOT NULL,
    "status" "text" DEFAULT 'running'::"text" NOT NULL,
    "started_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "finished_at" timestamp with time zone,
    "duration_ms" integer,
    "step_count" integer DEFAULT 0 NOT NULL,
    "failed_step_id" "text",
    "error" "text",
    "vars" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "log" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."automation_runs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."automations" (
    "id" "text" NOT NULL,
    "org_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "steps" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "variables" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "pinned" boolean DEFAULT false NOT NULL,
    "timeout_ms" integer DEFAULT 300000 NOT NULL,
    "close_on_finish" boolean DEFAULT false NOT NULL,
    "created_by" "uuid" DEFAULT "auth"."uid"(),
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "tags" "text"[],
    "assigned_to" "uuid",
    CONSTRAINT "automations_id_fs_safe" CHECK (("id" ~ '^[A-Za-z0-9._-]{1,64}$'::"text"))
);


ALTER TABLE "public"."automations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."cookie_sets" (
    "id" "text" DEFAULT ("gen_random_uuid"())::"text" NOT NULL,
    "org_id" "uuid" NOT NULL,
    "name" "text",
    "cookies" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "source_url" "text",
    "count" integer,
    "folder_id" "text",
    "tags" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "deleted_at" timestamp with time zone,
    "assigned_to" "uuid",
    CONSTRAINT "cookie_sets_id_shape" CHECK ((("id" ~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'::"text") AND ("length"("id") <= 160)))
);


ALTER TABLE "public"."cookie_sets" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."custom_statuses" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "label" "text",
    "color" "text"
);


ALTER TABLE "public"."custom_statuses" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."folders" (
    "id" "text" DEFAULT ("gen_random_uuid"())::"text" NOT NULL,
    "org_id" "uuid" NOT NULL,
    "name" "text",
    "parent_id" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "icon" "text",
    "color" "text",
    "kind" "text" DEFAULT 'profile'::"text" NOT NULL,
    CONSTRAINT "folders_id_fs_safe" CHECK ((("id" ~ '^[A-Za-z0-9][A-Za-z0-9._-]*$'::"text") AND ("length"("id") <= 128)))
);


ALTER TABLE "public"."folders" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."handoffs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "kind" "text" NOT NULL,
    "item_id" "text" NOT NULL,
    "item_name" "text" DEFAULT ''::"text" NOT NULL,
    "from_user" "uuid",
    "to_user" "uuid" NOT NULL,
    "note" "text",
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "resolved_at" timestamp with time zone,
    CONSTRAINT "handoffs_kind_check" CHECK (("kind" = ANY (ARRAY['profile'::"text", 'proxy'::"text", 'cookie_set'::"text", 'automation'::"text"]))),
    CONSTRAINT "handoffs_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'accepted'::"text", 'declined'::"text", 'cancelled'::"text"])))
);


ALTER TABLE "public"."handoffs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."org_invites" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "email" "text" NOT NULL,
    "role" "text" DEFAULT 'member'::"text" NOT NULL,
    "token" "text" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "invited_by" "uuid",
    "accepted_by" "uuid",
    "expires_at" timestamp with time zone DEFAULT ("now"() + '7 days'::interval) NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "accepted_at" timestamp with time zone,
    CONSTRAINT "org_invites_role_check" CHECK (("role" = 'member'::"text")),
    CONSTRAINT "org_invites_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'accepted'::"text", 'revoked'::"text"])))
);


ALTER TABLE "public"."org_invites" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."org_members" (
    "org_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "role" "text" DEFAULT 'member'::"text" NOT NULL,
    "invited_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "org_members_role_check" CHECK (("role" = ANY (ARRAY['owner'::"text", 'member'::"text"])))
);


ALTER TABLE "public"."org_members" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."organizations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "plan" "text" DEFAULT 'free'::"text" NOT NULL,
    "profile_limit" integer,
    "seat_limit" integer DEFAULT 1 NOT NULL,
    "billing_status" "text" DEFAULT 'active'::"text" NOT NULL,
    "current_period_end" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "built_in_extensions" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "legacy_user_id" "uuid",
    "legacy_updated_at" timestamp with time zone,
    "automation_limit" integer DEFAULT 2,
    "org_type" "text",
    "legal_name" "text",
    "country" "text",
    "website" "text",
    "logo_url" "text",
    "onboarded_at" timestamp with time zone,
    CONSTRAINT "organizations_billing_status_check" CHECK (("billing_status" = ANY (ARRAY['active'::"text", 'past_due'::"text", 'cancelled'::"text"]))),
    CONSTRAINT "organizations_country_check" CHECK ((("country" IS NULL) OR ("country" ~ '^[A-Z]{2}$'::"text"))),
    CONSTRAINT "organizations_org_type_check" CHECK ((("org_type" IS NULL) OR ("org_type" = ANY (ARRAY['solo'::"text", 'business'::"text"])))),
    CONSTRAINT "organizations_website_check" CHECK ((("website" IS NULL) OR ("website" ~* '^https?://.'::"text")))
);


ALTER TABLE "public"."organizations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."payment_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "provider" "text" NOT NULL,
    "provider_event_id" "text" NOT NULL,
    "org_id" "uuid",
    "raw" "jsonb" NOT NULL,
    "processed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."payment_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."plan_terms" (
    "months" integer NOT NULL,
    "discount_bps" integer NOT NULL
);


ALTER TABLE "public"."plan_terms" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."plans" (
    "key" "text" NOT NULL,
    "name" "text" NOT NULL,
    "price_cents" integer NOT NULL,
    "currency" "text" DEFAULT 'USD'::"text" NOT NULL,
    "profile_limit" integer,
    "seat_limit" integer DEFAULT 1 NOT NULL,
    "extra_seat_cents" integer,
    "api_access" boolean DEFAULT true NOT NULL,
    "sort" integer
);


ALTER TABLE "public"."plans" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id" "text" DEFAULT ("gen_random_uuid"())::"text" NOT NULL,
    "org_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "notes" "text",
    "folder_id" "text",
    "proxy_id" "text",
    "cookie_set_id" "text",
    "fingerprint" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "status" "text",
    "tags" "text"[],
    "start_urls" "text"[],
    "command_line_switches" "text"[],
    "created_by" "uuid" DEFAULT "auth"."uid"(),
    "deleted_at" timestamp with time zone,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "color" "text",
    "proxy_mode" "text",
    "cookie_mode" "text",
    "cookie_import_path" "text",
    "cookie_import_url" "text",
    "cookie_import_name" "text",
    "cookie_import_count" integer,
    "email" "text",
    "password" "text",
    "automation_id" "text",
    "avatar" "text",
    "assigned_to" "uuid" DEFAULT "auth"."uid"(),
    CONSTRAINT "profiles_cookie_mode_check" CHECK ((("cookie_mode" IS NULL) OR ("cookie_mode" = ANY (ARRAY['paste'::"text", 'saved'::"text"])))),
    CONSTRAINT "profiles_id_fs_safe" CHECK ((("id" ~ '^[A-Za-z0-9][A-Za-z0-9._-]*$'::"text") AND ("length"("id") <= 128))),
    CONSTRAINT "profiles_proxy_mode_check" CHECK ((("proxy_mode" IS NULL) OR ("proxy_mode" = ANY (ARRAY['assigned'::"text", 'direct'::"text", 'free_proxy'::"text"]))))
);


ALTER TABLE "public"."profiles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."proxies" (
    "id" "text" DEFAULT ("gen_random_uuid"())::"text" NOT NULL,
    "org_id" "uuid" NOT NULL,
    "name" "text",
    "type" "text",
    "host" "text",
    "port" integer,
    "username" "text",
    "password" "text",
    "last_checked_at" timestamp with time zone,
    "last_ip" "text",
    "last_country" "text",
    "last_latency_ms" integer,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "last_country_code" "text",
    "last_error" "text",
    "folder_id" "text",
    "assigned_to" "uuid",
    CONSTRAINT "proxies_id_fs_safe" CHECK ((("id" ~ '^[A-Za-z0-9][A-Za-z0-9._-]*$'::"text") AND ("length"("id") <= 128)))
);


ALTER TABLE "public"."proxies" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."shared_bookmarks" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "title" "text",
    "url" "text",
    "position" integer,
    "icon" "text"
);


ALTER TABLE "public"."shared_bookmarks" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."shared_extensions" (
    "id" "text" DEFAULT ("gen_random_uuid"())::"text" NOT NULL,
    "org_id" "uuid" NOT NULL,
    "name" "text",
    "source" "text",
    "storage_path" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "webstore_id" "text",
    "storage_url" "text",
    "enabled" boolean DEFAULT true NOT NULL,
    CONSTRAINT "shared_extensions_id_fs_safe" CHECK ((("id" ~ '^[A-Za-z0-9][A-Za-z0-9._-]*$'::"text") AND ("length"("id") <= 128)))
);


ALTER TABLE "public"."shared_extensions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."subscriptions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "provider" "text" NOT NULL,
    "provider_ref" "text",
    "plan" "text" NOT NULL,
    "status" "text" NOT NULL,
    "amount_cents" integer NOT NULL,
    "currency" "text" NOT NULL,
    "period_months" integer NOT NULL,
    "seats" integer DEFAULT 1 NOT NULL,
    "current_period_end" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "subscriptions_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'active'::"text", 'cancelled'::"text", 'expired'::"text"])))
);


ALTER TABLE "public"."subscriptions" OWNER TO "postgres";


ALTER TABLE ONLY "prelaunch"."admins"
    ADD CONSTRAINT "admins_pkey" PRIMARY KEY ("user_id");



ALTER TABLE ONLY "prelaunch"."api_keys"
    ADD CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "prelaunch"."audit_logs"
    ADD CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "prelaunch"."entitlements"
    ADD CONSTRAINT "entitlements_pkey" PRIMARY KEY ("org_id", "key");



ALTER TABLE ONLY "prelaunch"."folders"
    ADD CONSTRAINT "folders_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "prelaunch"."org_members"
    ADD CONSTRAINT "org_members_org_id_user_id_key" UNIQUE ("org_id", "user_id");



ALTER TABLE ONLY "prelaunch"."org_members"
    ADD CONSTRAINT "org_members_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "prelaunch"."organizations"
    ADD CONSTRAINT "organizations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "prelaunch"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "prelaunch"."proxies"
    ADD CONSTRAINT "proxies_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "prelaunch"."scenario_runs"
    ADD CONSTRAINT "scenario_runs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "prelaunch"."scenarios"
    ADD CONSTRAINT "scenarios_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "prelaunch"."subscriptions"
    ADD CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "prelaunch"."support_tickets"
    ADD CONSTRAINT "support_tickets_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "prelaunch"."team_members"
    ADD CONSTRAINT "team_members_pkey" PRIMARY KEY ("team_id", "user_id");



ALTER TABLE ONLY "prelaunch"."teams"
    ADD CONSTRAINT "teams_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."api_tokens"
    ADD CONSTRAINT "api_tokens_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."api_tokens"
    ADD CONSTRAINT "api_tokens_token_hash_key" UNIQUE ("token_hash");



ALTER TABLE ONLY "public"."automation_runs"
    ADD CONSTRAINT "automation_runs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."automations"
    ADD CONSTRAINT "automations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."cookie_sets"
    ADD CONSTRAINT "cookie_sets_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."custom_statuses"
    ADD CONSTRAINT "custom_statuses_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."folders"
    ADD CONSTRAINT "folders_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."handoffs"
    ADD CONSTRAINT "handoffs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."org_invites"
    ADD CONSTRAINT "org_invites_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."org_invites"
    ADD CONSTRAINT "org_invites_token_key" UNIQUE ("token");



ALTER TABLE ONLY "public"."org_members"
    ADD CONSTRAINT "org_members_pkey" PRIMARY KEY ("org_id", "user_id");



ALTER TABLE ONLY "public"."organizations"
    ADD CONSTRAINT "organizations_legacy_user_id_key" UNIQUE ("legacy_user_id");



ALTER TABLE ONLY "public"."organizations"
    ADD CONSTRAINT "organizations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."payment_events"
    ADD CONSTRAINT "payment_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."payment_events"
    ADD CONSTRAINT "payment_events_provider_provider_event_id_key" UNIQUE ("provider", "provider_event_id");



ALTER TABLE ONLY "public"."plan_terms"
    ADD CONSTRAINT "plan_terms_pkey" PRIMARY KEY ("months");



ALTER TABLE ONLY "public"."plans"
    ADD CONSTRAINT "plans_pkey" PRIMARY KEY ("key");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."proxies"
    ADD CONSTRAINT "proxies_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."shared_bookmarks"
    ADD CONSTRAINT "shared_bookmarks_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."shared_extensions"
    ADD CONSTRAINT "shared_extensions_pkey" PRIMARY KEY ("org_id", "id");



ALTER TABLE ONLY "public"."subscriptions"
    ADD CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id");



CREATE INDEX "idx_api_keys_org" ON "prelaunch"."api_keys" USING "btree" ("org_id");



CREATE INDEX "idx_audit_logs_org" ON "prelaunch"."audit_logs" USING "btree" ("org_id");



CREATE INDEX "idx_folders_org" ON "prelaunch"."folders" USING "btree" ("org_id");



CREATE INDEX "idx_org_members_org" ON "prelaunch"."org_members" USING "btree" ("org_id");



CREATE INDEX "idx_org_members_user" ON "prelaunch"."org_members" USING "btree" ("user_id");



CREATE INDEX "idx_profiles_folder" ON "prelaunch"."profiles" USING "btree" ("folder_id");



CREATE INDEX "idx_profiles_org" ON "prelaunch"."profiles" USING "btree" ("org_id");



CREATE INDEX "idx_profiles_proxy" ON "prelaunch"."profiles" USING "btree" ("proxy_id");



CREATE INDEX "idx_proxies_org" ON "prelaunch"."proxies" USING "btree" ("org_id");



CREATE INDEX "idx_scenario_runs_org" ON "prelaunch"."scenario_runs" USING "btree" ("org_id");



CREATE INDEX "idx_scenarios_org" ON "prelaunch"."scenarios" USING "btree" ("org_id");



CREATE INDEX "idx_subscriptions_org" ON "prelaunch"."subscriptions" USING "btree" ("org_id");



CREATE INDEX "idx_team_members_user" ON "prelaunch"."team_members" USING "btree" ("user_id");



CREATE INDEX "idx_teams_org" ON "prelaunch"."teams" USING "btree" ("org_id");



CREATE INDEX "support_tickets_created_idx" ON "prelaunch"."support_tickets" USING "btree" ("created_at" DESC);



CREATE INDEX "automation_runs_automation_idx" ON "public"."automation_runs" USING "btree" ("automation_id", "started_at" DESC);



CREATE INDEX "automation_runs_org_started_idx" ON "public"."automation_runs" USING "btree" ("org_id", "started_at" DESC);



CREATE INDEX "automations_assigned_idx" ON "public"."automations" USING "btree" ("org_id", "assigned_to") WHERE ("assigned_to" IS NOT NULL);



CREATE INDEX "automations_org_idx" ON "public"."automations" USING "btree" ("org_id");



CREATE INDEX "cookie_sets_assigned_idx" ON "public"."cookie_sets" USING "btree" ("org_id", "assigned_to") WHERE ("assigned_to" IS NOT NULL);



CREATE INDEX "cookie_sets_org_deleted_idx" ON "public"."cookie_sets" USING "btree" ("org_id", "deleted_at");



CREATE INDEX "handoffs_inbox" ON "public"."handoffs" USING "btree" ("to_user", "status");



CREATE INDEX "handoffs_org_idx" ON "public"."handoffs" USING "btree" ("org_id", "status");



CREATE UNIQUE INDEX "handoffs_pending_unique" ON "public"."handoffs" USING "btree" ("org_id", "kind", "item_id", "to_user") WHERE ("status" = 'pending'::"text");



CREATE INDEX "idx_api_tokens_org" ON "public"."api_tokens" USING "btree" ("org_id");



CREATE INDEX "idx_api_tokens_user" ON "public"."api_tokens" USING "btree" ("user_id");



CREATE INDEX "idx_cookie_sets_org" ON "public"."cookie_sets" USING "btree" ("org_id");



CREATE INDEX "idx_custom_statuses_org" ON "public"."custom_statuses" USING "btree" ("org_id");



CREATE INDEX "idx_folders_org" ON "public"."folders" USING "btree" ("org_id");



CREATE INDEX "idx_folders_parent" ON "public"."folders" USING "btree" ("parent_id");



CREATE INDEX "idx_org_members_user" ON "public"."org_members" USING "btree" ("user_id");



CREATE INDEX "idx_payment_events_org" ON "public"."payment_events" USING "btree" ("org_id");



CREATE INDEX "idx_profiles_cookie_set" ON "public"."profiles" USING "btree" ("cookie_set_id");



CREATE INDEX "idx_profiles_folder" ON "public"."profiles" USING "btree" ("folder_id");



CREATE INDEX "idx_profiles_org" ON "public"."profiles" USING "btree" ("org_id");



CREATE INDEX "idx_profiles_org_active" ON "public"."profiles" USING "btree" ("org_id") WHERE ("deleted_at" IS NULL);



CREATE INDEX "idx_profiles_proxy" ON "public"."profiles" USING "btree" ("proxy_id");



CREATE INDEX "idx_proxies_org" ON "public"."proxies" USING "btree" ("org_id");



CREATE INDEX "idx_shared_bookmarks_org" ON "public"."shared_bookmarks" USING "btree" ("org_id");



CREATE INDEX "idx_shared_extensions_org" ON "public"."shared_extensions" USING "btree" ("org_id");



CREATE INDEX "idx_subscriptions_org" ON "public"."subscriptions" USING "btree" ("org_id");



CREATE INDEX "org_invites_org_idx" ON "public"."org_invites" USING "btree" ("org_id", "status");



CREATE UNIQUE INDEX "org_invites_pending_email" ON "public"."org_invites" USING "btree" ("org_id", "lower"("email")) WHERE ("status" = 'pending'::"text");



CREATE INDEX "organizations_profile_idx" ON "public"."organizations" USING "btree" ("org_type", "country");



CREATE INDEX "profiles_assigned_idx" ON "public"."profiles" USING "btree" ("org_id", "assigned_to") WHERE ("assigned_to" IS NOT NULL);



CREATE INDEX "proxies_assigned_idx" ON "public"."proxies" USING "btree" ("org_id", "assigned_to") WHERE ("assigned_to" IS NOT NULL);



CREATE OR REPLACE TRIGGER "trg_profiles_updated_at" BEFORE UPDATE ON "prelaunch"."profiles" FOR EACH ROW EXECUTE FUNCTION "prelaunch"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_automation_limit" BEFORE INSERT ON "public"."automations" FOR EACH ROW EXECUTE FUNCTION "public"."enforce_automation_limit"();



CREATE OR REPLACE TRIGGER "trg_profile_limit" BEFORE INSERT ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "public"."enforce_profile_limit"();



CREATE OR REPLACE TRIGGER "trg_profile_limit_restore" BEFORE UPDATE ON "public"."profiles" FOR EACH ROW WHEN ((("old"."deleted_at" IS NOT NULL) AND ("new"."deleted_at" IS NULL))) EXECUTE FUNCTION "public"."enforce_profile_limit"();



CREATE OR REPLACE TRIGGER "trg_seat_limit" BEFORE INSERT ON "public"."org_members" FOR EACH ROW EXECUTE FUNCTION "public"."enforce_seat_limit"();



ALTER TABLE ONLY "prelaunch"."admins"
    ADD CONSTRAINT "admins_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "prelaunch"."api_keys"
    ADD CONSTRAINT "api_keys_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "prelaunch"."api_keys"
    ADD CONSTRAINT "api_keys_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "prelaunch"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "prelaunch"."audit_logs"
    ADD CONSTRAINT "audit_logs_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "prelaunch"."audit_logs"
    ADD CONSTRAINT "audit_logs_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "prelaunch"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "prelaunch"."entitlements"
    ADD CONSTRAINT "entitlements_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "prelaunch"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "prelaunch"."folders"
    ADD CONSTRAINT "folders_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "prelaunch"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "prelaunch"."folders"
    ADD CONSTRAINT "folders_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "prelaunch"."folders"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "prelaunch"."org_members"
    ADD CONSTRAINT "org_members_invited_by_fkey" FOREIGN KEY ("invited_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "prelaunch"."org_members"
    ADD CONSTRAINT "org_members_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "prelaunch"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "prelaunch"."org_members"
    ADD CONSTRAINT "org_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "prelaunch"."organizations"
    ADD CONSTRAINT "organizations_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "prelaunch"."profiles"
    ADD CONSTRAINT "profiles_folder_id_fkey" FOREIGN KEY ("folder_id") REFERENCES "prelaunch"."folders"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "prelaunch"."profiles"
    ADD CONSTRAINT "profiles_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "prelaunch"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "prelaunch"."profiles"
    ADD CONSTRAINT "profiles_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "prelaunch"."profiles"
    ADD CONSTRAINT "profiles_proxy_id_fkey" FOREIGN KEY ("proxy_id") REFERENCES "prelaunch"."proxies"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "prelaunch"."proxies"
    ADD CONSTRAINT "proxies_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "prelaunch"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "prelaunch"."scenario_runs"
    ADD CONSTRAINT "scenario_runs_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "prelaunch"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "prelaunch"."scenario_runs"
    ADD CONSTRAINT "scenario_runs_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "prelaunch"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "prelaunch"."scenario_runs"
    ADD CONSTRAINT "scenario_runs_scenario_id_fkey" FOREIGN KEY ("scenario_id") REFERENCES "prelaunch"."scenarios"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "prelaunch"."scenarios"
    ADD CONSTRAINT "scenarios_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "prelaunch"."scenarios"
    ADD CONSTRAINT "scenarios_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "prelaunch"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "prelaunch"."subscriptions"
    ADD CONSTRAINT "subscriptions_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "prelaunch"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "prelaunch"."support_tickets"
    ADD CONSTRAINT "support_tickets_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "prelaunch"."organizations"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "prelaunch"."support_tickets"
    ADD CONSTRAINT "support_tickets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "prelaunch"."team_members"
    ADD CONSTRAINT "team_members_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "prelaunch"."teams"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "prelaunch"."team_members"
    ADD CONSTRAINT "team_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "prelaunch"."teams"
    ADD CONSTRAINT "teams_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "prelaunch"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."api_tokens"
    ADD CONSTRAINT "api_tokens_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."api_tokens"
    ADD CONSTRAINT "api_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."automation_runs"
    ADD CONSTRAINT "automation_runs_automation_id_fkey" FOREIGN KEY ("automation_id") REFERENCES "public"."automations"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."automation_runs"
    ADD CONSTRAINT "automation_runs_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."automations"
    ADD CONSTRAINT "automations_assigned_to_fkey" FOREIGN KEY ("assigned_to") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."automations"
    ADD CONSTRAINT "automations_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."cookie_sets"
    ADD CONSTRAINT "cookie_sets_assigned_to_fkey" FOREIGN KEY ("assigned_to") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."cookie_sets"
    ADD CONSTRAINT "cookie_sets_folder_id_fkey" FOREIGN KEY ("folder_id") REFERENCES "public"."folders"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."cookie_sets"
    ADD CONSTRAINT "cookie_sets_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."custom_statuses"
    ADD CONSTRAINT "custom_statuses_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."folders"
    ADD CONSTRAINT "folders_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."folders"
    ADD CONSTRAINT "folders_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "public"."folders"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."handoffs"
    ADD CONSTRAINT "handoffs_from_user_fkey" FOREIGN KEY ("from_user") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."handoffs"
    ADD CONSTRAINT "handoffs_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."handoffs"
    ADD CONSTRAINT "handoffs_to_user_fkey" FOREIGN KEY ("to_user") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."org_invites"
    ADD CONSTRAINT "org_invites_accepted_by_fkey" FOREIGN KEY ("accepted_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."org_invites"
    ADD CONSTRAINT "org_invites_invited_by_fkey" FOREIGN KEY ("invited_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."org_invites"
    ADD CONSTRAINT "org_invites_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."org_members"
    ADD CONSTRAINT "org_members_invited_by_fkey" FOREIGN KEY ("invited_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."org_members"
    ADD CONSTRAINT "org_members_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."org_members"
    ADD CONSTRAINT "org_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."organizations"
    ADD CONSTRAINT "organizations_plan_fkey" FOREIGN KEY ("plan") REFERENCES "public"."plans"("key");



ALTER TABLE ONLY "public"."payment_events"
    ADD CONSTRAINT "payment_events_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_assigned_to_fkey" FOREIGN KEY ("assigned_to") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_automation_id_fkey" FOREIGN KEY ("automation_id") REFERENCES "public"."automations"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_cookie_set_id_fkey" FOREIGN KEY ("cookie_set_id") REFERENCES "public"."cookie_sets"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_folder_id_fkey" FOREIGN KEY ("folder_id") REFERENCES "public"."folders"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_proxy_id_fkey" FOREIGN KEY ("proxy_id") REFERENCES "public"."proxies"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."proxies"
    ADD CONSTRAINT "proxies_assigned_to_fkey" FOREIGN KEY ("assigned_to") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."proxies"
    ADD CONSTRAINT "proxies_folder_id_fkey" FOREIGN KEY ("folder_id") REFERENCES "public"."folders"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."proxies"
    ADD CONSTRAINT "proxies_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."shared_bookmarks"
    ADD CONSTRAINT "shared_bookmarks_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."shared_extensions"
    ADD CONSTRAINT "shared_extensions_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."subscriptions"
    ADD CONSTRAINT "subscriptions_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."subscriptions"
    ADD CONSTRAINT "subscriptions_plan_fkey" FOREIGN KEY ("plan") REFERENCES "public"."plans"("key");



ALTER TABLE "prelaunch"."admins" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "prelaunch"."api_keys" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "prelaunch"."audit_logs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "audit_select" ON "prelaunch"."audit_logs" FOR SELECT TO "authenticated" USING ("prelaunch"."auth_has_role"("org_id", ARRAY['owner'::"text", 'admin'::"text"]));



CREATE POLICY "ent_select" ON "prelaunch"."entitlements" FOR SELECT TO "authenticated" USING (("org_id" IN ( SELECT "prelaunch"."auth_org_ids"() AS "auth_org_ids")));



ALTER TABLE "prelaunch"."entitlements" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "prelaunch"."folders" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "folders_select" ON "prelaunch"."folders" FOR SELECT TO "authenticated" USING (("org_id" IN ( SELECT "prelaunch"."auth_org_ids"() AS "auth_org_ids")));



CREATE POLICY "folders_write" ON "prelaunch"."folders" TO "authenticated" USING ("prelaunch"."auth_has_role"("org_id", ARRAY['owner'::"text", 'admin'::"text", 'manager'::"text", 'operator'::"text"])) WITH CHECK ("prelaunch"."auth_has_role"("org_id", ARRAY['owner'::"text", 'admin'::"text", 'manager'::"text", 'operator'::"text"]));



CREATE POLICY "keys_select" ON "prelaunch"."api_keys" FOR SELECT TO "authenticated" USING ("prelaunch"."auth_has_role"("org_id", ARRAY['owner'::"text", 'admin'::"text"]));



CREATE POLICY "keys_write" ON "prelaunch"."api_keys" TO "authenticated" USING ("prelaunch"."auth_has_role"("org_id", ARRAY['owner'::"text", 'admin'::"text"])) WITH CHECK ("prelaunch"."auth_has_role"("org_id", ARRAY['owner'::"text", 'admin'::"text"]));



CREATE POLICY "mem_select" ON "prelaunch"."org_members" FOR SELECT TO "authenticated" USING (("org_id" IN ( SELECT "prelaunch"."auth_org_ids"() AS "auth_org_ids")));



CREATE POLICY "mem_write" ON "prelaunch"."org_members" TO "authenticated" USING ("prelaunch"."auth_has_role"("org_id", ARRAY['owner'::"text", 'admin'::"text"])) WITH CHECK ("prelaunch"."auth_has_role"("org_id", ARRAY['owner'::"text", 'admin'::"text"]));



CREATE POLICY "org_delete" ON "prelaunch"."organizations" FOR DELETE TO "authenticated" USING ("prelaunch"."auth_has_role"("id", ARRAY['owner'::"text"]));



ALTER TABLE "prelaunch"."org_members" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "org_select" ON "prelaunch"."organizations" FOR SELECT TO "authenticated" USING (("id" IN ( SELECT "prelaunch"."auth_org_ids"() AS "auth_org_ids")));



CREATE POLICY "org_update" ON "prelaunch"."organizations" FOR UPDATE TO "authenticated" USING ("prelaunch"."auth_has_role"("id", ARRAY['owner'::"text", 'admin'::"text"])) WITH CHECK ("prelaunch"."auth_has_role"("id", ARRAY['owner'::"text", 'admin'::"text"]));



ALTER TABLE "prelaunch"."organizations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "prelaunch"."profiles" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "profiles_select" ON "prelaunch"."profiles" FOR SELECT TO "authenticated" USING (("org_id" IN ( SELECT "prelaunch"."auth_org_ids"() AS "auth_org_ids")));



CREATE POLICY "profiles_write" ON "prelaunch"."profiles" TO "authenticated" USING ("prelaunch"."auth_has_role"("org_id", ARRAY['owner'::"text", 'admin'::"text", 'manager'::"text", 'operator'::"text"])) WITH CHECK ("prelaunch"."auth_has_role"("org_id", ARRAY['owner'::"text", 'admin'::"text", 'manager'::"text", 'operator'::"text"]));



ALTER TABLE "prelaunch"."proxies" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "proxies_select" ON "prelaunch"."proxies" FOR SELECT TO "authenticated" USING (("org_id" IN ( SELECT "prelaunch"."auth_org_ids"() AS "auth_org_ids")));



CREATE POLICY "proxies_write" ON "prelaunch"."proxies" TO "authenticated" USING ("prelaunch"."auth_has_role"("org_id", ARRAY['owner'::"text", 'admin'::"text", 'manager'::"text", 'operator'::"text"])) WITH CHECK ("prelaunch"."auth_has_role"("org_id", ARRAY['owner'::"text", 'admin'::"text", 'manager'::"text", 'operator'::"text"]));



CREATE POLICY "runs_select" ON "prelaunch"."scenario_runs" FOR SELECT TO "authenticated" USING (("org_id" IN ( SELECT "prelaunch"."auth_org_ids"() AS "auth_org_ids")));



CREATE POLICY "runs_write" ON "prelaunch"."scenario_runs" TO "authenticated" USING ("prelaunch"."auth_has_role"("org_id", ARRAY['owner'::"text", 'admin'::"text", 'manager'::"text", 'operator'::"text"])) WITH CHECK ("prelaunch"."auth_has_role"("org_id", ARRAY['owner'::"text", 'admin'::"text", 'manager'::"text", 'operator'::"text"]));



ALTER TABLE "prelaunch"."scenario_runs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "prelaunch"."scenarios" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "scenarios_select" ON "prelaunch"."scenarios" FOR SELECT TO "authenticated" USING (("org_id" IN ( SELECT "prelaunch"."auth_org_ids"() AS "auth_org_ids")));



CREATE POLICY "scenarios_write" ON "prelaunch"."scenarios" TO "authenticated" USING ("prelaunch"."auth_has_role"("org_id", ARRAY['owner'::"text", 'admin'::"text", 'manager'::"text", 'operator'::"text"])) WITH CHECK ("prelaunch"."auth_has_role"("org_id", ARRAY['owner'::"text", 'admin'::"text", 'manager'::"text", 'operator'::"text"]));



CREATE POLICY "subs_select" ON "prelaunch"."subscriptions" FOR SELECT TO "authenticated" USING (("org_id" IN ( SELECT "prelaunch"."auth_org_ids"() AS "auth_org_ids")));



ALTER TABLE "prelaunch"."subscriptions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "support_insert_own" ON "prelaunch"."support_tickets" FOR INSERT WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "support_select_own" ON "prelaunch"."support_tickets" FOR SELECT USING (("user_id" = "auth"."uid"()));



ALTER TABLE "prelaunch"."support_tickets" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "prelaunch"."team_members" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "prelaunch"."teams" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "teams_select" ON "prelaunch"."teams" FOR SELECT TO "authenticated" USING (("org_id" IN ( SELECT "prelaunch"."auth_org_ids"() AS "auth_org_ids")));



CREATE POLICY "teams_write" ON "prelaunch"."teams" TO "authenticated" USING ("prelaunch"."auth_has_role"("org_id", ARRAY['owner'::"text", 'admin'::"text", 'manager'::"text"])) WITH CHECK ("prelaunch"."auth_has_role"("org_id", ARRAY['owner'::"text", 'admin'::"text", 'manager'::"text"]));



CREATE POLICY "tm_select" ON "prelaunch"."team_members" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "prelaunch"."teams" "t"
  WHERE (("t"."id" = "team_members"."team_id") AND ("t"."org_id" IN ( SELECT "prelaunch"."auth_org_ids"() AS "auth_org_ids"))))));



CREATE POLICY "tm_write" ON "prelaunch"."team_members" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "prelaunch"."teams" "t"
  WHERE (("t"."id" = "team_members"."team_id") AND "prelaunch"."auth_has_role"("t"."org_id", ARRAY['owner'::"text", 'admin'::"text", 'manager'::"text"]))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "prelaunch"."teams" "t"
  WHERE (("t"."id" = "team_members"."team_id") AND "prelaunch"."auth_has_role"("t"."org_id", ARRAY['owner'::"text", 'admin'::"text", 'manager'::"text"])))));



ALTER TABLE "public"."api_tokens" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "api_tokens_delete" ON "public"."api_tokens" FOR DELETE TO "authenticated" USING ("public"."is_org_owner"("org_id"));



CREATE POLICY "api_tokens_insert" ON "public"."api_tokens" FOR INSERT TO "authenticated" WITH CHECK ("public"."is_org_owner"("org_id"));



CREATE POLICY "api_tokens_select" ON "public"."api_tokens" FOR SELECT TO "authenticated" USING ("public"."is_org_member"("org_id"));



CREATE POLICY "api_tokens_update" ON "public"."api_tokens" FOR UPDATE TO "authenticated" USING ("public"."is_org_owner"("org_id")) WITH CHECK ("public"."is_org_owner"("org_id"));



ALTER TABLE "public"."automation_runs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."automations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."cookie_sets" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "cookie_sets_delete" ON "public"."cookie_sets" FOR DELETE TO "authenticated" USING ("public"."is_org_member"("org_id"));



CREATE POLICY "cookie_sets_insert" ON "public"."cookie_sets" FOR INSERT TO "authenticated" WITH CHECK ("public"."is_org_member"("org_id"));



CREATE POLICY "cookie_sets_select" ON "public"."cookie_sets" FOR SELECT TO "authenticated" USING ("public"."is_org_member"("org_id"));



CREATE POLICY "cookie_sets_update" ON "public"."cookie_sets" FOR UPDATE TO "authenticated" USING ("public"."is_org_member"("org_id")) WITH CHECK ("public"."is_org_member"("org_id"));



ALTER TABLE "public"."custom_statuses" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "custom_statuses_delete" ON "public"."custom_statuses" FOR DELETE TO "authenticated" USING ("public"."is_org_member"("org_id"));



CREATE POLICY "custom_statuses_insert" ON "public"."custom_statuses" FOR INSERT TO "authenticated" WITH CHECK ("public"."is_org_member"("org_id"));



CREATE POLICY "custom_statuses_select" ON "public"."custom_statuses" FOR SELECT TO "authenticated" USING ("public"."is_org_member"("org_id"));



CREATE POLICY "custom_statuses_update" ON "public"."custom_statuses" FOR UPDATE TO "authenticated" USING ("public"."is_org_member"("org_id")) WITH CHECK ("public"."is_org_member"("org_id"));



ALTER TABLE "public"."folders" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "folders_delete" ON "public"."folders" FOR DELETE TO "authenticated" USING ("public"."is_org_member"("org_id"));



CREATE POLICY "folders_insert" ON "public"."folders" FOR INSERT TO "authenticated" WITH CHECK ("public"."is_org_member"("org_id"));



CREATE POLICY "folders_select" ON "public"."folders" FOR SELECT TO "authenticated" USING ("public"."is_org_member"("org_id"));



CREATE POLICY "folders_update" ON "public"."folders" FOR UPDATE TO "authenticated" USING ("public"."is_org_member"("org_id")) WITH CHECK ("public"."is_org_member"("org_id"));



ALTER TABLE "public"."handoffs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "handoffs_select" ON "public"."handoffs" FOR SELECT TO "authenticated" USING ("public"."is_org_member"("org_id"));



CREATE POLICY "org members delete automations" ON "public"."automations" FOR DELETE TO "authenticated" USING ("public"."is_org_member"("org_id"));



CREATE POLICY "org members delete runs" ON "public"."automation_runs" FOR DELETE TO "authenticated" USING ("public"."is_org_member"("org_id"));



CREATE POLICY "org members insert automations" ON "public"."automations" FOR INSERT TO "authenticated" WITH CHECK ("public"."is_org_member"("org_id"));



CREATE POLICY "org members insert runs" ON "public"."automation_runs" FOR INSERT TO "authenticated" WITH CHECK ("public"."is_org_member"("org_id"));



CREATE POLICY "org members read automations" ON "public"."automations" FOR SELECT TO "authenticated" USING ("public"."is_org_member"("org_id"));



CREATE POLICY "org members read runs" ON "public"."automation_runs" FOR SELECT TO "authenticated" USING ("public"."is_org_member"("org_id"));



CREATE POLICY "org members update automations" ON "public"."automations" FOR UPDATE TO "authenticated" USING ("public"."is_org_member"("org_id")) WITH CHECK ("public"."is_org_member"("org_id"));



CREATE POLICY "org members update runs" ON "public"."automation_runs" FOR UPDATE TO "authenticated" USING ("public"."is_org_member"("org_id")) WITH CHECK ("public"."is_org_member"("org_id"));



ALTER TABLE "public"."org_invites" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "org_invites_delete" ON "public"."org_invites" FOR DELETE TO "authenticated" USING ("public"."is_org_owner"("org_id"));



CREATE POLICY "org_invites_select" ON "public"."org_invites" FOR SELECT TO "authenticated" USING ("public"."is_org_owner"("org_id"));



CREATE POLICY "org_invites_update" ON "public"."org_invites" FOR UPDATE TO "authenticated" USING ("public"."is_org_owner"("org_id")) WITH CHECK ("public"."is_org_owner"("org_id"));



ALTER TABLE "public"."org_members" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "org_members_delete" ON "public"."org_members" FOR DELETE TO "authenticated" USING ((("role" <> 'owner'::"text") AND ("public"."is_org_owner"("org_id") OR ("user_id" = "auth"."uid"()))));



CREATE POLICY "org_members_select" ON "public"."org_members" FOR SELECT TO "authenticated" USING ("public"."is_org_member"("org_id"));



ALTER TABLE "public"."organizations" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "organizations_select" ON "public"."organizations" FOR SELECT TO "authenticated" USING ("public"."is_org_member"("id"));



CREATE POLICY "organizations_update" ON "public"."organizations" FOR UPDATE TO "authenticated" USING ("public"."is_org_member"("id")) WITH CHECK ("public"."is_org_member"("id"));



ALTER TABLE "public"."payment_events" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."plan_terms" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "plan_terms_select" ON "public"."plan_terms" FOR SELECT TO "authenticated", "anon" USING (true);



ALTER TABLE "public"."plans" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "plans_select" ON "public"."plans" FOR SELECT TO "authenticated", "anon" USING (true);



ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "profiles_delete" ON "public"."profiles" FOR DELETE TO "authenticated" USING ("public"."is_org_member"("org_id"));



CREATE POLICY "profiles_insert" ON "public"."profiles" FOR INSERT TO "authenticated" WITH CHECK ("public"."is_org_member"("org_id"));



CREATE POLICY "profiles_select" ON "public"."profiles" FOR SELECT TO "authenticated" USING ("public"."is_org_member"("org_id"));



CREATE POLICY "profiles_update" ON "public"."profiles" FOR UPDATE TO "authenticated" USING ("public"."is_org_member"("org_id")) WITH CHECK ("public"."is_org_member"("org_id"));



ALTER TABLE "public"."proxies" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "proxies_delete" ON "public"."proxies" FOR DELETE TO "authenticated" USING ("public"."is_org_member"("org_id"));



CREATE POLICY "proxies_insert" ON "public"."proxies" FOR INSERT TO "authenticated" WITH CHECK ("public"."is_org_member"("org_id"));



CREATE POLICY "proxies_select" ON "public"."proxies" FOR SELECT TO "authenticated" USING ("public"."is_org_member"("org_id"));



CREATE POLICY "proxies_update" ON "public"."proxies" FOR UPDATE TO "authenticated" USING ("public"."is_org_member"("org_id")) WITH CHECK ("public"."is_org_member"("org_id"));



ALTER TABLE "public"."shared_bookmarks" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "shared_bookmarks_delete" ON "public"."shared_bookmarks" FOR DELETE TO "authenticated" USING ("public"."is_org_member"("org_id"));



CREATE POLICY "shared_bookmarks_insert" ON "public"."shared_bookmarks" FOR INSERT TO "authenticated" WITH CHECK ("public"."is_org_member"("org_id"));



CREATE POLICY "shared_bookmarks_select" ON "public"."shared_bookmarks" FOR SELECT TO "authenticated" USING ("public"."is_org_member"("org_id"));



CREATE POLICY "shared_bookmarks_update" ON "public"."shared_bookmarks" FOR UPDATE TO "authenticated" USING ("public"."is_org_member"("org_id")) WITH CHECK ("public"."is_org_member"("org_id"));



ALTER TABLE "public"."shared_extensions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "shared_extensions_delete" ON "public"."shared_extensions" FOR DELETE TO "authenticated" USING ("public"."is_org_member"("org_id"));



CREATE POLICY "shared_extensions_insert" ON "public"."shared_extensions" FOR INSERT TO "authenticated" WITH CHECK ("public"."is_org_member"("org_id"));



CREATE POLICY "shared_extensions_select" ON "public"."shared_extensions" FOR SELECT TO "authenticated" USING ("public"."is_org_member"("org_id"));



CREATE POLICY "shared_extensions_update" ON "public"."shared_extensions" FOR UPDATE TO "authenticated" USING ("public"."is_org_member"("org_id")) WITH CHECK ("public"."is_org_member"("org_id"));



ALTER TABLE "public"."subscriptions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "subscriptions_select" ON "public"."subscriptions" FOR SELECT TO "authenticated" USING ("public"."is_org_member"("org_id"));





ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";


GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";






















































































































































GRANT ALL ON FUNCTION "prelaunch"."apply_plan_entitlements"("p_org" "uuid", "p_plan" "text") TO "service_role";



GRANT ALL ON FUNCTION "prelaunch"."auth_has_role"("p_org" "uuid", "p_roles" "text"[]) TO "service_role";



GRANT ALL ON FUNCTION "prelaunch"."auth_org_ids"() TO "service_role";



GRANT ALL ON FUNCTION "prelaunch"."handle_new_user"() TO "service_role";



GRANT ALL ON FUNCTION "prelaunch"."set_updated_at"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."accept_handoff"("p_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."accept_handoff"("p_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."accept_handoff"("p_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."accept_org_invite"("p_token" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."accept_org_invite"("p_token" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."accept_org_invite"("p_token" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."apply_plan_entitlements"("p_org" "uuid", "p_plan" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."apply_plan_entitlements"("p_org" "uuid", "p_plan" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."bootstrap_org"("org_name" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."bootstrap_org"("org_name" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."bootstrap_org"("org_name" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."cancel_handoff"("p_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."cancel_handoff"("p_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."cancel_handoff"("p_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."create_org_invite"("p_org" "uuid", "p_email" "text", "p_role" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_org_invite"("p_org" "uuid", "p_email" "text", "p_role" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_org_invite"("p_org" "uuid", "p_email" "text", "p_role" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."decline_handoff"("p_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."decline_handoff"("p_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."decline_handoff"("p_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."enforce_automation_limit"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."enforce_automation_limit"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."enforce_profile_limit"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."enforce_profile_limit"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."enforce_seat_limit"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."enforce_seat_limit"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."is_org_admin"("target" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_org_admin"("target" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_org_admin"("target" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."is_org_member"("target" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_org_member"("target" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_org_member"("target" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."is_org_owner"("target" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_org_owner"("target" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_org_owner"("target" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."offer_handoff"("p_org" "uuid", "p_kind" "text", "p_ids" "text"[], "p_to" "uuid", "p_note" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."offer_handoff"("p_org" "uuid", "p_kind" "text", "p_ids" "text"[], "p_to" "uuid", "p_note" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."offer_handoff"("p_org" "uuid", "p_kind" "text", "p_ids" "text"[], "p_to" "uuid", "p_note" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."org_members_with_identity"("p_org" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."org_members_with_identity"("p_org" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."org_members_with_identity"("p_org" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."peek_org_invite"("p_token" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."peek_org_invite"("p_token" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."peek_org_invite"("p_token" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."set_assignee"("p_org" "uuid", "p_kind" "text", "p_id" "text", "p_to" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."set_assignee"("p_org" "uuid", "p_kind" "text", "p_id" "text", "p_to" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_assignee"("p_org" "uuid", "p_kind" "text", "p_id" "text", "p_to" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."set_assignees"("p_org" "uuid", "p_kind" "text", "p_ids" "text"[], "p_to" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."set_assignees"("p_org" "uuid", "p_kind" "text", "p_ids" "text"[], "p_to" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_assignees"("p_org" "uuid", "p_kind" "text", "p_ids" "text"[], "p_to" "uuid") TO "service_role";


















GRANT ALL ON TABLE "prelaunch"."admins" TO "service_role";



GRANT ALL ON TABLE "prelaunch"."api_keys" TO "service_role";



GRANT ALL ON TABLE "prelaunch"."audit_logs" TO "service_role";



GRANT ALL ON TABLE "prelaunch"."entitlements" TO "service_role";



GRANT ALL ON TABLE "prelaunch"."folders" TO "service_role";



GRANT ALL ON TABLE "prelaunch"."org_members" TO "service_role";



GRANT ALL ON TABLE "prelaunch"."organizations" TO "service_role";



GRANT ALL ON TABLE "prelaunch"."profiles" TO "service_role";



GRANT ALL ON TABLE "prelaunch"."proxies" TO "service_role";



GRANT ALL ON TABLE "prelaunch"."scenario_runs" TO "service_role";



GRANT ALL ON TABLE "prelaunch"."scenarios" TO "service_role";



GRANT ALL ON TABLE "prelaunch"."subscriptions" TO "service_role";



GRANT ALL ON TABLE "prelaunch"."support_tickets" TO "service_role";



GRANT ALL ON TABLE "prelaunch"."team_members" TO "service_role";



GRANT ALL ON TABLE "prelaunch"."teams" TO "service_role";



GRANT ALL ON TABLE "public"."api_tokens" TO "authenticated";
GRANT ALL ON TABLE "public"."api_tokens" TO "service_role";



GRANT ALL ON TABLE "public"."automation_runs" TO "authenticated";
GRANT ALL ON TABLE "public"."automation_runs" TO "service_role";



GRANT ALL ON TABLE "public"."automations" TO "authenticated";
GRANT ALL ON TABLE "public"."automations" TO "service_role";



GRANT ALL ON TABLE "public"."cookie_sets" TO "authenticated";
GRANT ALL ON TABLE "public"."cookie_sets" TO "service_role";



GRANT ALL ON TABLE "public"."custom_statuses" TO "authenticated";
GRANT ALL ON TABLE "public"."custom_statuses" TO "service_role";



GRANT ALL ON TABLE "public"."folders" TO "authenticated";
GRANT ALL ON TABLE "public"."folders" TO "service_role";



GRANT ALL ON TABLE "public"."handoffs" TO "authenticated";
GRANT ALL ON TABLE "public"."handoffs" TO "service_role";



GRANT SELECT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."org_invites" TO "authenticated";
GRANT ALL ON TABLE "public"."org_invites" TO "service_role";



GRANT UPDATE("status") ON TABLE "public"."org_invites" TO "authenticated";



GRANT SELECT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."org_members" TO "authenticated";
GRANT ALL ON TABLE "public"."org_members" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."organizations" TO "authenticated";
GRANT ALL ON TABLE "public"."organizations" TO "service_role";



GRANT UPDATE("name") ON TABLE "public"."organizations" TO "authenticated";



GRANT UPDATE("built_in_extensions") ON TABLE "public"."organizations" TO "authenticated";



GRANT UPDATE("org_type") ON TABLE "public"."organizations" TO "authenticated";



GRANT UPDATE("legal_name") ON TABLE "public"."organizations" TO "authenticated";



GRANT UPDATE("country") ON TABLE "public"."organizations" TO "authenticated";



GRANT UPDATE("website") ON TABLE "public"."organizations" TO "authenticated";



GRANT UPDATE("logo_url") ON TABLE "public"."organizations" TO "authenticated";



GRANT UPDATE("onboarded_at") ON TABLE "public"."organizations" TO "authenticated";



GRANT ALL ON TABLE "public"."payment_events" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."plan_terms" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."plan_terms" TO "authenticated";
GRANT ALL ON TABLE "public"."plan_terms" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."plans" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."plans" TO "authenticated";
GRANT ALL ON TABLE "public"."plans" TO "service_role";



GRANT ALL ON TABLE "public"."profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."profiles" TO "service_role";



GRANT ALL ON TABLE "public"."proxies" TO "authenticated";
GRANT ALL ON TABLE "public"."proxies" TO "service_role";



GRANT ALL ON TABLE "public"."shared_bookmarks" TO "authenticated";
GRANT ALL ON TABLE "public"."shared_bookmarks" TO "service_role";



GRANT ALL ON TABLE "public"."shared_extensions" TO "authenticated";
GRANT ALL ON TABLE "public"."shared_extensions" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."subscriptions" TO "authenticated";
GRANT ALL ON TABLE "public"."subscriptions" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";































