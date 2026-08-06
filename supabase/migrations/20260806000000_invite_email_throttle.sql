-- Records when an invitation was last emailed, so it cannot be emailed on a loop.
--
-- Until now invites were never emailed at all -- create_org_invite minted a
-- token and the owner copied the link out of the dialog by hand. Now that
-- landing/app/api/invites/send/route.ts sends them, invite *creation* stays
-- bounded by the plan's seat limit but invite *emailing* is unbounded: the same
-- token can be handed to the route as many times as anyone likes.
--
-- That matters more than it looks. Resend's free plan allows 100 emails a DAY
-- across every sender in the product, and OTP sign-in codes come out of the same
-- allowance. Draining it does not degrade sign-in, it stops it -- for every
-- user, on both apps, until the counter rolls over. A loop on this route is
-- therefore a denial-of-service on logging in, and the person holding the loop
-- only needs to own one workspace.
--
-- 60 seconds, to match OTP_RESEND_COOLDOWN_MS in launcher/src/lib/auth.ts and
-- smtp_max_frequency in the project's auth config. The product already asks
-- people to wait a minute between emails; this is that same rule, applied to the
-- one send path that Supabase's own limiter never sees.
alter table public.org_invites
  add column if not exists last_emailed_at timestamptz;

comment on column public.org_invites.last_emailed_at is
  'When the invitation email was last sent. Null means never. Enforced as a '
  '60s floor by /api/invites/send; see 20260806000000_invite_email_throttle.sql.';

-- `authenticated` holds column-level UPDATE on this table -- only ("status"),
-- granted so an owner can revoke. Without this second grant the route's write
-- is refused and every send looks like the first one, which is precisely the
-- state the column exists to prevent.
--
-- Narrow on purpose: still no UPDATE on token, email, expires_at or org_id.
grant update("last_emailed_at") on table public.org_invites to authenticated;
