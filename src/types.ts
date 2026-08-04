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
  // Which library this folder belongs to. Profile, proxy and cookie-set folders
  // all share one `folders` table -- the column exists so they stay separate
  // namespaces rather than one pile the user has to read twice. Undefined
  // means 'profile', the column's default and what every row predating proxy
  // folders is.
  //
  // There is no CHECK on the column, so a fourth library needs no migration --
  // only a wider union here and a matching branch in the load-time split.
  kind?: 'profile' | 'proxy' | 'cookie';
  // A key into FOLDER_ICONS (src/data/folderIcons.ts), or a "flag:<ISO>" key
  // for a country flag -- never a URL or markup, so an unknown value can only
  // ever downgrade to the plain folder glyph.
  icon?: string;
  // A PROFILE_COLORS key or a custom #rrggbb, read through profileColorStyle()
  // exactly like ArgusProfile.color. Tints the folder's glyph in the rail and
  // in the profiles table; the card itself stays neutral.
  color?: string;
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
  // The proxy-kind folder this proxy is filed under, or null for "All proxies".
  // Same shape and same ON DELETE SET NULL as ArgusProfile.folder_id.
  folder_id?: string | null;
  country?: string;
  country_code?: string;
  egress_ip?: string;
  ping_ms?: number;
  checked_at?: string;
  check_error?: string;
};

// A shared, reusable cookie-set in the Cookies tab library. A set is attached
// to a profile through ArgusProfile.cookie_id (profiles.cookie_set_id): a
// profile carries at most one set, a set may be used by any number of
// profiles. The FK is the whole model -- there is no join table and there must
// not be one, or "which cookies does this profile launch with" stops having a
// single answer.
//
// `url` is a Supabase Storage public URL (or a data: URL fallback), produced by
// the exact same upload path as the per-profile cookie_import_url flow (see
// cloudCookieFromSelection) -- so the launch payload consumes it identically,
// no separate backend handling needed. It stays the source of truth for a
// launch: electron/main.cjs fetches it and holds no Supabase credentials.
//
// The cookies themselves are deliberately NOT on this type. They live in the
// cookie_sets.cookies jsonb column and are loaded on demand by the inspector --
// a workspace with 200 sets would otherwise pull every payload on every load,
// and useCloudData reloads on window focus.
export type ArgusCookie = {
  id: string;
  name: string;
  url: string;
  count?: number | null;
  // The cookie-kind folder this set is filed under, or null for
  // "All cookie-sets". Same shape and same ON DELETE SET NULL as
  // ArgusProfile.folder_id.
  folder_id?: string | null;
  // Free text, capped at MAX_PROFILE_TAGS and read through the same tag catalog
  // profiles use -- a set tagged "instagram" and a profile tagged "Instagram"
  // are the same idea and render alike.
  tags?: string[];
  created_at?: string;
  updated_at?: string;
  // Soft-delete timestamp, the same 30-day contract as ArgusProfile.deleted_at.
  // Trashing a set also unassigns every profile using it, because a trashed set
  // that could still seed a launch would be a lie.
  deleted_at?: string | null;
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
  // Whether profiles actually launch with it. Undefined/missing means enabled,
  // the same convention BuiltInExtensionToggles uses below, so rows written
  // before the column existed keep loading. Installed-but-off is a real state:
  // it keeps the extension in the org's library (and out of every profile)
  // without anyone having to re-find it in the store to turn it back on.
  enabled?: boolean;
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
  // Profile folders only. The proxy ones are held apart rather than mixed in
  // behind a `kind` check because half a dozen call sites read this list and
  // every one of them means profile folders -- the folder row, the assign
  // dropdown, the move dialog, the tag suggestions, the API-key folder scope.
  // Splitting once, on load, is what makes a proxy folder unable to leak into
  // any of them.
  folders: ArgusFolder[];
  proxy_folders: ArgusFolder[];
  cookie_folders: ArgusFolder[];
  proxies: ArgusProxy[];
  // Every set in the library, trashed ones included -- the Cookies tab filters
  // on deleted_at the same way the Profiles tab does, so Trash is a view rather
  // than a second read.
  cookies: ArgusCookie[];
  shared_extensions: SharedExtension[];
  shared_bookmarks: SharedBookmark[];
  custom_statuses: string[];
  built_in_extensions?: BuiltInExtensionToggles;
};
