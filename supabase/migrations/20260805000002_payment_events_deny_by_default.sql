-- public.payment_events: say out loud that it is service-role only.
--
-- The table had RLS enabled and no policies at all, which the Supabase linter
-- reports as rls_enabled_no_policy. It was not actually reachable -- `anon` and
-- `authenticated` hold no grants on it, and the only writer is the Revolut
-- webhook in landing/app/api/revolut/webhook/route.ts, which uses the service
-- role and bypasses RLS entirely.
--
-- So this changes no behaviour. It exists because "no policy" and "deny
-- everyone" look identical from the outside, and the first one is what a table
-- looks like when someone forgot. A RESTRICTIVE policy cannot be satisfied by
-- adding a permissive one later, so the denial survives a future mistake --
-- which a bare absence of policies would not.

drop policy if exists "payment_events are service role only" on public.payment_events;

create policy "payment_events are service role only"
  on public.payment_events
  as restrictive
  for all
  to authenticated, anon
  using (false)
  with check (false);

comment on table public.payment_events is
  'Raw provider webhook events. Written only by the service role; no client may read or write. Deliberately not exposed through PostgREST to anon or authenticated.';
