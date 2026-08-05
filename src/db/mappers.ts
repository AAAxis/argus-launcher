// The one place row shapes and app shapes are translated.
//
// src/types.ts predates the relational schema and its field names do not match
// the columns: a proxy's check result is `checked_at`/`egress_ip`/`ping_ms`/
// `check_error` in the app and `last_checked_at`/`last_ip`/`last_latency_ms`/
// `last_error` in the table, a profile's cookie set is `cookie_id` here and
// `cookie_set_id` there, and two scalar fields are arrays in the database.
// Renaming the app types would touch every tab and dialog in main.tsx, so the
// translation lives here instead and the UI keeps reading what it always read.
import {normalizeTags} from '../lib/tags';
import type {
  ArgusAutomation,
  ArgusCookie,
  ArgusFolder,
  ArgusOrg,
  ArgusProfile,
  ArgusProxy,
  AutomationRun,
  BuiltInExtensionToggles,
  OrgInvite,
  OrgMember,
  OrgRole,
  ProxyMode,
  SharedBookmark,
  SharedExtension,
} from '../types';
import type {
  AutomationStep,
  AutomationVars,
  RunLogEntry,
  RunStatus,
  RunTrigger,
} from '../automations/types';
import type {
  AutomationRow,
  AutomationRunRow,
  CookieSetRow,
  CustomStatusRow,
  FolderRow,
  OrganizationRow,
  OrgInviteRow,
  OrgMemberIdentityRow,
  ProfileRow,
  ProxyRow,
  SharedBookmarkRow,
  SharedExtensionRow,
} from './rows';

// A row payload on the way in: org_id is always ours to set, and every column
// is optional so an update can carry only what changed.
export type Insert<T> = {org_id: string} & Partial<T>;

function undef<T>(value: T | null | undefined): T | undefined {
  return value === null || value === undefined ? undefined : value;
}

// The app keeps command-line switches as the raw contents of a textarea and
// electron/main.cjs's splitSwitches() is what trims and drops blank lines at
// launch time. So the round trip here splits and rejoins on \n and nothing
// else -- trimming here would silently rewrite the user's text every time the
// app reloaded it.
function switchesToArray(value: string | null | undefined): string[] {
  if (!value) {
    return [];
  }
  return value.split('\n');
}

function switchesToText(value: string[] | null | undefined): string | null {
  if (!value || value.length === 0) {
    return null;
  }
  return value.join('\n') || null;
}

// ---- organizations ------------------------------------------------------

export function rowToOrg(row: OrganizationRow): ArgusOrg {
  return {
    id: row.id,
    name: row.name,
    plan: row.plan,
    profile_limit: row.profile_limit,
    seat_limit: row.seat_limit,
    billing_status: row.billing_status,
    current_period_end: row.current_period_end,
    built_in_extensions: row.built_in_extensions || undefined,
    // `?? 0`, not `?? null`: null means unlimited, and a row read back from a
    // database that has not had the migration applied would otherwise hand
    // every org an unlimited automation allowance.
    automation_limit: row.automation_limit ?? 0,
  };
}

// ---- profiles -----------------------------------------------------------

export function rowToProfile(row: ProfileRow): ArgusProfile {
  const fingerprint = row.fingerprint && Object.keys(row.fingerprint).length > 0 ?
    row.fingerprint as ArgusProfile['fingerprint'] :
    undefined;
  return {
    id: row.id,
    name: row.name,
    status: undef(row.status),
    color: undef(row.color),
    avatar: undef(row.avatar),
    tags: undef(row.tags),
    email: undef(row.email),
    password: undef(row.password),
    folder_id: row.folder_id,
    proxy_id: row.proxy_id,
    proxy_mode: undef(row.proxy_mode) as ProxyMode | undefined,
    start_url: row.start_urls?.[0] ?? null,
    cookie_import_path: row.cookie_import_path,
    cookie_import_url: row.cookie_import_url,
    cookie_import_name: row.cookie_import_name,
    cookie_import_count: row.cookie_import_count,
    cookie_mode: undef(row.cookie_mode) as ArgusProfile['cookie_mode'],
    cookie_id: row.cookie_set_id,
    automation_id: row.automation_id,
    command_line_switches: switchesToText(row.command_line_switches),
    fingerprint,
    created_at: undef(row.created_at),
    created_by: row.created_by,
    deleted_at: row.deleted_at,
  };
}

// Full-row payload for an upsert.
//
// `deleted_at` is deliberately NOT included. Trash membership is owned by
// softDelete/restore/purge alone, so an ordinary edit -- from a session that
// has not noticed someone else trashed this profile -- cannot bring it back.
// That is verification check 3 of prompt 05 in one omitted line.
//
// `created_by` is omitted for a related reason, and it matters twice. On insert
// the column's DEFAULT auth.uid() fills it, which is the only version of it
// that cannot be forged. On update -- `replace` sends every key of this object
// -- omitting it is what stops a colleague's edit from rewriting authorship to
// themselves.
//
// `updated_at` is set here because no trigger maintains it: 0001/0005 give the
// column a default but nothing refreshes it on update.
export function profileToRow(orgId: string, profile: ArgusProfile): Insert<ProfileRow> {
  const startUrl = profile.start_url?.trim();
  return {
    id: profile.id,
    org_id: orgId,
    name: profile.name,
    folder_id: profile.folder_id ?? null,
    proxy_id: profile.proxy_id ?? null,
    cookie_set_id: profile.cookie_id ?? null,
    automation_id: profile.automation_id ?? null,
    fingerprint: (profile.fingerprint || {}) as Record<string, unknown>,
    status: profile.status ?? null,
    tags: profile.tags ?? [],
    email: profile.email ?? null,
    password: profile.password ?? null,
    start_urls: startUrl ? [startUrl] : [],
    command_line_switches: switchesToArray(profile.command_line_switches),
    color: profile.color ?? null,
    avatar: profile.avatar ?? null,
    proxy_mode: profile.proxy_mode ?? null,
    cookie_mode: profile.cookie_mode ?? null,
    cookie_import_path: profile.cookie_import_path ?? null,
    cookie_import_url: profile.cookie_import_url ?? null,
    cookie_import_name: profile.cookie_import_name ?? null,
    cookie_import_count: profile.cookie_import_count ?? null,
    created_at: profile.created_at || new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

// Partial patch for an update -- only the keys present in `patch` are sent, so
// two workers editing different fields of the same profile do not overwrite
// each other's untouched columns.
export function profilePatchToRow(patch: Partial<ArgusProfile>): Partial<ProfileRow> {
  const row: Partial<ProfileRow> = {updated_at: new Date().toISOString()};
  if ('name' in patch) {
    row.name = patch.name as string;
  }
  if ('status' in patch) {
    row.status = patch.status ?? null;
  }
  if ('color' in patch) {
    row.color = patch.color ?? null;
  }
  if ('avatar' in patch) {
    row.avatar = patch.avatar ?? null;
  }
  if ('tags' in patch) {
    row.tags = patch.tags ?? [];
  }
  if ('email' in patch) {
    row.email = patch.email ?? null;
  }
  if ('password' in patch) {
    row.password = patch.password ?? null;
  }
  if ('folder_id' in patch) {
    row.folder_id = patch.folder_id ?? null;
  }
  if ('proxy_id' in patch) {
    row.proxy_id = patch.proxy_id ?? null;
  }
  if ('proxy_mode' in patch) {
    row.proxy_mode = patch.proxy_mode ?? null;
  }
  if ('start_url' in patch) {
    const startUrl = patch.start_url?.trim();
    row.start_urls = startUrl ? [startUrl] : [];
  }
  if ('automation_id' in patch) {
    row.automation_id = patch.automation_id ?? null;
  }
  if ('cookie_id' in patch) {
    row.cookie_set_id = patch.cookie_id ?? null;
  }
  if ('cookie_mode' in patch) {
    row.cookie_mode = patch.cookie_mode ?? null;
  }
  if ('cookie_import_path' in patch) {
    row.cookie_import_path = patch.cookie_import_path ?? null;
  }
  if ('cookie_import_url' in patch) {
    row.cookie_import_url = patch.cookie_import_url ?? null;
  }
  if ('cookie_import_name' in patch) {
    row.cookie_import_name = patch.cookie_import_name ?? null;
  }
  if ('cookie_import_count' in patch) {
    row.cookie_import_count = patch.cookie_import_count ?? null;
  }
  if ('command_line_switches' in patch) {
    row.command_line_switches = switchesToArray(patch.command_line_switches);
  }
  if ('fingerprint' in patch) {
    row.fingerprint = (patch.fingerprint || {}) as Record<string, unknown>;
  }
  if ('deleted_at' in patch) {
    row.deleted_at = patch.deleted_at ?? null;
  }
  return row;
}

// ---- proxies ------------------------------------------------------------

export function rowToProxy(row: ProxyRow): ArgusProxy {
  return {
    id: row.id,
    name: row.name || '',
    type: undef(row.type) as ArgusProxy['type'],
    host: row.host || '',
    port: row.port || 0,
    username: undef(row.username),
    password: undef(row.password),
    folder_id: row.folder_id,
    country: undef(row.last_country),
    country_code: undef(row.last_country_code),
    egress_ip: undef(row.last_ip),
    ping_ms: undef(row.last_latency_ms),
    checked_at: undef(row.last_checked_at),
    check_error: undef(row.last_error),
  };
}

export function proxyToRow(orgId: string, proxy: ArgusProxy): Insert<ProxyRow> {
  return {
    id: proxy.id,
    org_id: orgId,
    name: proxy.name || null,
    type: proxy.type ?? null,
    host: proxy.host || null,
    port: proxy.port || null,
    username: proxy.username ?? null,
    password: proxy.password ?? null,
    folder_id: proxy.folder_id ?? null,
    last_checked_at: proxy.checked_at ?? null,
    last_ip: proxy.egress_ip ?? null,
    last_country: proxy.country ?? null,
    last_country_code: proxy.country_code ?? null,
    last_latency_ms: proxy.ping_ms ?? null,
    last_error: proxy.check_error ?? null,
  };
}

// ---- folders ------------------------------------------------------------

export function rowToFolder(row: FolderRow): ArgusFolder {
  return {
    id: row.id,
    name: row.name || '',
    // Anything that names no library is the profile one, so a row written
    // before the column existed reads as what it always was. Listed positively
    // rather than as "not proxy" so a fourth kind cannot silently land in the
    // profiles rail.
    kind: row.kind === 'proxy' ? 'proxy' : row.kind === 'cookie' ? 'cookie' : 'profile',
    icon: undef(row.icon),
    color: undef(row.color),
    created_at: undef(row.created_at),
  };
}

// ---- cookie sets --------------------------------------------------------

export function rowToCookie(row: CookieSetRow): ArgusCookie {
  return {
    id: row.id,
    name: row.name || '',
    url: row.source_url || '',
    count: row.count,
    folder_id: row.folder_id,
    tags: row.tags ?? [],
    created_at: undef(row.created_at),
    updated_at: undef(row.updated_at),
    deleted_at: row.deleted_at,
  };
}

// The full row for an insert. `deleted_at` is deliberately absent, for exactly
// the reason profileToRow omits it: Trash membership belongs to softDelete /
// restore / purge alone, and a create path that could set it would be a way to
// insert a row nobody can find.
//
// `cookies` is not here either -- the payload is passed separately by
// cookieSets.create, because it is the one column large enough that a caller
// should have to mean it.
export function cookieToRow(orgId: string, cookie: ArgusCookie): Insert<CookieSetRow> {
  return {
    id: cookie.id,
    org_id: orgId,
    name: cookie.name || null,
    source_url: cookie.url || null,
    count: cookie.count ?? null,
    folder_id: cookie.folder_id ?? null,
    tags: cookie.tags ?? [],
    updated_at: new Date().toISOString(),
  };
}

// Only the keys actually present are sent, so two workers renaming and
// re-filing the same set cannot clobber each other's field. updated_at is
// stamped on every patch: no trigger maintains it.
export function cookiePatchToRow(patch: Partial<ArgusCookie>): Partial<CookieSetRow> {
  const row: Partial<CookieSetRow> = {updated_at: new Date().toISOString()};
  if ('name' in patch) {
    row.name = patch.name ?? null;
  }
  if ('url' in patch) {
    row.source_url = patch.url || null;
  }
  if ('count' in patch) {
    row.count = patch.count ?? null;
  }
  if ('folder_id' in patch) {
    row.folder_id = patch.folder_id ?? null;
  }
  if ('tags' in patch) {
    row.tags = patch.tags ?? [];
  }
  if ('deleted_at' in patch) {
    row.deleted_at = patch.deleted_at ?? null;
  }
  return row;
}

// ---- shared extensions --------------------------------------------------

export function rowToExtension(row: SharedExtensionRow): SharedExtension {
  return {
    id: row.id,
    name: undef(row.name),
    source: row.source === 'webstore' ? 'webstore' : 'local',
    webstoreId: undef(row.webstore_id),
    storageUrl: undef(row.storage_url),
    // null (column missing before the migration, or never written) reads as
    // enabled, matching SharedExtension.enabled's documented convention.
    enabled: row.enabled ?? undefined,
  };
}

export function extensionToRow(
    orgId: string, extension: SharedExtension,
    storagePath?: string | null): Insert<SharedExtensionRow> {
  const row: Insert<SharedExtensionRow> = {
    id: extension.id,
    org_id: orgId,
    name: extension.name ?? null,
    source: extension.source,
    webstore_id: extension.webstoreId ?? null,
    storage_url: extension.storageUrl ?? null,
    enabled: extension.enabled !== false,
  };
  // Only written on upload: it is the object key a future cleanup pass needs to
  // delete the zip from the bucket. Omitted on a plain row edit so an upsert
  // never blanks it.
  if (storagePath !== undefined) {
    row.storage_path = storagePath;
  }
  return row;
}

// ---- shared bookmarks ---------------------------------------------------

export function rowToBookmark(row: SharedBookmarkRow): SharedBookmark {
  return {
    id: row.id,
    title: row.title || '',
    url: row.url || '',
    icon: undef(row.icon),
    position: undef(row.position),
  };
}

// ---- custom statuses ----------------------------------------------------

// The app models custom statuses as a plain string[]; the table stores one row
// per label (with an unused `color`). The label is the string.
export function rowToStatus(row: CustomStatusRow): string {
  return row.label || '';
}

// ---- automations --------------------------------------------------------
//
// Near-identity, on purpose. The renames at the top of this file are historical
// -- src/types.ts predates the schema -- and the automations tables were named
// to match the app type precisely so no new ones were needed. Everything below
// only coerces null to undefined and fills defaults for a row written before a
// column existed.

export function rowToAutomation(row: AutomationRow): ArgusAutomation {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    steps: (row.steps || []) as AutomationStep[],
    variables: (row.variables || {}) as AutomationVars,
    tags: row.tags || [],
    pinned: row.pinned ?? false,
    timeout_ms: row.timeout_ms ?? undefined,
    close_on_finish: row.close_on_finish ?? false,
    created_at: undef(row.created_at),
    updated_at: undef(row.updated_at),
  };
}

// `updated_at` is set here for the same reason profileToRow sets it: no trigger
// maintains it, so a save that did not touch it would leave the column at
// whatever the insert default wrote.
export function automationToRow(
    orgId: string, automation: ArgusAutomation): Insert<AutomationRow> {
  return {
    id: automation.id,
    org_id: orgId,
    name: automation.name,
    description: automation.description ?? null,
    steps: automation.steps as unknown[],
    variables: (automation.variables || {}) as Record<string, unknown>,
    // normalizeTags is the only enforcement point for the 5-tag cap and it is
    // applied at the edges, exactly as it is for profiles -- see AGENTS.md.
    tags: normalizeTags(automation.tags || []),
    pinned: automation.pinned ?? false,
    timeout_ms: automation.timeout_ms ?? 300000,
    close_on_finish: automation.close_on_finish ?? false,
    created_at: automation.created_at || new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

export function automationPatchToRow(
    patch: Partial<ArgusAutomation>): Partial<AutomationRow> {
  const row: Partial<AutomationRow> = {updated_at: new Date().toISOString()};
  if ('name' in patch) {
    row.name = patch.name as string;
  }
  if ('description' in patch) {
    row.description = patch.description ?? null;
  }
  if ('steps' in patch) {
    row.steps = (patch.steps || []) as unknown[];
  }
  if ('variables' in patch) {
    row.variables = (patch.variables || {}) as Record<string, unknown>;
  }
  if ('tags' in patch) {
    row.tags = normalizeTags(patch.tags || []);
  }
  if ('pinned' in patch) {
    row.pinned = patch.pinned ?? false;
  }
  if ('timeout_ms' in patch) {
    row.timeout_ms = patch.timeout_ms ?? 300000;
  }
  if ('close_on_finish' in patch) {
    row.close_on_finish = patch.close_on_finish ?? false;
  }
  return row;
}

// ---- automation runs ----------------------------------------------------

export function rowToRun(row: AutomationRunRow): AutomationRun {
  return {
    id: row.id,
    automation_id: row.automation_id,
    automation_name: row.automation_name || '',
    profile_id: row.profile_id,
    profile_name: row.profile_name || '',
    trigger: (row.trigger || 'manual') as RunTrigger,
    status: (row.status || 'running') as RunStatus,
    started_at: row.started_at,
    finished_at: row.finished_at,
    duration_ms: row.duration_ms,
    step_count: row.step_count ?? 0,
    failed_step_id: row.failed_step_id,
    error: row.error,
    vars: (row.vars || {}) as AutomationVars,
    log: (row.log || []) as RunLogEntry[],
  };
}

export function runToRow(orgId: string, run: AutomationRun): Insert<AutomationRunRow> {
  return {
    id: run.id,
    org_id: orgId,
    automation_id: run.automation_id ?? null,
    automation_name: run.automation_name || '',
    profile_id: run.profile_id ?? null,
    profile_name: run.profile_name || '',
    trigger: run.trigger,
    status: run.status,
    started_at: run.started_at,
    finished_at: run.finished_at ?? null,
    duration_ms: run.duration_ms ?? null,
    step_count: run.step_count ?? 0,
    failed_step_id: run.failed_step_id ?? null,
    error: run.error ?? null,
    vars: (run.vars || {}) as Record<string, unknown>,
    log: (run.log || []) as unknown[],
  };
}

// ---- team ---------------------------------------------------------------

// An unknown role reads as 'member', the least privileged of the three.
//
// The column has a CHECK constraint so this should be unreachable, but the
// direction of the fallback is the point: if a future role is added and an old
// build reads it, showing that person as a member under-states what they can do
// rather than handing the UI's admin controls to someone this build cannot
// reason about. RLS decides either way; this only decides what is drawn.
function orgRole(value: string): OrgRole {
  return value === 'owner' || value === 'admin' ? value : 'member';
}

export function rowToMember(row: OrgMemberIdentityRow): OrgMember {
  return {
    user_id: row.user_id,
    email: row.email || '',
    display_name: row.display_name || '',
    avatar_url: row.avatar_url || '',
    role: orgRole(row.role),
    created_at: row.created_at,
    invited_by: row.invited_by,
  };
}

export function rowToInvite(row: OrgInviteRow): OrgInvite {
  return {
    id: row.id,
    email: row.email,
    // Never 'owner': the table's own check refuses it, and the type says so.
    role: row.role === 'admin' ? 'admin' : 'member',
    status: row.status === 'accepted' || row.status === 'revoked' ? row.status : 'pending',
    token: row.token,
    expires_at: row.expires_at,
    created_at: row.created_at,
    invited_by: row.invited_by,
  };
}

// ---- built-in extension toggles -----------------------------------------

export function toggles(value: unknown): BuiltInExtensionToggles | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }
  return value as BuiltInExtensionToggles;
}
