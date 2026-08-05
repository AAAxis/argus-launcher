-- Reference data. Not user data -- the product does not work without these two
-- tables populated, so they are seeded rather than dumped.
--
-- `plans` is the catalogue the pricing page renders and the entitlement
-- function reads: apply_plan_entitlements() copies profile_limit and seat_limit
-- onto the organizations row, and the limit triggers enforce them from there.
-- Changing a number here does not retroactively move existing orgs; that is
-- what apply_plan_entitlements() is for.
--
-- automation_limit is deliberately not in this table. It lives on organizations
-- and is set by apply_plan_entitlements() (free tier gets 2).

insert into public.plans (key, name, price_cents, currency, profile_limit, seat_limit, extra_seat_cents, api_access, sort) values
  ('free',       'Free',           0, 'USD',    5, 1, null,  false, 0),
  ('starter',    'Starter',     1000, 'USD',   60, 1, null,  true,  1),
  ('base',       'Base',        8900, 'USD',  100, 1, 1000,  true,  2),
  ('team',       'Team',       15900, 'USD',  300, 1, 2000,  true,  3),
  ('enterprise', 'Enterprise', 29900, 'USD', null, 1, 2500,  true,  4)
on conflict (key) do update set
  name             = excluded.name,
  price_cents      = excluded.price_cents,
  currency         = excluded.currency,
  profile_limit    = excluded.profile_limit,
  seat_limit       = excluded.seat_limit,
  extra_seat_cents = excluded.extra_seat_cents,
  api_access       = excluded.api_access,
  sort             = excluded.sort;

-- Billing periods and their discounts, in basis points: 6 months takes 20% off,
-- 12 months takes 40%.
insert into public.plan_terms (months, discount_bps) values
  (1, 0),
  (6, 2000),
  (12, 4000)
on conflict (months) do update set discount_bps = excluded.discount_bps;
