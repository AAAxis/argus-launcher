// The one place row shapes and app shapes are translated.
//
// src/types.ts predates the relational schema and its field names do not match
// the columns: a proxy's check result is `checked_at`/`egress_ip`/`ping_ms`/
// `check_error` in the app and `last_checked_at`/`last_ip`/`last_latency_ms`/
// `last_error` in the table, a profile's cookie set is `cookie_id` here and
// `cookie_set_id` there, and two scalar fields are arrays in the database.
// Renaming the app types would touch every tab and dialog in main.tsx, so the
// translation lives here instead and the UI keeps reading what it always read.
import type {
  ArgusCookie,
  ArgusFolder,
  ArgusOrg,
  ArgusProfile,
  ArgusProxy,
  BuiltInExtensionToggles,
  ProxyMode,
  SharedBookmark,
  SharedExtension,
} from '../types';
import type {
  CookieSetRow,
  CustomStatusRow,
  FolderRow,
  OrganizationRow,
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
    command_line_switches: switchesToText(row.command_line_switches),
    fingerprint,
    created_at: undef(row.created_at),
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
    fingerprint: (profile.fingerprint || {}) as Record<string, unknown>,
    status: profile.status ?? null,
    tags: profile.tags ?? [],
    email: profile.email ?? null,
    password: profile.password ?? null,
    start_urls: startUrl ? [startUrl] : [],
    command_line_switches: switchesToArray(profile.command_line_switches),
    color: profile.color ?? null,
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
    icon: undef(row.icon),
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
  };
}

// ---- shared extensions --------------------------------------------------

export function rowToExtension(row: SharedExtensionRow): SharedExtension {
  return {
    id: row.id,
    name: undef(row.name),
    source: row.source === 'webstore' ? 'webstore' : 'local',
    webstoreId: undef(row.webstore_id),
    storageUrl: undef(row.storage_url),
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

// ---- built-in extension toggles -----------------------------------------

export function toggles(value: unknown): BuiltInExtensionToggles | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }
  return value as BuiltInExtensionToggles;
}
