// Mirrors argus::Fingerprint's JSON dict keys (chrome/browser/argus/
// argus_fingerprint.cc ToDict/FromDict) so it can be dropped straight into
// --argus-fingerprint-json for the browser to apply verbatim. timezone,
// languages, latitude, and longitude are left undefined when the profile is
// set to derive them from the assigned proxy's country -- electron/main.cjs
// fills those in (reusing its existing COUNTRY_DEFAULTS resolution) right
// before the payload is serialized, so that logic stays in exactly one place.
export type RuntimeFingerprint = {
  platform?: string;
  ua_string?: string;
  preset?: string;
  seed: number;
  webrtc_mode?: string;
  canvas_mode?: string;
  webgl_mode?: string;
  webgpu_mode?: string;
  client_rects_mode?: string;
  audio_mode?: string;
  webgl_vendor?: string;
  webgl_renderer?: string;
  timezone?: string;
  languages?: string[];
  geolocation_mode?: string;
  latitude?: number;
  longitude?: number;
  cpu_cores?: number;
  memory_gb?: number;
  // Real, engine-level (not JS-shimmed) mobile signals -- see the matching
  // Fingerprint::touch_points/sensor_mode/battery_* fields in
  // chrome/browser/argus/argus_fingerprint.h for what each one actually
  // does browser-side. Derived automatically from platform in
  // buildRuntimeFingerprint() below, same as webrtc_mode/canvas_mode etc --
  // not user-editable fields of their own.
  touch_points?: number;
  sensor_mode?: string;
  battery_spoof?: boolean;
  battery_level?: number;
  battery_charging?: boolean;
  screen?: string;
  media_devices?: string;
  ports_to_protect?: string;
  do_not_track?: boolean;
  rotate_on_launch?: boolean;
};

// How this profile connects: 'assigned' requires a real proxy_id (the
// existing, default behavior); 'direct' explicitly opts out of any proxy
// (no fallback extension either); 'free_proxy' explicitly opts into the
// bundled FoxyWall Proxy extension as a fallback. Undefined means 'assigned'
// for backward compatibility with profiles saved before this field existed.
export type ProxyMode = 'assigned' | 'direct' | 'free_proxy';

export type ArgusProfile = {
  id: string;
  name: string;
  status?: string;
  color?: string;
  tags?: string[];
  // Login credentials for whatever account this profile is logged into.
  // Stored in plaintext the same way ArgusProxy.password already is -- no
  // separate encrypted store, consistent with the rest of this app's model.
  email?: string;
  password?: string;
  folder_id?: string | null;
  proxy_id?: string | null;
  proxy_mode?: ProxyMode;
  start_url?: string | null;
  cookie_import_path?: string | null;
  cookie_import_url?: string | null;
  cookie_import_name?: string | null;
  cookie_import_count?: number | null;
  // 'saved' resolves cookie_id against CloudState.cookies at launch time
  // (see ArgusCookie); undefined/'paste' uses the cookie_import_* fields
  // above instead.
  cookie_mode?: 'paste' | 'saved';
  cookie_id?: string | null;
  command_line_switches?: string | null;
  fingerprint?: {
    os?: string;
    browser_version?: string;
    user_agent?: string;
    language?: string;
    timezone?: string;
    geolocation?: string;
    webrtc?: string;
    canvas?: string;
    webgl?: string;
    webgpu?: string;
    client_rects?: string;
    audio?: string;
    webgl_vendor?: string;
    webgl_renderer?: string;
    screen?: string;
    cpu_model?: string;
    cpu_cores?: number | null;
    memory_gb?: number | null;
    media_devices?: string;
    do_not_track?: boolean;
    rotate_on_launch?: boolean;
  };
  created_at?: string;
  // Soft-delete timestamp (ISO 8601). Set when a profile is moved to Trash;
  // the profile is hidden from the normal profiles list but kept for 30 days
  // (auto-purged on the next app launch after that) so an accidental delete
  // can be restored.
  deleted_at?: string | null;
};

export type ArgusFolder = {
  id: string;
  name: string;
  // A key into FOLDER_ICONS (src/data/folderIcons.ts) -- never a URL or markup,
  // so an unknown value can only ever downgrade to the plain folder glyph.
  icon?: string;
  created_at?: string;
};

export type ArgusProxy = {
  id: string;
  name: string;
  type?: 'http' | 'socks5';
  host: string;
  port: number;
  username?: string;
  password?: string;
  country?: string;
  country_code?: string;
  egress_ip?: string;
  ping_ms?: number;
  checked_at?: string;
  check_error?: string;
};

// A shared, reusable cookie-set in the Cookies tab library -- assignable to
// one profile at a time via ArgusProfile.cookie_id. `url` is a Supabase
// Storage public URL (or data: URL fallback), produced by the exact same
// upload path as the per-profile cookie_import_url flow (see
// cloudCookieFromSelection in main.tsx) -- so the launch payload consumes it
// identically, no separate backend handling needed.
export type ArgusCookie = {
  id: string;
  name: string;
  url: string;
  count?: number | null;
  assigned_profile?: string | null;
};

export type SharedExtension = {
  // Stable id (generated at add-time) used as the local cache-directory name
  // every team member materializes this extension into -- the actual files
  // are never stored directly in cloud state, only enough to fetch/rebuild
  // them locally on any machine.
  id: string;
  name?: string;
  source: 'local' | 'webstore';
  // source === 'webstore': downloaded/unpacked fresh from Google's own CDN
  // by each team member, so it's always the current published version and
  // never re-hosted by us.
  webstoreId?: string;
  // source === 'local': a public Supabase Storage URL for the zipped
  // folder, uploaded once by whoever added it; every other team member
  // downloads+unpacks it into their own local cache the first time they
  // launch a profile that uses it.
  storageUrl?: string;
};

export type SharedBookmark = {
  // Row id (uuid) once the bookmark has been persisted. The UI still
  // identifies a bookmark by its normalized url -- id only exists so an edit
  // or delete can address the exact row instead of matching on url server-side.
  id?: string;
  title: string;
  url: string;
  icon?: string;
  // Display order, written from the array index. Rows are read back ordered by
  // it so the list is stable across machines.
  position?: number;
};

// Per-extension on/off switches for the bundled (non-removable) "stock"
// extensions -- these ship with every install (cookie-manager, SMS-Activate)
// or are conditionally bundled per profile (foxywall_free_proxy, gated on a
// profile's proxy_mode === 'free_proxy'). Undefined/missing means enabled,
// for backward compatibility with cloud state saved before this existed.
export type BuiltInExtensionToggles = {
  cookie_manager?: boolean;
  sms_activate?: boolean;
  foxywall_free_proxy?: boolean;
};

// The tenant. One client firm is one org; its workers are org_members. Every
// row in every table below hangs off organizations.id, and RLS keys on it --
// see docs/data-model.md. profile_limit null means unlimited (Enterprise).
export type ArgusOrg = {
  id: string;
  name: string;
  plan: string;
  profile_limit: number | null;
  seat_limit: number;
  billing_status: string;
  current_period_end?: string | null;
  built_in_extensions?: BuiltInExtensionToggles;
};

export type OrgRole = 'owner' | 'admin' | 'member';

// One row of org_members joined to its organization. `role` decides whether the
// org-wide settings (name, built-in extension toggles) are writable: the RLS
// UPDATE policy on organizations requires is_org_admin.
export type OrgMembership = {
  org: ArgusOrg;
  role: OrgRole;
};

export type CloudState = {
  profiles: ArgusProfile[];
  folders: ArgusFolder[];
  proxies: ArgusProxy[];
  cookies: ArgusCookie[];
  shared_extensions: SharedExtension[];
  shared_bookmarks: SharedBookmark[];
  custom_statuses: string[];
  built_in_extensions?: BuiltInExtensionToggles;
};
