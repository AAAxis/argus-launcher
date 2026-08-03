// Form state for the editor dialogs, and the conversions between it and the
// domain rows in types.ts. A draft is deliberately all-strings: it is what a
// controlled <input> holds, so "" and "8" are the right representations of an
// unset and a set number, not null and 8.
import {
  AUTO_FROM_PROXY,
  defaultWindowsFingerprintPattern,
  fingerprintPatchForOs,
  mediaDevicePresets,
  normalizeOsPreset,
} from './lib/fingerprintPresets';
import {DEFAULT_PROFILE_COLOR, normalizeProfileColor} from './lib/profileColors';
import {numberOrNull} from './lib/text';
import type {ArgusProfile, ArgusProxy, ProxyMode, SharedBookmark} from './types';

export type ProfileDraft = {
  id?: string;
  name: string;
  status: string;
  color: string;
  folder_id: string;
  // Login credentials for whatever account this profile is signed into --
  // stored plaintext the same way proxy_search/proxy credentials already
  // are (see ArgusProfile.email/password in types.ts). Not used by Anty
  // itself for anything; exposed so MCP-driven agents (get_profile/
  // update_profile) can read/fill a login form without the user re-typing
  // credentials into the agent's own prompt each time.
  email: string;
  password: string;
  proxy_id: string;
  proxy_mode: ProxyMode;
  proxy_search: string;
  proxy_link: string;
  tags: string;
  start_url: string;
  cookie_import_path: string;
  cookie_import_url: string;
  cookie_import_name: string;
  cookie_import_count: number;
  // 'saved' picks a shared cookie-set (Cookies tab) by cookie_id; 'paste'
  // keeps the existing free-text/uploaded-file flow via cookie_import_*.
  cookie_mode: 'paste' | 'saved';
  cookie_id: string;
  cookie_search: string;
  command_line_switches: string;
  fingerprint_os: string;
  fingerprint_browser_version: string;
  fingerprint_user_agent: string;
  fingerprint_language: string;
  fingerprint_timezone: string;
  fingerprint_geolocation: string;
  fingerprint_webrtc: string;
  fingerprint_canvas: string;
  fingerprint_webgl: string;
  fingerprint_webgpu: string;
  fingerprint_client_rects: string;
  fingerprint_audio: string;
  fingerprint_webgl_vendor: string;
  fingerprint_webgl_renderer: string;
  fingerprint_screen: string;
  fingerprint_cpu_model: string;
  fingerprint_cpu_cores: string;
  fingerprint_memory_gb: string;
  fingerprint_media_devices: string;
  fingerprint_do_not_track: boolean;
  fingerprint_rotate: boolean;
};

export type ProxyDraft = {
  id?: string;
  name: string;
  type: 'http' | 'socks5';
  host: string;
  port: string;
  username: string;
  password: string;
};

export type BookmarkDraft = {
  originalUrl?: string;
  title: string;
  url: string;
  icon: string;
};

export type FolderDraft = {
  id?: string;
  name: string;
  // A FOLDER_ICONS key. Always set in the draft even though ArgusFolder.icon is
  // optional -- the picker is a radiogroup and needs something selected.
  icon: string;
};

export type StatusDraft = {
  name: string;
};

export function newProfileDraft(): ProfileDraft {
  return {
    name: `Profile ${new Date().toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'})}`,
    status: 'Ready',
    color: DEFAULT_PROFILE_COLOR,
    folder_id: '',
    email: '',
    password: '',
    proxy_id: '',
    proxy_mode: 'assigned',
    proxy_search: '',
    proxy_link: '',
    tags: '',
    start_url: '',
    cookie_import_path: '',
    cookie_import_url: '',
    cookie_import_name: '',
    cookie_import_count: 0,
    cookie_mode: 'paste',
    cookie_id: '',
    cookie_search: '',
    command_line_switches: '',
    fingerprint_os: 'Windows 11',
    fingerprint_browser_version: 'Auto',
    fingerprint_user_agent: '',
    fingerprint_language: AUTO_FROM_PROXY,
    fingerprint_timezone: AUTO_FROM_PROXY,
    fingerprint_geolocation: AUTO_FROM_PROXY,
    fingerprint_webrtc: 'Proxy only',
    fingerprint_canvas: 'Noise',
    fingerprint_webgl: 'Noise',
    fingerprint_webgpu: 'Real',
    fingerprint_client_rects: 'Noise',
    fingerprint_audio: 'Noise',
    fingerprint_webgl_vendor: defaultWindowsFingerprintPattern.fingerprint_webgl_vendor,
    fingerprint_webgl_renderer: defaultWindowsFingerprintPattern.fingerprint_webgl_renderer,
    fingerprint_screen: defaultWindowsFingerprintPattern.fingerprint_screen,
    fingerprint_cpu_model: defaultWindowsFingerprintPattern.fingerprint_cpu_model,
    fingerprint_cpu_cores: defaultWindowsFingerprintPattern.fingerprint_cpu_cores,
    fingerprint_memory_gb: defaultWindowsFingerprintPattern.fingerprint_memory_gb,
    fingerprint_media_devices: mediaDevicePresets[0],
    fingerprint_do_not_track: false,
    fingerprint_rotate: true,
  };
}

export function draftFromProfile(profile: ArgusProfile): ProfileDraft {
  const fingerprint = profile.fingerprint || {};
  return {
    id: profile.id,
    name: profile.name,
    status: profile.status || 'Ready',
    // Normalized on read, so a profile saved with one of the six old hexes
    // opens on the matching preset key instead of showing a seventh, custom
    // swatch that happens to be the same colour.
    color: normalizeProfileColor(profile.color),
    folder_id: profile.folder_id || '',
    email: profile.email || '',
    password: profile.password || '',
    proxy_id: profile.proxy_id || '',
    proxy_mode: profile.proxy_mode || 'assigned',
    proxy_search: '',
    proxy_link: '',
    tags: profile.tags?.join(', ') || '',
    start_url: profile.start_url || '',
    cookie_import_path: profile.cookie_import_path || '',
    cookie_import_url: profile.cookie_import_url || '',
    cookie_import_name: profile.cookie_import_name || '',
    cookie_import_count: profile.cookie_import_count || 0,
    cookie_mode: profile.cookie_id ? 'saved' : 'paste',
    cookie_id: profile.cookie_id || '',
    cookie_search: '',
    command_line_switches: profile.command_line_switches || '',
    fingerprint_os: normalizeOsPreset(fingerprint.os),
    fingerprint_browser_version: fingerprint.browser_version || 'Auto',
    fingerprint_user_agent: fingerprint.user_agent || '',
    fingerprint_language: fingerprint.language || AUTO_FROM_PROXY,
    fingerprint_timezone: fingerprint.timezone || AUTO_FROM_PROXY,
    fingerprint_geolocation: fingerprint.geolocation || AUTO_FROM_PROXY,
    fingerprint_webrtc: fingerprint.webrtc || 'Proxy only',
    fingerprint_canvas: fingerprint.canvas || 'Noise',
    fingerprint_webgl: fingerprint.webgl || 'Noise',
    fingerprint_webgpu: fingerprint.webgpu || 'Real',
    fingerprint_client_rects: fingerprint.client_rects || 'Noise',
    fingerprint_audio: fingerprint.audio || 'Noise',
    fingerprint_webgl_vendor: fingerprint.webgl_vendor || '',
    fingerprint_webgl_renderer: fingerprint.webgl_renderer || '',
    fingerprint_screen: fingerprint.screen || 'Auto',
    fingerprint_cpu_model: fingerprint.cpu_model || '',
    fingerprint_cpu_cores: fingerprint.cpu_cores ? String(fingerprint.cpu_cores) : '8',
    fingerprint_memory_gb: fingerprint.memory_gb ? String(fingerprint.memory_gb) : '8',
    fingerprint_media_devices: fingerprint.media_devices || mediaDevicePresets[0],
    fingerprint_do_not_track: Boolean(fingerprint.do_not_track),
    fingerprint_rotate: Boolean(fingerprint.rotate_on_launch),
  };
}

export function tagsFromDraft(value: string) {
  return value.split(',')
      .map((tag) => tag.trim())
      .filter(Boolean);
}

export function withFingerprintOs(draft: ProfileDraft, os: string): ProfileDraft {
  return {
    ...draft,
    fingerprint_os: os,
    ...fingerprintPatchForOs(os),
  };
}

// The fingerprint half of a draft, in the shape ArgusProfile stores it. Used
// both when saving the editor and when a launch rotates the fingerprint.
export function fingerprintFromDraftPatch(
    patch: Partial<ProfileDraft>): NonNullable<ArgusProfile['fingerprint']> {
  return {
    os: patch.fingerprint_os,
    browser_version: patch.fingerprint_browser_version,
    user_agent: patch.fingerprint_user_agent,
    language: patch.fingerprint_language,
    timezone: patch.fingerprint_timezone,
    geolocation: patch.fingerprint_geolocation,
    webrtc: patch.fingerprint_webrtc,
    canvas: patch.fingerprint_canvas,
    webgl: patch.fingerprint_webgl,
    webgpu: patch.fingerprint_webgpu,
    client_rects: patch.fingerprint_client_rects,
    audio: patch.fingerprint_audio,
    webgl_vendor: patch.fingerprint_webgl_vendor,
    webgl_renderer: patch.fingerprint_webgl_renderer,
    screen: patch.fingerprint_screen,
    cpu_model: patch.fingerprint_cpu_model,
    cpu_cores: numberOrNull(patch.fingerprint_cpu_cores || ''),
    memory_gb: numberOrNull(patch.fingerprint_memory_gb || ''),
    media_devices: patch.fingerprint_media_devices,
    do_not_track: Boolean(patch.fingerprint_do_not_track),
    rotate_on_launch: Boolean(patch.fingerprint_rotate),
  };
}

// The saved row a profile draft describes. `createdAt` is threaded in by the
// caller because only it knows whether this is an edit (keep the original) or
// a create (stamp now).
export function profileFromDraft(draft: ProfileDraft, createdAt?: string): ArgusProfile {
  return {
    id: draft.id || globalThis.crypto?.randomUUID?.() || `${Date.now()}`,
    name: draft.name.trim(),
    status: draft.status.trim() || 'Ready',
    color: draft.color || DEFAULT_PROFILE_COLOR,
    folder_id: draft.folder_id.trim() || null,
    email: draft.email.trim() || undefined,
    password: draft.password || undefined,
    proxy_id: draft.proxy_mode === 'assigned' ? (draft.proxy_id || null) : null,
    proxy_mode: draft.proxy_mode,
    tags: tagsFromDraft(draft.tags),
    start_url: draft.start_url.trim() || null,
    cookie_import_path: draft.cookie_import_path.trim() || null,
    cookie_import_url: draft.cookie_import_url.trim() || null,
    cookie_import_name: draft.cookie_import_name.trim() || null,
    cookie_import_count: draft.cookie_import_path.trim() || draft.cookie_import_url.trim() ?
      draft.cookie_import_count || null :
      null,
    cookie_mode: draft.cookie_mode,
    cookie_id: draft.cookie_mode === 'saved' ? (draft.cookie_id || null) : null,
    command_line_switches: draft.command_line_switches.trim() || null,
    fingerprint: {
      ...fingerprintFromDraftPatch(draft),
      user_agent: draft.fingerprint_user_agent.trim(),
      webgl_vendor: draft.fingerprint_webgl_vendor.trim(),
      webgl_renderer: draft.fingerprint_webgl_renderer.trim(),
    },
    created_at: createdAt,
  };
}

export function newProxyDraft(): ProxyDraft {
  return {
    name: '',
    type: 'socks5',
    host: '',
    port: '',
    username: '',
    password: '',
  };
}

export function draftFromProxy(proxy: ArgusProxy): ProxyDraft {
  return {
    id: proxy.id,
    name: proxy.name || '',
    type: proxy.type || 'http',
    host: proxy.host,
    port: String(proxy.port || ''),
    username: proxy.username || '',
    password: proxy.password || '',
  };
}

export function newBookmarkDraft(): BookmarkDraft {
  return {
    title: '',
    url: '',
    icon: '',
  };
}

export function draftFromBookmark(bookmark: SharedBookmark): BookmarkDraft {
  return {
    originalUrl: bookmark.url,
    title: bookmark.title || '',
    url: bookmark.url || '',
    icon: bookmark.icon || '',
  };
}
