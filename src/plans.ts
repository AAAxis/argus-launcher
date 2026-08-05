// Plan names and prices, for display only.
//
// The source of truth is landing/lib/plans.ts, which is itself pinned to
// `apply_plan_entitlements` in the database -- the entitlement numbers are
// enforced there and by the desktop, never by this file. The launcher is a
// separate repo and cannot import across the boundary, so this is a hand-kept
// mirror: if a plan is renamed or repriced on the site, change it here too.
//
// Note the labels deliberately differ from the keys: `pro` is sold as "Team"
// and `team` as "Enterprise" (founder's decision, recorded in landing/lib).
export type PlanKey = 'free' | 'base' | 'pro' | 'team';

export type PlanInfo = {
  key: PlanKey;
  label: string;
  priceMonthly: number;
  // Marketing copy only, for "upgrade to get N seats" wording. The number that
  // decides anything is organizations.seat_limit, set by
  // apply_plan_entitlements and enforced by trg_seat_limit -- src/team/limit.ts
  // reads that and never this, precisely so a stale mirror cannot gate a
  // feature.
  seats: number;
};

export const PLANS: Record<PlanKey, PlanInfo> = {
  free: {key: 'free', label: 'Free', priceMonthly: 0, seats: 1},
  // One seat, deliberately: teams are what the next tier up buys, so a Base
  // workspace gets the Team tab's upsell rather than a roster of one.
  base: {key: 'base', label: 'Base', priceMonthly: 89, seats: 1},
  pro: {key: 'pro', label: 'Team', priceMonthly: 159, seats: 10},
  team: {key: 'team', label: 'Enterprise', priceMonthly: 299, seats: 25},
};

export function isPlanKey(value: unknown): value is PlanKey {
  return value === 'free' || value === 'base' || value === 'pro' || value === 'team';
}

// An unknown plan string is shown as itself rather than silently as "Free": the
// database is authoritative, and a plan this build has never heard of means the
// mirror above is stale, which the user should be able to see and report.
export function planLabel(plan: string | null | undefined): string {
  if (isPlanKey(plan)) {
    return PLANS[plan].label;
  }
  return plan || 'Free';
}

export function planPrice(plan: string | null | undefined): number | null {
  return isPlanKey(plan) ? PLANS[plan].priceMonthly : null;
}

// True when there is a higher tier to sell. Drives whether the plan section
// offers "Upgrade plan" or only "Manage billing".
export function hasUpgrade(plan: string | null | undefined): boolean {
  const price = planPrice(plan);
  return price === null || price < PLANS.team.priceMonthly;
}
