-- What network a proxy exits from, and whether that network is a datacenter.
--
-- The fingerprint work of 2026-08-07 established the thing no injector fixes:
-- a residential-looking browser behind a datacenter IP is still flagged, and
-- the exit in the original report (142.252.99.144, Clouvider, AS62240) scores
-- "Datacenter: true, ISP Risk: high" on iphey. The panel had no way to say so
-- -- it showed the city and timezone and stayed silent about the one attribute
-- that was actually getting the profile blocked.
--
-- ip-api.com already returns all three of these on the free tier when asked
-- (fields=hosting,isp,as); checkProxyEndpoint just wasn't requesting them. These
-- columns are that answer, persisted, so the panel can surface a "Datacenter"
-- verdict at launch from the last check rather than only during a live re-check.
--
--   last_asn      the autonomous system, verbatim ("AS62240 Clouvider Limited")
--   last_isp      the ISP/carrier name ip-api reports
--   last_hosting  ip-api's boolean hosting/datacenter flag
--
-- Nullable, no backfill, cleared with the other last_* columns on a credential
-- edit -- identical lifecycle to the geolocation columns added in
-- 20260809000000_proxy_ip_geolocation.sql, for the same reason: every last_*
-- column means "what the most recent check saw", and a new egress invalidates
-- all of them together. A row checked before this migration simply has no stored
-- hosting verdict until its next check, and the panel omits the row rather than
-- guessing (House Rule 6, no phantom data).
alter table "public"."proxies"
  add column if not exists "last_asn" "text",
  add column if not exists "last_isp" "text",
  add column if not exists "last_hosting" boolean;

-- No RLS or grant changes: columns on an existing table whose policies are
-- row-scoped by org_id and whose grants are table-level. Same note as the
-- geolocation migration above.
