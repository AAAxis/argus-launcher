-- 2026-08-08 -- give every organization the limits its plan actually sells.
--
-- This is a DATA repair, not a schema change. It creates nothing and alters no
-- column; it re-runs apply_plan_entitlements over rows whose limits drifted away
-- from their plan. Safe to run repeatedly -- it is idempotent by construction,
-- because apply_plan_entitlements sets absolute values rather than adjusting
-- them.
--
-- WHY THERE IS DRIFT AT ALL. Three causes, all historical and all still visible
-- in the data:
--
--   1. apply_plan_entitlements did not exist until 2026-08-05. Every upgrade
--      before that date ran applyPlanToOrg (landing/lib/entitlements.ts), which
--      sets organizations.plan at step 1 and then calls this function at step 2 --
--      so it threw, having already written the plan. The workspace was left
--      *named* for the tier it bought while keeping the limits it had.
--
--   2. bootstrap_org hardcodes seat_limit = 1 and 5 profiles, and until
--      2026-08-05-teams.sql nothing anywhere could raise them. Any workspace with
--      a team got its numbers typed in by hand.
--
--   3. Hand-typed numbers do not have to match anything. A workspace was found on
--      2026-08-08 sold as Enterprise ($299, 1000 profiles, 25 seats) while its row
--      said 300 profiles, 10 automations and 5 seats -- which is Team's profile
--      count, Team's automation count, and a seat count belonging to no plan at
--      all. The customer paid for one thing and the triggers enforced another.
--
-- The launcher used to hide this: the "Included in Enterprise" tiles rendered the
-- marketing table in src/plans.ts while the usage meters beside them rendered the
-- row, so the same screen showed 1000 and 300 at once. Both now read the row, and
-- Settings says so out loud when they disagree -- but reading it correctly does
-- not fix it. This file fixes it.


-- ── 1. Look before you write ──────────────────────────────────────────────
-- Every organization whose limits do not match its own plan, and what they
-- should be. RUN THIS FIRST and read the output -- it is the list of customers
-- who are getting something other than what they bought, in both directions.
--
-- The expected numbers are inlined rather than read from apply_plan_entitlements,
-- because a report that derives its expectation from the same function it is
-- checking cannot disagree with it. If this table and that function drift apart,
-- that is itself the finding.
with expected as (
  select * from (values
    ('free',        5,    1,   2),
    ('starter',    60,    1,   2),
    ('base',      100,    1,  10),
    ('pro',       300,   10,  10),
    ('team',     1000,   25, 100),
    ('enterprise', null, 25, 100)
  ) as t(plan, profiles, seats, automations)
)
select o.id,
       o.name,
       o.plan,
       o.profile_limit    as profiles_now,   e.profiles     as profiles_should_be,
       o.seat_limit       as seats_now,      e.seats        as seats_should_be,
       o.automation_limit as automations_now, e.automations as automations_should_be
  from public.organizations o
  join expected e on e.plan = lower(trim(o.plan))
 where o.profile_limit    is distinct from e.profiles
    or o.seat_limit       is distinct from e.seats
    or o.automation_limit is distinct from e.automations
 order by o.created_at;

-- Organizations whose plan string this mapping has never heard of. These are NOT
-- repaired below -- apply_plan_entitlements raises on an unknown plan rather than
-- quietly downgrading it, which is the right behaviour and the reason the loop
-- skips them. Expect zero rows; anything here needs a human decision about which
-- tier it should be on.
select id, name, plan, created_at
  from public.organizations
 where lower(trim(plan)) not in
       ('free', 'starter', 'base', 'pro', 'team', 'enterprise')
 order by created_at;


-- ── 2. The repair ─────────────────────────────────────────────────────────
-- Commented out on purpose. Read the two reports above first, decide that the
-- "should_be" column is what you want each of those customers to have, and only
-- then uncomment this block and run it.
--
-- It is not a blanket UPDATE: apply_plan_entitlements is the one function that
-- owns the plan -> limits mapping, and going around it here would create a
-- second copy of that mapping to keep in step. The loop just calls it once per
-- organization.
--
-- Nothing here can go the wrong way silently. An unknown plan raises inside the
-- function, which aborts the whole transaction rather than leaving half the rows
-- repaired -- so fix or exclude those rows first.
--
-- NOTE ON SEATS. Raising seat_limit is always safe. LOWERING it is not blocked by
-- anything: trg_seat_limit fires BEFORE INSERT on org_members, so a workspace
-- that already has more members than the new limit keeps all of them and simply
-- cannot add another. Nobody is removed. Check the report for any row where
-- seats_now > seats_should_be before running, and decide deliberately.

-- do $$
-- declare
--   org record;
--   n   int := 0;
-- begin
--   for org in
--     select id, plan from public.organizations
--      where lower(trim(plan)) in
--            ('free', 'starter', 'base', 'pro', 'team', 'enterprise')
--   loop
--     perform public.apply_plan_entitlements(org.id, org.plan);
--     n := n + 1;
--   end loop;
--   raise notice 'reconciled % organizations', n;
-- end $$;


-- ── 3. To repair a single workspace instead ───────────────────────────────
-- The narrow version, for the case where the report shows one row and you would
-- rather not touch the rest. Replace the uuid with the id from the report.
--
--   select public.apply_plan_entitlements(
--            '00000000-0000-0000-0000-000000000000'::uuid, 'team');


-- ── 4. Check it worked ────────────────────────────────────────────────────
-- Re-run the first query in section 1. Expect zero rows.
--
-- Then, in the launcher: Settings -> Plan & usage. The "Included in ..." tiles
-- and the usage meters must now agree with each other and with the plan name,
-- and the amber "these don't match" note must be gone. The tiles read the row
-- directly, so a stale client is not the explanation if it is still wrong.
--
-- The Team tab's seat meter and the Members meter in Settings must also show the
-- same pair of numbers -- both count members plus live pending invites, which is
-- exactly what create_org_invite reserves against.
