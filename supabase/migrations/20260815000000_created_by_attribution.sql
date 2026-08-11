-- Who added this proxy, and who added this cookie set.
--
-- Additive. Nothing in the renderer selects the new column until this is
-- applied -- src/db/proxies.ts and src/db/cookieSets.ts name their columns
-- explicitly, so a column in code but not in the database fails the whole
-- table's select and the workspace degrades that table to [] (the
-- folders.color incident). Push this before shipping the build that reads it.
--
-- The feature that wants it is the "new since you last looked" marker on the
-- four list tabs: a row glows green, and its tab carries a count, when it
-- arrived after this user last looked AND somebody else made it. profiles and
-- automations could already answer the second half; these two could not, so
-- importing forty cookie sets lit up your own sidebar with your own work.
--
-- Attribution and assignment are different questions and stay different
-- columns. assigned_to (already here, owned by set_assignee and
-- accept_handoff) is who is responsible for the row now; created_by is who put
-- it there, and nothing rewrites it afterwards.

-- default auth.uid() rather than a value the client sends, matching
-- profiles.created_by and automations.created_by. It is the only version of
-- authorship that cannot be forged, and it is why proxyToRow and cookieToRow
-- omit the column in both directions -- see the note above profileToRow in
-- src/db/mappers.ts. On insert the default fills it; on update, omitting it is
-- what stops a colleague's edit from rewriting authorship to themselves.
--
-- on delete set null, not cascade: somebody leaving the workspace must not take
-- the proxies and cookie sets they added with them. Null then reads the same as
-- every pre-existing row -- see below.
alter table public.proxies
  add column if not exists created_by uuid
  references auth.users (id) on delete set null default auth.uid();

alter table public.cookie_sets
  add column if not exists created_by uuid
  references auth.users (id) on delete set null default auth.uid();

-- Deliberately NOT backfilled, and there is nothing honest to backfill it with:
-- no table records who created a proxy before this migration. Null is the
-- truthful answer and the renderer is built for it -- arrivalsSince in
-- src/lib/newSince.ts requires a known author that is not mine, so a null
-- created_by never glows. Every such row predates every watermark anyway, which
-- is why nothing is lost.
--
-- No RLS or grant changes. Both tables are already is_org_member(org_id) in all
-- four directions and neither carries column-level grants the way organizations
-- does, so table-level select/update already covers the new column.
