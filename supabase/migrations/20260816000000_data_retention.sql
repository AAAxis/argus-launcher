-- Scheduled deletion of data nothing reads any more.
--
-- Until now this product deleted nothing on a schedule. Two of the three
-- windows it advertises were enforced by a client: the 30-day Trash purge runs
-- in the renderer at src/workspace/useCloudData.ts, only when somebody opens
-- that org's workspace, so an org nobody opens keeps its Trash forever. The
-- third was not enforced at all -- app/privacy/page.tsx tells users that the
-- artifacts an automation run produces are deleted after 14 days, and only the
-- screenshots on disk (electron/automation/store.cjs) ever were. The rows,
-- including the `log` jsonb with the step-by-step play-by-play of every page
-- the run touched, were kept indefinitely.
--
-- A promise in a privacy policy that only holds when a desktop app happens to
-- be open is not a promise. This is the copy that runs regardless.
--
-- Storage is deliberately absent from this file. Deleting a row from
-- storage.objects does not delete the file behind it -- it orphans it, still
-- billed -- so the cookie-snapshot accumulation is fixed at the source in
-- src/db/cookieSets.ts instead, by removing the object a save supersedes.

create extension if not exists pg_cron with schema pg_catalog;
grant usage on schema cron to postgres;

-- security definer, owned by postgres, and revoked from everyone else below.
-- The job needs to cross every org, which the postgres role does by way of
-- BYPASSRLS; a member calling this by hand would cross them too, which is the
-- whole reason for the revoke.
--
-- Each statement is separately justified. The rule for being in here is not
-- "old" -- it is "no surface reads it", verified against the readers named in
-- each comment. Anything a user can still see stays.
create or replace function public.purge_expired_data() returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  runs bigint;
  trashed_profiles bigint;
  trashed_cookies bigint;
  invites bigint;
  settled_handoffs bigint;
  notices bigint;
begin
  -- 14 days: the window app/privacy/page.tsx already states, and the same one
  -- RETENTION_DAYS in electron/automation/store.cjs applies to the screenshots.
  -- Invisible to every reader -- RunLogModal asks for 25 runs, the scheduler
  -- for 3, the MCP bridge caps at 50, and src/db/runs.ts always sends a limit
  -- and never a date filter, so no surface can reach past the newest handful.
  -- `running` rows go too: one that never reached a terminal status in a
  -- fortnight is a run that died, not a run in progress.
  delete from public.automation_runs where started_at < now() - interval '14 days';
  get diagnostics runs = row_count;

  -- 30 days: TRASH_RETENTION_DAYS in src/lib/trash.ts, and what ConfirmModals
  -- tells the user when they delete. The renderer still purges on workspace
  -- load; this is what covers the org whose workspace nobody opens.
  -- `deleted_at is not null` is redundant next to the comparison and kept
  -- anyway: this is a DELETE, and it should read as obviously right.
  delete from public.profiles
    where deleted_at is not null and deleted_at < now() - interval '30 days';
  get diagnostics trashed_profiles = row_count;

  delete from public.cookie_sets
    where deleted_at is not null and deleted_at < now() - interval '30 days';
  get diagnostics trashed_cookies = row_count;

  -- Settled invitations. src/db/team.ts:47 keeps accepted and revoked rows "for
  -- the audit trail" and then no surface ever selects them -- listInvites
  -- filters to pending, and so does the website's seat meter.
  --
  -- Pending is untouched at any age, including expired. That is deliberate and
  -- listInvites says why: the owner needs to see that the link they sent last
  -- week went stale, and the UI marks it expired rather than hiding it.
  delete from public.org_invites
    where status in ('accepted', 'revoked')
      and coalesce(accepted_at, created_at) < now() - interval '30 days';
  get diagnostics invites = row_count;

  -- Same shape. src/db/shared.ts:49 reads pending only, because "a declined
  -- offer is a decision already made and an accepted one is visible as the
  -- assignment itself".
  delete from public.handoffs
    where status <> 'pending'
      and coalesce(resolved_at, created_at) < now() - interval '30 days';
  get diagnostics settled_handoffs = row_count;

  -- The bell is an inbox, not an archive: src/db/notifications.ts reads the
  -- newest hundred, so anything older is already unreachable. notification_reads
  -- is ON DELETE CASCADE and follows on its own.
  delete from public.notifications where created_at < now() - interval '30 days';
  get diagnostics notices = row_count;

  -- Lands in the Postgres log, which is how you check what a night actually
  -- took without waiting for the next one. cron.job_run_details records that
  -- the job succeeded; it does not record what it removed.
  raise log 'purge_expired_data: runs=% profiles=% cookie_sets=% invites=% handoffs=% notifications=%',
    runs, trashed_profiles, trashed_cookies, invites, settled_handoffs, notices;
end $$;

revoke all on function public.purge_expired_data() from public;
revoke all on function public.purge_expired_data() from anon;
revoke all on function public.purge_expired_data() from authenticated;

-- 03:17 UTC. Off-peak, and a minute nobody else picked, so a future second job
-- does not pile onto the same instant.
--
-- cron.schedule upserts on the job name, so re-applying this migration
-- reschedules rather than accumulating duplicates.
select cron.schedule(
  'purge-expired-data',
  '17 3 * * *',
  $job$select public.purge_expired_data()$job$
);
