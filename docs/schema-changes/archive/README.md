# Archived schema changes

**Do not run anything in this directory.** It is history, not a migration chain.

Every file here was pasted by hand into the Supabase SQL editor between
2026-07 and 2026-08-05, in the period before this repo had a migration system.
Each one opens by saying so:

> There is no `supabase/migrations/` in this workspace and the Supabase CLI is
> not installed, so this file is a record of a change applied by hand …

That is no longer true. `supabase/migrations/20260805000000_baseline.sql` is a
`pg_dump` of the live database taken on 2026-08-05, so it already contains the
end state of every file here — the tables, the RPC bodies, the RLS policies, the
limit triggers and the grants. The migration history table was reconciled to
match at the same time.

## Why they are kept

The baseline says what the schema *is*. These say **why**, and several of them
are the only written record of a decision:

| File | Worth reading for |
|---|---|
| `2026-08-05-teams.sql` | The whole membership model, and the plan→limits function |
| `2026-08-06-handoffs.sql` | Why every handoff mutation is an RPC rather than a table write |
| `2026-08-07-assign-directly.sql` | The rule that a `SECURITY DEFINER` lookup must be scoped to `p_org` as well as to the id |
| `2026-08-09-roster-leak-and-grants.sql` | A tenant-boundary leak and a privilege-escalation hole, how they were found, and why `SECURITY DEFINER` made the first one fatal instead of merely wrong. **Both are fixed** — verified against the live database on 2026-08-05: the roster function now filters on `p_org`, and `authenticated` holds UPDATE on the descriptive columns of `organizations` only, never on `plan`, `profile_limit`, `seat_limit` or `automation_limit`. |
| `2026-08-10-owner-member-roles.sql` | Collapsing three roles into owner/member, and why `org_members` has no INSERT policy |

`APPLY-THESE.sql` was deleted rather than archived: it was a catch-up file
listing changes that had not yet been applied, and its contents are in the
baseline.

`2026-07-legacy-cloud-state.sql` was `docs/supabase-migrations.sql`. It targets
`monti_cloud_state`, the pre-multitenant blob store, which no longer exists.

## Making a schema change now

```sh
supabase migration new <name>          # creates supabase/migrations/<ts>_<name>.sql
# write the SQL, then:
supabase db push
supabase gen types typescript --linked --schema public > src/db/database.types.ts
npm run typecheck                      # rows.schema-check.ts catches drift
```

Nothing should be added to this directory again.
