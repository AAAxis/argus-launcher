# Data retention

Every window this product deletes on, and the one place each is enforced.

The numbers live in three files by necessity — SQL cannot import a TypeScript
constant and Electron cannot read the database's schedule — so this page is what
keeps them agreeing. Change one, change the others, and change the privacy
policy if the change is user-visible.

| What | Window | Enforced by |
|---|---|---|
| `automation_runs` rows, including `log` and `vars` | 14 days | `purge_expired_data()`, nightly at 03:17 UTC |
| Automation screenshots on disk | 14 days | `RETENTION_DAYS` in `electron/automation/store.cjs`, swept on app start |
| Profiles and cookie sets in Trash | 30 days | `purge_expired_data()`, plus `TRASH_RETENTION_DAYS` in `src/lib/trash.ts` on workspace load |
| Accepted and revoked `org_invites` | 30 days after settling | `purge_expired_data()` |
| Accepted, declined and cancelled `handoffs` | 30 days after settling | `purge_expired_data()` |
| `notifications` (and their `notification_reads`, by cascade) | 30 days | `purge_expired_data()` |
| Superseded cookie files in Storage | immediately | `uploadCookieFile()` in `src/db/cookieSets.ts` |
| Cookie files behind a purged set | immediately | `removeCookieFilesFor()` in `src/db/cookieSets.ts` |

Nothing else is deleted automatically. Support tickets, revoked API tokens,
subscriptions and payment records are all kept deliberately — see the bottom of
`supabase/migrations/20260816000000_data_retention.sql`, and §7 of the privacy
policy for what users are told.

## The two halves, and why there are two

**Rows** are swept by `pg_cron`, in
`supabase/migrations/20260816000000_data_retention.sql`. One `security definer`
function, one nightly job. It runs whether or not anybody opens the app, which
is the entire point: the 30-day Trash purge existed for months as a client-side
sweep in `src/workspace/useCloudData.ts`, and an org nobody signed into kept its
Trash indefinitely. That sweep is still there — it makes Trash empty itself
while you are looking at it — but it is no longer the only copy.

**Storage objects** cannot be swept from SQL. Deleting a row from
`storage.objects` does not delete the file it describes; it orphans it, and you
keep paying for it. So Storage is handled at the source instead: every uploader
in this app names its object with `Date.now()` so the public URL changes and the
CDN cannot serve a stale file, and `uploadCookieFile()` now removes the object
it just superseded.

That matters most for cookies. The cookie-manager extension pushes the live jar
on a six-second floor (`extensions/cookie-manager/background.js`), so before
this a single running profile left roughly ten dead 30 KB objects a minute —
466 objects and 15 MB accumulated in the first six days of use.

## `scripts/sweep-storage.mjs`

Not a scheduled job. It exists for two things the upload path cannot reach:

- the backlog from before `uploadCookieFile()` cleaned up after itself;
- objects uploaded by a *different* member. The bucket's delete policy is
  `owner = auth.uid()` for `profile-cookies/`
  (`supabase/migrations/20260805000001_storage.sql`), so a signed-in user can
  only tidy up their own. The script uses the service role and is not bound by
  it.

It also collects superseded `avatars/`, `profile-avatars/` and `org-logos/`
objects, which have the same never-delete-the-predecessor shape at a harmless
volume, and the files stranded by purging a *profile* — deleting a profile has
never touched `profile-cookies/<profileId>/` or its avatar.

Dry run by default:

```sh
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/sweep-storage.mjs
node scripts/sweep-storage.mjs --apply
```

It keeps anything a row still points at, anything under 24 hours old, and the
newest object in each folder regardless — a live push has its file up before the
`source_url` column catches up, and the difference between "superseded" and
"not committed yet" is not visible from outside.

## Checking the job

```sql
select jobname, schedule, active from cron.job;

select jobname, status, return_message, start_time
  from cron.job_run_details order by start_time desc limit 5;
```

`purge_expired_data()` writes what it removed to the Postgres log at `log`
level — `cron.job_run_details` records only that the job succeeded, not what it
took. To run it now rather than waiting for tonight:

```sql
select public.purge_expired_data();
```

It is revoked from `anon` and `authenticated`, so that only works as `postgres`
or the service role. If a normal client can call it, the revoke has been lost.
