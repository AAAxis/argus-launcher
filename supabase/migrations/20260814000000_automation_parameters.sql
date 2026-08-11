-- Automation parameters: one workflow, many profiles.
-- Spec: docs/superpowers/specs/2026-08-09-automation-parameters-design.md
--
-- Additive, like 20260812. Nothing in the renderer selects either column until
-- this is applied -- src/db/automations.ts and src/db/profiles.ts name their
-- columns explicitly, so a column in code but not in the database fails the
-- whole table's select and the workspace degrades that table to [].

-- ---------------------------------------------------------------------------
-- automations.parameters: the declaration
-- ---------------------------------------------------------------------------

-- An ORDERED list of AutomationParam (src/automations/parameters.ts):
--   [{"name": "city_name", "kind": "text", "label": "City", "required": true,
--     "default": "Dortmund", "options": [...], "hint": "...", "placeholder": "..."}]
--
-- An array and not an object, because the order is the order the form renders
-- in and an object loses it. `name` matches ^[A-Za-z_][A-Za-z0-9_]*$ -- the
-- pattern setVar.name already carries -- so every parameter stays addressable
-- from a step as {{vars.<name>}} through the interpolation that already exists.
--
-- automations.variables is untouched: it stays the untyped seed bag MCP has
-- always accepted. A declared parameter with the same name SHADOWS its entry.
-- That precedence lives in resolveRunVars and is documented on the type; it is
-- deliberately not a constraint here, because the bag predates the declaration
-- and rejecting an overlap would break rows that are already valid.
alter table public.automations
  add column if not exists parameters jsonb not null default '[]'::jsonb;

-- ---------------------------------------------------------------------------
-- profiles.automation_vars: the values
-- ---------------------------------------------------------------------------

-- Per-automation parameter values for this profile, keyed by automation id:
--   {"flat-search": {"city_name": "Dortmund", "number_of_rooms": "2"}}
--
-- On the profile rather than in a join table, for the reason
-- src/lib/startPageAutomations.ts already gives about `pinned`: the per-profile
-- binding to an automation is a column on the profile (automation_id), and this
-- is that same slot carrying a document instead of an id. A join table would
-- also need its own RLS for data that is already org-scoped by the profile row.
--
-- Values are stored as whatever JSON arrives -- the editors write strings,
-- because that is what a controlled input holds; an agent over MCP may write a
-- real number -- and are coerced ONCE, by declared kind, in resolveRunVars. So
-- changing a parameter's kind later needs no data migration. An empty string
-- means "not set" and falls through to the automation's default.
--
-- No foreign key on the automation ids inside it: they are jsonb keys, which
-- Postgres cannot police, and a deleted automation simply leaves a stale entry
-- that nothing reads. Nothing joins on them either.
alter table public.profiles
  add column if not exists automation_vars jsonb not null default '{}'::jsonb;
