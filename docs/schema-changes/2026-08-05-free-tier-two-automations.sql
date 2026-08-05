-- Free accounts get two automations, not zero.
--
-- Paste into the SQL editor of Supabase project jpsmdjtxuxlkyuotwxfg and run
-- once. Safe to re-run: both statements are idempotent in effect.
--
-- Why: 2026-08-05-automations.sql shipped `automation_limit integer default 0`
-- with free/starter/base mapped to 0, on the reasoning that a free org has
-- nothing to run and so every automation path refuses it. That is airtight as a
-- gate and wrong as an onboarding story -- the entire feature was invisible to
-- everyone who had not paid, including the accounts used to demo it.
--
-- Why two and not one: the Automations tab now ships a pre-written example
-- (src/data/showcaseAutomation.ts, loaded from the empty state, which inserts
-- it as an ordinary row). At a cap of one, loading the example consumes the
-- only free slot, so the very next thing a convinced user does -- write their
-- own -- is refused, and the demo reads as a bait. Two is the example plus one
-- of their own, and the third is still the paid step.
--
-- This file was originally 2026-08-05-free-tier-one-automation.sql and was
-- renamed rather than followed up, because it had not been applied yet: two
-- files disagreeing about one number is how a cap gets set twice, differently.
--
-- The column stays service-role only (organizations' RLS update policy covers
-- name and built_in_extensions only), so an org still cannot raise its own cap.

-- ── 1. New free orgs ──────────────────────────────────────────────────────
alter table public.organizations
alter column automation_limit set default 2;

-- ── 2. Existing orgs on a free-tier plan ──────────────────────────────────
-- Only rows still sitting at 0, so an org that was deliberately zeroed by hand
-- is not silently re-granted, and no paid tier is touched.
--
-- !! The two key sets disagree (landing/LANDING.md) -- 'base' is a $89 paid tier
-- on the site but appears in the 0-mapping of the original backfill, so paying
-- base orgs are on zero automations today. Confirm with `select distinct plan,
-- automation_limit, count(*) from public.organizations group by 1,2;` before
-- running, and drop any key from the list below that is a paid tier in the live
-- key set. Raising base off 0 is a separate decision, not this file's job.
update public.organizations
set automation_limit = 2
where automation_limit = 0
  and plan in ('free', 'starter');

-- ── Check it worked ───────────────────────────────────────────────────────
-- Expect every free/starter org at 2, paid tiers unchanged (pro/team 10,
-- enterprise 100).
select plan, automation_limit, count(*)
from public.organizations
group by plan, automation_limit
order by plan;
