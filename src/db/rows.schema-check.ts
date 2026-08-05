// Compile-time drift check: hand-written row shapes vs. the live schema.
//
// `rows.ts` is hand-maintained on purpose -- it carries refinements the
// generator cannot know (BuiltInExtensionToggles instead of Json, the comments
// explaining why a column is nullable). What it could never do is notice when a
// column it names stops existing in the database.
//
// That failure is silent and expensive. PostgREST rejects the *entire* select
// when one column in it is unknown, and `useCloudData` reads tables with
// Promise.allSettled, so a single stale column name in `rows.ts` surfaces to the
// user as "my proxies and folders are gone" -- at runtime, in production, with
// no error anyone reads.
//
// This file turns that into a typecheck failure. It emits no JavaScript; the
// assertions below resolve to `true` only while every column named in `rows.ts`
// still exists in `database.types.ts`.
//
// When one fails, the error prints the offending column names. Regenerate first:
//
//   supabase gen types typescript --linked --schema public > src/db/database.types.ts
//
// If the column is genuinely gone, fix `rows.ts` and whatever selects it. If it
// is new, `rows.ts` simply has not caught up -- adding it is optional, since
// modelling fewer columns than exist is safe.

import type {Database} from './database.types';
import type {
  AutomationRow,
  AutomationRunRow,
  ConnectorRow,
  CookieSetRow,
  CustomStatusRow,
  FolderRow,
  HandoffRow,
  NotificationReadRow,
  NotificationRow,
  OrgInviteRow,
  OrgMemberRow,
  OrganizationRow,
  ProfileRow,
  ProxyRow,
  SharedBookmarkRow,
  SharedExtensionRow,
} from './rows';

type Tables = Database['public']['Tables'];

// Resolves to `true` when every key of `Hand` exists on `Gen`, and to the union
// of the offending keys otherwise -- so the compiler error names the columns.
type ColumnsExist<Hand, Gen> =
  Exclude<keyof Hand, keyof Gen> extends never ? true : Exclude<keyof Hand, keyof Gen>;

/* eslint-disable @typescript-eslint/no-unused-vars */
const _organizations: ColumnsExist<OrganizationRow, Tables['organizations']['Row']> = true;
const _orgMembers: ColumnsExist<OrgMemberRow, Tables['org_members']['Row']> = true;
const _orgInvites: ColumnsExist<OrgInviteRow, Tables['org_invites']['Row']> = true;
const _handoffs: ColumnsExist<HandoffRow, Tables['handoffs']['Row']> = true;
const _profiles: ColumnsExist<ProfileRow, Tables['profiles']['Row']> = true;
const _proxies: ColumnsExist<ProxyRow, Tables['proxies']['Row']> = true;
const _folders: ColumnsExist<FolderRow, Tables['folders']['Row']> = true;
const _cookieSets: ColumnsExist<CookieSetRow, Tables['cookie_sets']['Row']> = true;
const _sharedExtensions: ColumnsExist<SharedExtensionRow, Tables['shared_extensions']['Row']> = true;
const _sharedBookmarks: ColumnsExist<SharedBookmarkRow, Tables['shared_bookmarks']['Row']> = true;
const _customStatuses: ColumnsExist<CustomStatusRow, Tables['custom_statuses']['Row']> = true;
const _automations: ColumnsExist<AutomationRow, Tables['automations']['Row']> = true;
const _connectors: ColumnsExist<ConnectorRow, Tables['connectors']['Row']> = true;
const _notifications: ColumnsExist<NotificationRow, Tables['notifications']['Row']> = true;
const _notificationReads:
  ColumnsExist<NotificationReadRow, Tables['notification_reads']['Row']> = true;
const _automationRuns: ColumnsExist<AutomationRunRow, Tables['automation_runs']['Row']> = true;
/* eslint-enable @typescript-eslint/no-unused-vars */

// OrgMemberIdentityRow is deliberately absent: it shapes the return of the
// org_members_with_identity RPC, not a table.
