-- bootstrap_org: make it safe against concurrent callers.
--
-- The function has always been described as idempotent, and it read that way:
-- look for an existing membership, return it if there is one, otherwise create
-- the org. But "check, then insert" is only idempotent when the two steps
-- cannot interleave with another session's, and nothing here stopped them.
--
-- Two concurrent transactions both take their snapshot before either inserts,
-- so both see no membership and both proceed to create one. On 2026-08-06 a
-- single web sign-in did exactly that -- the client fired router.push() and
-- router.refresh() together, /onboarding rendered twice, and the account came
-- out owning two identical "<domain> team" organizations 12ms apart, each with
-- its own org_members row.
--
-- A unique constraint is not the tool: being a member of several organizations
-- is legitimate (that is what accepting an invite does), so there is no column
-- combination that is unique in the general case and only wrong here.
--
-- A transaction-scoped advisory lock keyed on the user is. It serializes just
-- the bootstraps for one account, takes no table locks, blocks nothing else,
-- and is released on commit or rollback -- including when the statement times
-- out, which a lock row would not be.
--
-- The re-check after the lock is the point of the exercise: the second caller
-- blocks, then wakes with the first caller's committed org_members row visible
-- and returns it. Read committed is what makes that work -- each statement in
-- a plpgsql function takes a fresh snapshot, so the select below sees rows
-- committed while we waited.
create or replace function public.bootstrap_org(org_name text default null::text)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  uid      uuid := auth.uid();
  existing uuid;
  new_id   uuid;
  nm       text;
begin
  if uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  -- Serialize concurrent bootstraps for this user and nobody else.
  perform pg_advisory_xact_lock(hashtextextended(uid::text, 0));

  -- Must come after the lock. Before it, this is the read that raced.
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
end $function$;
