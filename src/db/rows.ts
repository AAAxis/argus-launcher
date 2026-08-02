// Hand-written row shapes for the tables prompt 03 created. There is no
// generated database.types.ts and the Supabase CLI is not installed on this
// machine, so these are maintained by hand against
// supabase/migrations/0001_multitenant_core.sql as amended by 0005. Keep them
// in that order -- a column that exists here but not in the database fails at
// runtime, not at typecheck.
import type {BuiltInExtensionToggles} from '../types';

export type OrganizationRow = {
  id: string;
  name: string;
  plan: string;
  profile_limit: number | null;
  seat_limit: number;
  billing_status: string;
  current_period_end: string | null;
  created_at: string;
  built_in_extensions: BuiltInExtensionToggles | null;
};

export type OrgMemberRow = {
  org_id: string;
  user_id: string;
  role: string;
  created_at: string;
};

// id is text, not uuid: a profile id is also its on-disk directory name under
// E:\ArgysProfiles\<id>, and 30 of the 44 legacy directories are plain numbers.
// 0005 widened it and added profiles_id_fs_safe to keep the name path-safe.
export type ProfileRow = {
  id: string;
  org_id: string;
  name: string;
  notes: string | null;
  folder_id: string | null;
  proxy_id: string | null;
  cookie_set_id: string | null;
  fingerprint: Record<string, unknown>;
  status: string | null;
  tags: string[] | null;
  start_urls: string[] | null;
  command_line_switches: string[] | null;
  created_by: string | null;
  deleted_at: string | null;
  updated_at: string;
  created_at: string;
  color: string | null;
  proxy_mode: string | null;
  cookie_mode: string | null;
  cookie_import_path: string | null;
  cookie_import_url: string | null;
  cookie_import_name: string | null;
  cookie_import_count: number | null;
};

export type ProxyRow = {
  id: string;
  org_id: string;
  name: string | null;
  type: string | null;
  host: string | null;
  port: number | null;
  username: string | null;
  password: string | null;
  last_checked_at: string | null;
  last_ip: string | null;
  last_country: string | null;
  last_latency_ms: number | null;
  created_at: string;
  last_country_code: string | null;
  last_error: string | null;
};

export type FolderRow = {
  id: string;
  org_id: string;
  name: string | null;
  parent_id: string | null;
  created_at: string;
};

// `cookies` holds the cookie payload itself and is unused by the launcher
// today -- the app stores a Storage URL in source_url, exactly as the blob did.
// Prompt 06 is what starts filling `cookies`.
export type CookieSetRow = {
  id: string;
  org_id: string;
  name: string | null;
  cookies: unknown[];
  updated_at: string;
  created_at: string;
  source_url: string | null;
  count: number | null;
};

// Primary key is (org_id, id), not (id): addExtensionFromWebStoreLink uses the
// Web Store id as the row id, so two orgs sharing one extension share its id.
export type SharedExtensionRow = {
  id: string;
  org_id: string;
  name: string | null;
  source: string | null;
  storage_path: string | null;
  created_at: string;
  webstore_id: string | null;
  storage_url: string | null;
};

export type SharedBookmarkRow = {
  id: string;
  org_id: string;
  title: string | null;
  url: string | null;
  position: number | null;
  icon: string | null;
};

export type CustomStatusRow = {
  id: string;
  org_id: string;
  label: string | null;
  color: string | null;
};
