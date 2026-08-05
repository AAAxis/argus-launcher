-- automations.tags -- the same free-text labels profiles carry.
--
-- Paste into the SQL editor of Supabase project jpsmdjtxuxlkyuotwxfg and run
-- once. `add column if not exists`, so re-running is a no-op.
--
-- MUST be applied before the launcher build that reads it. src/db/automations.ts
-- names every column explicitly in its select, so a column that is in the code
-- and not in the database fails that whole table's read -- and because
-- useCloudData loads with Promise.allSettled, the symptom is "my automations
-- are gone" with a toast naming the column, not an obvious error. The rows are
-- untouched; the read just never lands.
--
-- text[] and not a join table, for the reason profiles.tags is: these are
-- labels, not entities. Nothing joins on them, the catalog in
-- src/data/tagPresets.ts is presentation, and the 5-tag cap is enforced in one
-- place client-side (normalizeTags in src/lib/tags.ts) rather than by a
-- constraint -- a tag list that exceeds it is a UI bug, not a corrupt row.
--
-- No default of '{}': null and empty mean the same thing to rowToAutomation
-- (`row.tags || []`), and a default would rewrite every existing row for no
-- gain. RLS is table-level on automations already (is_org_member(org_id) for
-- all four verbs), so this column needs no policy change.

alter table public.automations
add column if not exists tags text[];

-- ── Check it worked ───────────────────────────────────────────────────────
-- Expect one row: automations | tags | ARRAY.
select table_name, column_name, data_type
from information_schema.columns
where table_schema = 'public'
  and table_name = 'automations'
  and column_name = 'tags';
