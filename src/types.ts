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
  folder_id?: string | null;
  proxy_id?: string | null;
  proxy_mode?: ProxyMode;
  start_url?: string | null;
  cookie_import_path?: string | null;
  cookie_import_count?: number | null;
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
  title: string;
  url: string;
  icon?: string;
};

export type CloudState = {
  profiles: ArgusProfile[];
  folders: ArgusFolder[];
  proxies: ArgusProxy[];
  shared_extensions: SharedExtension[];
  shared_bookmarks: SharedBookmark[];
  custom_statuses: string[];
};
