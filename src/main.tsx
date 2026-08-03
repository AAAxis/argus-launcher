import React, {useEffect, useMemo, useRef, useState} from 'react';
import {createRoot} from 'react-dom/client';
import * as CountryFlagIcons from 'country-flag-icons/react/3x2';
import {Apple, Bot, Copy, Cookie, Download, Hexagon, Monitor, Pencil, Plug, Plus, Play, RefreshCw, Shield, Smartphone, SquareTerminal, Trash2, Upload, Waypoints, X} from 'lucide-react';
import * as db from './db';
import {describeDbError} from './db/errors';
import {native} from './native';
import type {ApiKey, ApiState, CookieFileSelection, ResourceState, UpdateState} from './native';
import {OrgProvider, useOrg} from './org';
import {supabase} from './supabase';
import type {ArgusCookie, ArgusFolder, ArgusProfile, ArgusProxy, BuiltInExtensionToggles, CloudState, ProxyMode, RuntimeFingerprint, SharedBookmark, SharedExtension} from './types';
import {useAsyncAction} from './useAsyncAction';
import './styles.css';

// Where the account pages live. Registration, Google sign-in and password
// reset are all web-only -- the launcher does the email+password grant and
// nothing else -- so the sign-in screen links out to these.
//
// The main process independently allowlists which hosts it will open, so
// pointing this at some other origin does not widen what can be launched.
const SITE_URL = (import.meta.env.VITE_SITE_URL as string | undefined)?.replace(/\/+$/, '') ||
  'https://www.browserargus.com';

type TabId = 'profiles' | 'proxies' | 'cookies' | 'bookmarks' | 'extensions' | 'integrations' | 'api';

type ApiEndpoint = {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  path: string;
  label: string;
  body?: string;
};

type ApiGroup = {
  title: string;
  endpoints: ApiEndpoint[];
};

type ProfileDraft = {
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

type ProxyDraft = {
  id?: string;
  name: string;
  type: 'http' | 'socks5';
  host: string;
  port: string;
  username: string;
  password: string;
};

type BookmarkDraft = {
  originalUrl?: string;
  title: string;
  url: string;
  icon: string;
};

type FolderDraft = {
  id?: string;
  name: string;
};

type StatusDraft = {
  name: string;
};

const tabs: Array<{id: TabId; label: string}> = [
  {id: 'profiles', label: 'Profiles'},
  {id: 'proxies', label: 'Proxies'},
  {id: 'cookies', label: 'Cookies'},
  {id: 'bookmarks', label: 'Bookmarks'},
  {id: 'extensions', label: 'Extensions'},
  {id: 'integrations', label: 'Integrations'},
  {id: 'api', label: 'API'},
];

const API_BASE_URL = 'http://127.0.0.1:39219';
const API_GROUPS: ApiGroup[] = [
  {
    title: 'Profiles',
    endpoints: [
      {method: 'GET', path: '/v1/profiles', label: 'List profiles'},
      {
        method: 'POST',
        path: '/v1/profiles',
        label: 'Create profile',
        body: '{ "name": "Profile 1", "proxyId": "proxy_id" }',
      },
      {
        method: 'PATCH',
        path: '/v1/profiles/{id}',
        label: 'Update status, tags, folder, or proxy',
        body: '{ "status": "Ready", "tags": ["warmup"] }',
      },
      {method: 'DELETE', path: '/v1/profiles/{id}', label: 'Delete profile'},
      {method: 'POST', path: '/v1/profiles/{id}/launch', label: 'Launch anonymous browser session'},
      {method: 'POST', path: '/v1/profiles/{id}/close', label: 'Close browser session'},
    ],
  },
  {
    title: 'Proxies',
    endpoints: [
      {method: 'GET', path: '/v1/proxies', label: 'List proxies'},
      {
        method: 'POST',
        path: '/v1/proxies',
        label: 'Add proxy',
        body: '{ "name": "US proxy", "type": "socks5", "host": "1.2.3.4", "port": 1080 }',
      },
      {method: 'POST', path: '/v1/proxies/{id}/check', label: 'Check egress IP'},
      {method: 'DELETE', path: '/v1/proxies/{id}', label: 'Remove proxy'},
    ],
  },
  {
    title: 'Shared data',
    endpoints: [
      {method: 'GET', path: '/v1/shared/bookmarks', label: 'List shared bookmarks'},
      {
        method: 'POST',
        path: '/v1/shared/bookmarks',
        label: 'Create or update bookmark',
        body: '{ "title": "Argys", "url": "https://www.browserargus.com/" }',
      },
      {method: 'DELETE', path: '/v1/shared/bookmarks', label: 'Remove bookmark by URL'},
      {method: 'GET', path: '/v1/shared/extensions', label: 'List shared extensions'},
      {
        method: 'POST',
        path: '/v1/shared/extensions',
        label: 'Register unpacked extension path',
        body: '{ "path": "/Users/name/extension" }',
      },
      {
        method: 'DELETE',
        path: '/v1/shared/extensions',
        label: 'Remove extension by path',
        body: '{ "path": "/Users/name/extension" }',
      },
    ],
  },
];

type IntegrationId = 'hive' | 'claude-code' | 'codex' | 'openclaw';

// Generic Lucide glyphs, not the real product marks -- swap for actual
// brand logos (SVG assets) whenever those are available.
const INTEGRATIONS: Array<{id: IntegrationId; name: string; description: string; icon: typeof Hexagon}> = [
  {
    id: 'hive',
    name: 'Hive',
    description: 'Multi-agent runtime -- run QA/monitoring sweeps across many profiles in parallel.',
    icon: Hexagon,
  },
  {
    id: 'claude-code',
    name: 'Claude Code',
    description: "Anthropic's coding agent CLI -- drive profiles as MCP tools from any project.",
    icon: Bot,
  },
  {
    id: 'codex',
    name: 'Codex',
    description: "OpenAI's coding agent CLI -- same MCP tools, wired into Codex's own config.",
    icon: SquareTerminal,
  },
  {
    id: 'openclaw',
    name: 'OpenClaw',
    description: 'Personal AI assistant gateway across chat channels -- same MCP tools, wired into its own config.',
    icon: Waypoints,
  },
];

// Where argus-hive-bridge lives on this machine -- not user-editable in the
// UI; update this if the checkout ever moves.
const BRIDGE_PATH = 'C:\\Users\\dima\\argus-hive-bridge';

const defaultState: CloudState = {
  profiles: [],
  folders: [],
  proxies: [],
  cookies: [],
  shared_extensions: [],
  shared_bookmarks: [],
  custom_statuses: [],
};

const baseProfileStatuses = ['Ready', 'Active', 'Warmup', 'Ban', 'Review'];

// Custom statuses (user-created) fall through to the neutral default class --
// only the known built-in ones get a distinct color.
function statusSelectClass(status: string): string {
  switch (status) {
    case 'Active':
      return 'status-select status-active';
    case 'Warmup':
      return 'status-select status-warmup';
    case 'Ban':
      return 'status-select status-ban';
    case 'Review':
      return 'status-select status-review';
    default:
      return 'status-select';
  }
}
// Sentinel folder_id used to view Trash in the profiles folder bar; never
// written to a profile's actual folder_id.
const TRASH_FOLDER_ID = '__trash__';
const TRASH_RETENTION_DAYS = 30;

function daysUntilPurge(deletedAt: string): number {
  const purgeAt = Date.parse(deletedAt) + TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  return Math.max(0, Math.ceil((purgeAt - Date.now()) / (24 * 60 * 60 * 1000)));
}

// Anything soft-deleted before this instant has served its time in Trash. Sent
// straight to the delete statement so the purge is one round trip rather than a
// filter-and-rewrite of the whole profiles array.
function trashCutoffIso(): string {
  return new Date(Date.now() - TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

// Mirrors the profiles_id_fs_safe CHECK in supabase/migrations/0005. Ids are
// also directory names under E:\ArgysProfiles, and the database is what
// enforces that -- this is only here so the CSV importer, which takes
// profile_id straight from a user-supplied file, can name the offending row in
// its skipped list instead of surfacing a raw constraint violation.
function isFsSafeId(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value) && value.length <= 128;
}
const profileColors = ['#171613', '#2563eb', '#16a34a', '#a855f7', '#dc2626', '#f59e0b'];
const osPresets = ['Android', 'iOS', 'macOS', 'Windows 11', 'Windows 10', 'Ubuntu'];
const browserVersionPresets = ['Auto', 'Chrome 126', 'Chrome 125', 'Chrome 124'];
const AUTO_FROM_PROXY = 'Auto from proxy';
const languagePresets = [AUTO_FROM_PROXY, 'en-US,en;q=0.9', 'en-GB,en;q=0.9', 'ru-RU,ru;q=0.9,en;q=0.8'];
const timezonePresets = ['Auto from proxy', 'America/New_York', 'America/Los_Angeles', 'Europe/London', 'Asia/Jerusalem'];
const webRtcModes = ['Proxy only', 'Disabled', 'Real', 'Custom'];
const noiseModes = ['Real', 'Noise', 'Block'];
const webGpuModes = ['Real', 'Block'];
const mediaDevicePresets = [
  '1 camera 1 microphone 1 speaker',
  '0 camera 1 microphone 1 speaker',
  '1 camera 1 microphone 0 speaker',
  '0 camera 0 microphone 0 speaker',
];
const portsToProtect = '3389,5900,5800,7070,6568,5938,63333,5901,5902,5903,5950,5931,5939,6039,5944,6040,5279,2112';
const screenPresets = ['Auto', '390x844', '393x873', '412x915', '430x932', '1920x1080', '1536x864', '1366x768', '1600x900', '1920x1200', '2560x1440', '2560x1600', '3440x1440', '3840x2160'];
const webglVendors = ['Google Inc. (NVIDIA)', 'Google Inc. (AMD)', 'Google Inc. (Intel)', 'Google Inc. (Qualcomm)', 'Google Inc.', 'Apple Inc.'];
const webglRenderers = [
  'Adreno (TM) 740',
  'Apple GPU',
  'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)',
  'ANGLE (NVIDIA, NVIDIA GeForce RTX 4060 Direct3D11 vs_5_0 ps_5_0, D3D11)',
  'ANGLE (NVIDIA, NVIDIA GeForce GTX 1650 Direct3D11 vs_5_0 ps_5_0, D3D11)',
  'ANGLE (AMD, AMD Radeon RX 6600 Direct3D11 vs_5_0 ps_5_0, D3D11)',
  'ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)',
];

const osFingerprintDefaults: Record<string, Partial<ProfileDraft>> = {
  Android: {
    fingerprint_user_agent: '',
    fingerprint_webgl_vendor: 'Google Inc. (Qualcomm)',
    fingerprint_webgl_renderer: 'Adreno (TM) 740',
    fingerprint_screen: '393x873',
    fingerprint_cpu_model: 'Qualcomm Snapdragon 8 Gen 2',
    fingerprint_cpu_cores: '8',
    fingerprint_memory_gb: '8',
    fingerprint_media_devices: '1 camera 1 microphone 1 speaker',
  },
  iOS: {
    fingerprint_user_agent: '',
    fingerprint_webgl_vendor: 'Apple Inc.',
    fingerprint_webgl_renderer: 'Apple GPU',
    fingerprint_screen: '390x844',
    fingerprint_cpu_model: 'Apple A16 Bionic',
    fingerprint_cpu_cores: '6',
    fingerprint_memory_gb: '6',
    fingerprint_media_devices: '1 camera 1 microphone 1 speaker',
  },
  macOS: {
    fingerprint_user_agent: '',
    fingerprint_webgl_vendor: 'Apple Inc.',
    fingerprint_webgl_renderer: 'Apple GPU',
    fingerprint_screen: '1512x982',
    fingerprint_cpu_model: 'Apple M2',
    fingerprint_cpu_cores: '8',
    fingerprint_memory_gb: '8',
  },
  Ubuntu: {
    fingerprint_user_agent: '',
    fingerprint_webgl_vendor: 'Google Inc. (Intel)',
    fingerprint_webgl_renderer: 'ANGLE (Intel, Mesa Intel(R) UHD Graphics, OpenGL)',
    fingerprint_screen: '1920x1080',
    fingerprint_cpu_model: 'Intel Core i5-12400',
    fingerprint_cpu_cores: '12',
    fingerprint_memory_gb: '8',
  },
};

type RealisticFingerprintPattern = Pick<ProfileDraft,
  'fingerprint_os' |
  'fingerprint_browser_version' |
  'fingerprint_webgl_vendor' |
  'fingerprint_webgl_renderer' |
  'fingerprint_screen' |
  'fingerprint_cpu_model' |
  'fingerprint_cpu_cores' |
  'fingerprint_memory_gb'
>;

const realisticWindowsFingerprintPatterns: RealisticFingerprintPattern[] = [
  {
    fingerprint_os: 'Windows 11',
    fingerprint_browser_version: 'Auto',
    fingerprint_webgl_vendor: 'Google Inc. (NVIDIA)',
    fingerprint_webgl_renderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)',
    fingerprint_screen: '1920x1080',
    fingerprint_cpu_model: 'Intel Core i5-12400F',
    fingerprint_cpu_cores: '12',
    fingerprint_memory_gb: '8',
  },
  {
    fingerprint_os: 'Windows 11',
    fingerprint_browser_version: 'Auto',
    fingerprint_webgl_vendor: 'Google Inc. (NVIDIA)',
    fingerprint_webgl_renderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 4060 Direct3D11 vs_5_0 ps_5_0, D3D11)',
    fingerprint_screen: '1920x1080',
    fingerprint_cpu_model: 'Intel Core i5-13400F',
    fingerprint_cpu_cores: '16',
    fingerprint_memory_gb: '8',
  },
  {
    fingerprint_os: 'Windows 11',
    fingerprint_browser_version: 'Auto',
    fingerprint_webgl_vendor: 'Google Inc. (NVIDIA)',
    fingerprint_webgl_renderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3070 Direct3D11 vs_5_0 ps_5_0, D3D11)',
    fingerprint_screen: '2560x1440',
    fingerprint_cpu_model: 'AMD Ryzen 7 5800X',
    fingerprint_cpu_cores: '16',
    fingerprint_memory_gb: '16',
  },
  {
    fingerprint_os: 'Windows 11',
    fingerprint_browser_version: 'Auto',
    fingerprint_webgl_vendor: 'Google Inc. (NVIDIA)',
    fingerprint_webgl_renderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 Direct3D11 vs_5_0 ps_5_0, D3D11)',
    fingerprint_screen: '2560x1440',
    fingerprint_cpu_model: 'Intel Core i7-13700K',
    fingerprint_cpu_cores: '20',
    fingerprint_memory_gb: '16',
  },
  {
    fingerprint_os: 'Windows 10',
    fingerprint_browser_version: 'Auto',
    fingerprint_webgl_vendor: 'Google Inc. (NVIDIA)',
    fingerprint_webgl_renderer: 'ANGLE (NVIDIA, NVIDIA GeForce GTX 1650 Direct3D11 vs_5_0 ps_5_0, D3D11)',
    fingerprint_screen: '1920x1080',
    fingerprint_cpu_model: 'Intel Core i5-10400',
    fingerprint_cpu_cores: '8',
    fingerprint_memory_gb: '8',
  },
  {
    fingerprint_os: 'Windows 10',
    fingerprint_browser_version: 'Auto',
    fingerprint_webgl_vendor: 'Google Inc. (NVIDIA)',
    fingerprint_webgl_renderer: 'ANGLE (NVIDIA, NVIDIA GeForce GTX 1660 SUPER Direct3D11 vs_5_0 ps_5_0, D3D11)',
    fingerprint_screen: '1920x1080',
    fingerprint_cpu_model: 'Intel Core i5-11400',
    fingerprint_cpu_cores: '12',
    fingerprint_memory_gb: '8',
  },
  {
    fingerprint_os: 'Windows 10',
    fingerprint_browser_version: 'Auto',
    fingerprint_webgl_vendor: 'Google Inc. (NVIDIA)',
    fingerprint_webgl_renderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 2060 Direct3D11 vs_5_0 ps_5_0, D3D11)',
    fingerprint_screen: '1920x1080',
    fingerprint_cpu_model: 'AMD Ryzen 5 3600',
    fingerprint_cpu_cores: '12',
    fingerprint_memory_gb: '8',
  },
  {
    fingerprint_os: 'Windows 11',
    fingerprint_browser_version: 'Auto',
    fingerprint_webgl_vendor: 'Google Inc. (NVIDIA)',
    fingerprint_webgl_renderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3080 Direct3D11 vs_5_0 ps_5_0, D3D11)',
    fingerprint_screen: '3840x2160',
    fingerprint_cpu_model: 'Intel Core i9-12900K',
    fingerprint_cpu_cores: '24',
    fingerprint_memory_gb: '16',
  },
  {
    fingerprint_os: 'Windows 11',
    fingerprint_browser_version: 'Auto',
    fingerprint_webgl_vendor: 'Google Inc. (NVIDIA)',
    fingerprint_webgl_renderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 4050 Laptop GPU Direct3D11 vs_5_0 ps_5_0, D3D11)',
    fingerprint_screen: '1920x1200',
    fingerprint_cpu_model: 'Intel Core i7-12700H',
    fingerprint_cpu_cores: '16',
    fingerprint_memory_gb: '8',
  },
  {
    fingerprint_os: 'Windows 11',
    fingerprint_browser_version: 'Auto',
    fingerprint_webgl_vendor: 'Google Inc. (NVIDIA)',
    fingerprint_webgl_renderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 4060 Laptop GPU Direct3D11 vs_5_0 ps_5_0, D3D11)',
    fingerprint_screen: '2560x1600',
    fingerprint_cpu_model: 'Intel Core i7-13700H',
    fingerprint_cpu_cores: '20',
    fingerprint_memory_gb: '16',
  },
  {
    fingerprint_os: 'Windows 10',
    fingerprint_browser_version: 'Auto',
    fingerprint_webgl_vendor: 'Google Inc. (NVIDIA)',
    fingerprint_webgl_renderer: 'ANGLE (NVIDIA, NVIDIA GeForce GTX 1050 Ti Direct3D11 vs_5_0 ps_5_0, D3D11)',
    fingerprint_screen: '1366x768',
    fingerprint_cpu_model: 'Intel Core i5-7300HQ',
    fingerprint_cpu_cores: '8',
    fingerprint_memory_gb: '8',
  },
  {
    fingerprint_os: 'Windows 11',
    fingerprint_browser_version: 'Auto',
    fingerprint_webgl_vendor: 'Google Inc. (AMD)',
    fingerprint_webgl_renderer: 'ANGLE (AMD, AMD Radeon RX 6600 Direct3D11 vs_5_0 ps_5_0, D3D11)',
    fingerprint_screen: '1920x1080',
    fingerprint_cpu_model: 'AMD Ryzen 5 5600X',
    fingerprint_cpu_cores: '12',
    fingerprint_memory_gb: '8',
  },
  {
    fingerprint_os: 'Windows 11',
    fingerprint_browser_version: 'Auto',
    fingerprint_webgl_vendor: 'Google Inc. (AMD)',
    fingerprint_webgl_renderer: 'ANGLE (AMD, AMD Radeon RX 6700 XT Direct3D11 vs_5_0 ps_5_0, D3D11)',
    fingerprint_screen: '2560x1440',
    fingerprint_cpu_model: 'AMD Ryzen 7 5800X3D',
    fingerprint_cpu_cores: '16',
    fingerprint_memory_gb: '16',
  },
  {
    fingerprint_os: 'Windows 11',
    fingerprint_browser_version: 'Auto',
    fingerprint_webgl_vendor: 'Google Inc. (AMD)',
    fingerprint_webgl_renderer: 'ANGLE (AMD, AMD Radeon RX 7600 Direct3D11 vs_5_0 ps_5_0, D3D11)',
    fingerprint_screen: '1920x1080',
    fingerprint_cpu_model: 'AMD Ryzen 5 7600',
    fingerprint_cpu_cores: '12',
    fingerprint_memory_gb: '8',
  },
  {
    fingerprint_os: 'Windows 11',
    fingerprint_browser_version: 'Auto',
    fingerprint_webgl_vendor: 'Google Inc. (AMD)',
    fingerprint_webgl_renderer: 'ANGLE (AMD, AMD Radeon RX 7800 XT Direct3D11 vs_5_0 ps_5_0, D3D11)',
    fingerprint_screen: '2560x1440',
    fingerprint_cpu_model: 'AMD Ryzen 7 7800X3D',
    fingerprint_cpu_cores: '16',
    fingerprint_memory_gb: '16',
  },
  {
    fingerprint_os: 'Windows 11',
    fingerprint_browser_version: 'Auto',
    fingerprint_webgl_vendor: 'Google Inc. (AMD)',
    fingerprint_webgl_renderer: 'ANGLE (AMD, AMD Radeon Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)',
    fingerprint_screen: '1920x1080',
    fingerprint_cpu_model: 'AMD Ryzen 7 5700U',
    fingerprint_cpu_cores: '12',
    fingerprint_memory_gb: '8',
  },
  {
    fingerprint_os: 'Windows 10',
    fingerprint_browser_version: 'Auto',
    fingerprint_webgl_vendor: 'Google Inc. (Intel)',
    fingerprint_webgl_renderer: 'ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0, D3D11)',
    fingerprint_screen: '1366x768',
    fingerprint_cpu_model: 'Intel Core i5-8250U',
    fingerprint_cpu_cores: '8',
    fingerprint_memory_gb: '8',
  },
  {
    fingerprint_os: 'Windows 11',
    fingerprint_browser_version: 'Auto',
    fingerprint_webgl_vendor: 'Google Inc. (Intel)',
    fingerprint_webgl_renderer: 'ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)',
    fingerprint_screen: '1920x1200',
    fingerprint_cpu_model: 'Intel Core i5-1135G7',
    fingerprint_cpu_cores: '12',
    fingerprint_memory_gb: '8',
  },
  {
    fingerprint_os: 'Windows 11',
    fingerprint_browser_version: 'Auto',
    fingerprint_webgl_vendor: 'Google Inc. (Intel)',
    fingerprint_webgl_renderer: 'ANGLE (Intel, Intel(R) Arc(TM) A750 Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)',
    fingerprint_screen: '2560x1440',
    fingerprint_cpu_model: 'Intel Core i5-12600K',
    fingerprint_cpu_cores: '16',
    fingerprint_memory_gb: '16',
  },
  {
    fingerprint_os: 'Windows 11',
    fingerprint_browser_version: 'Auto',
    fingerprint_webgl_vendor: 'Google Inc. (NVIDIA)',
    fingerprint_webgl_renderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3050 Direct3D11 vs_5_0 ps_5_0, D3D11)',
    fingerprint_screen: '1536x864',
    fingerprint_cpu_model: 'Intel Core i5-11400H',
    fingerprint_cpu_cores: '12',
    fingerprint_memory_gb: '8',
  },
];

// Real device bundles for Android/iOS -- screen/GPU/CPU/memory are picked
// together as one unit (via the "Device model" field below) instead of the
// free-mix GPU/CPU dropdowns desktop platforms use, so a profile can no
// longer end up as "Android" reporting an NVIDIA desktop GPU string. iOS
// entries all use "Apple Inc." / "Apple GPU" since every iOS browser is
// WebKit-based on real hardware, regardless of model.
type MobileDevicePattern = RealisticFingerprintPattern & {label: string};
const mobileDevicePatterns: MobileDevicePattern[] = [
  {
    label: 'iPhone 15 Pro Max',
    fingerprint_os: 'iOS',
    fingerprint_browser_version: 'Auto',
    fingerprint_webgl_vendor: 'Apple Inc.',
    fingerprint_webgl_renderer: 'Apple GPU',
    fingerprint_screen: '430x932',
    fingerprint_cpu_model: 'Apple A17 Pro',
    fingerprint_cpu_cores: '6',
    fingerprint_memory_gb: '8',
  },
  {
    label: 'iPhone 15',
    fingerprint_os: 'iOS',
    fingerprint_browser_version: 'Auto',
    fingerprint_webgl_vendor: 'Apple Inc.',
    fingerprint_webgl_renderer: 'Apple GPU',
    fingerprint_screen: '393x852',
    fingerprint_cpu_model: 'Apple A16 Bionic',
    fingerprint_cpu_cores: '6',
    fingerprint_memory_gb: '6',
  },
  {
    label: 'iPhone 14',
    fingerprint_os: 'iOS',
    fingerprint_browser_version: 'Auto',
    fingerprint_webgl_vendor: 'Apple Inc.',
    fingerprint_webgl_renderer: 'Apple GPU',
    fingerprint_screen: '390x844',
    fingerprint_cpu_model: 'Apple A15 Bionic',
    fingerprint_cpu_cores: '6',
    fingerprint_memory_gb: '6',
  },
  {
    label: 'iPhone 13 mini',
    fingerprint_os: 'iOS',
    fingerprint_browser_version: 'Auto',
    fingerprint_webgl_vendor: 'Apple Inc.',
    fingerprint_webgl_renderer: 'Apple GPU',
    fingerprint_screen: '375x812',
    fingerprint_cpu_model: 'Apple A15 Bionic',
    fingerprint_cpu_cores: '6',
    fingerprint_memory_gb: '4',
  },
  {
    label: 'Samsung Galaxy S24 Ultra',
    fingerprint_os: 'Android',
    fingerprint_browser_version: 'Auto',
    fingerprint_webgl_vendor: 'Google Inc. (Qualcomm)',
    fingerprint_webgl_renderer: 'Adreno (TM) 750',
    fingerprint_screen: '412x915',
    fingerprint_cpu_model: 'Qualcomm Snapdragon 8 Gen 3',
    fingerprint_cpu_cores: '8',
    fingerprint_memory_gb: '12',
  },
  {
    label: 'Samsung Galaxy S23',
    fingerprint_os: 'Android',
    fingerprint_browser_version: 'Auto',
    fingerprint_webgl_vendor: 'Google Inc. (Qualcomm)',
    fingerprint_webgl_renderer: 'Adreno (TM) 740',
    fingerprint_screen: '360x780',
    fingerprint_cpu_model: 'Qualcomm Snapdragon 8 Gen 2',
    fingerprint_cpu_cores: '8',
    fingerprint_memory_gb: '8',
  },
  {
    label: 'Google Pixel 8 Pro',
    fingerprint_os: 'Android',
    fingerprint_browser_version: 'Auto',
    fingerprint_webgl_vendor: 'Google Inc. (Qualcomm)',
    fingerprint_webgl_renderer: 'Adreno (TM) 740',
    fingerprint_screen: '412x892',
    fingerprint_cpu_model: 'Google Tensor G3',
    fingerprint_cpu_cores: '9',
    fingerprint_memory_gb: '12',
  },
  {
    label: 'Google Pixel 7',
    fingerprint_os: 'Android',
    fingerprint_browser_version: 'Auto',
    fingerprint_webgl_vendor: 'Google Inc. (Qualcomm)',
    fingerprint_webgl_renderer: 'Mali-G710 MC10',
    fingerprint_screen: '412x915',
    fingerprint_cpu_model: 'Google Tensor G2',
    fingerprint_cpu_cores: '8',
    fingerprint_memory_gb: '8',
  },
  {
    label: 'OnePlus 11',
    fingerprint_os: 'Android',
    fingerprint_browser_version: 'Auto',
    fingerprint_webgl_vendor: 'Google Inc. (Qualcomm)',
    fingerprint_webgl_renderer: 'Adreno (TM) 740',
    fingerprint_screen: '412x919',
    fingerprint_cpu_model: 'Qualcomm Snapdragon 8 Gen 2',
    fingerprint_cpu_cores: '8',
    fingerprint_memory_gb: '16',
  },
];

function mobileDevicePatternsFor(os: string): MobileDevicePattern[] {
  return mobileDevicePatterns.filter((item) => item.fingerprint_os === os);
}

const defaultWindowsFingerprintPattern = realisticWindowsFingerprintPatterns[0];

const gpuPresets = realisticWindowsFingerprintPatterns.map((pattern) => ({
  label: pattern.fingerprint_webgl_renderer.replace(/^ANGLE \(([^,]+), /, '').replace(/ Direct3D11.*$/, ''),
  vendor: pattern.fingerprint_webgl_vendor,
  renderer: pattern.fingerprint_webgl_renderer,
}));

const cpuPresets = Array.from(new Map(realisticWindowsFingerprintPatterns.map((pattern) => [
  pattern.fingerprint_cpu_model,
  {
    model: pattern.fingerprint_cpu_model,
    cores: pattern.fingerprint_cpu_cores,
  },
])).values());

const memoryPresets = ['4', '8', '16', '32'];

// Renders a real flag SVG (bundled, so it never depends on the OS having a
// color-emoji font with flag glyphs -- Regional Indicator Symbol emoji looked
// right in theory but rendered as two boxed letters on this user's Windows
// build even with an explicit emoji font-family). Falls back to the bare
// 2-letter code as text if it's not a recognized ISO code.
function FlagIcon({countryCode}: {countryCode?: string}) {
  const code = countryCode?.trim().toUpperCase();
  const Flag = code && /^[A-Z]{2}$/.test(code) ?
    (CountryFlagIcons as Record<string, React.FC<React.SVGProps<SVGSVGElement>>>)[code] :
    undefined;
  if (Flag) {
    return <Flag className="flag-svg" />;
  }
  return <>{code || '--'}</>;
}

// Maps a fingerprint OS preset (see osPresets) to a generic device-type icon
// -- lucide-react has no Windows/Android/Ubuntu brand logos, so this
// distinguishes desktop vs. mobile and gives macOS its own glyph rather than
// showing nothing at all.
function PlatformIcon({os}: {os?: string}) {
  const label = os || 'Unknown';
  if (os === 'macOS') {
    return <Apple size={16} aria-label={label}><title>{label}</title></Apple>;
  }
  if (os === 'Android' || os === 'iOS') {
    return <Smartphone size={16} aria-label={label}><title>{label}</title></Smartphone>;
  }
  if (os === 'Windows 11' || os === 'Windows 10' || os === 'Ubuntu') {
    return <Monitor size={16} aria-label={label}><title>{label}</title></Monitor>;
  }
  return <Monitor size={16} aria-label={label} opacity={0.4}><title>{label}</title></Monitor>;
}

const socialBookmarks: SharedBookmark[] = [
  {title: 'Reddit', url: 'https://www.reddit.com/'},
  {title: 'Instagram', url: 'https://www.instagram.com/'},
  {title: 'TikTok', url: 'https://www.tiktok.com/'},
  {title: 'Facebook', url: 'https://www.facebook.com/'},
];

function initials(value: string) {
  return value
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join('') || 'A';
}

function profileDataDir(profileId: string) {
  return `${navigator.platform.includes('Mac') ? '/Users/dima/Library/Application Support/Argys Browser/Profiles' : 'ArgysProfiles'}/${profileId}`;
}

function escapeHtml(value: string) {
  return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
}

function normalizeBookmarkUrl(url: string) {
  const trimmed = url.trim();
  if (!trimmed) {
    return '';
  }
  return /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

function mergeBookmarks(bookmarks: SharedBookmark[], presets: SharedBookmark[]) {
  const byUrl = new Map(bookmarks.map((bookmark) => [
    normalizeBookmarkUrl(bookmark.url).toLowerCase(),
    bookmark,
  ]));
  let changed = false;
  for (const preset of presets) {
    const key = normalizeBookmarkUrl(preset.url).toLowerCase();
    if (!byUrl.has(key)) {
      byUrl.set(key, preset);
      changed = true;
    }
  }
  return {bookmarks: [...byUrl.values()], changed};
}

function homeProxyStatus(profile: ArgusProfile, proxy: ArgusProxy | null) {
  const mode = profile.proxy_mode || 'assigned';
  if (mode !== 'assigned') {
    return {
      ok: false,
      title: mode === 'free_proxy' ? 'Anti-detect needs verified proxy' : 'Anti-detect proxy missing',
      detail: mode === 'free_proxy' ?
        'Free proxy fallback is active, but no verified assigned proxy is available.' :
        'Direct connection is active. Assign a checked proxy before using this profile.',
    };
  }
  if (!proxy?.host || !proxy.port) {
    return {
      ok: false,
      title: 'Anti-detect proxy missing',
      detail: 'No valid proxy is assigned to this profile.',
    };
  }
  const proxyLabel = `${proxy.host}:${proxy.port}`;
  if (proxy.check_error) {
    return {
      ok: false,
      title: 'Anti-detect proxy failed',
      detail: `${proxyLabel} failed its last check: ${proxy.check_error}`,
    };
  }
  if (!proxy.checked_at) {
    return {
      ok: false,
      title: 'Anti-detect proxy unverified',
      detail: `${proxyLabel} has not passed a proxy check yet.`,
    };
  }
  const egressIp = proxy.egress_ip && proxy.egress_ip !== proxy.host ? proxy.egress_ip : '';
  const location = [proxy.country || proxy.country_code, egressIp]
      .filter(Boolean)
      .join(' · ');
  const latency = typeof proxy.ping_ms === 'number' ? ` · ${proxy.ping_ms}ms` : '';
  return {
    ok: true,
    title: 'Anti-detect proxy active',
    detail: `${proxyLabel}${location ? ` · ${location}` : ''}${latency}`,
  };
}

function anonymousHomeHtml(profile: ArgusProfile, bookmarks: SharedBookmark[], proxy: ArgusProxy | null) {
  const safeName = escapeHtml(profile.name || 'Profile');
  const proxyStatus = homeProxyStatus(profile, proxy);
  const badgeClass = proxyStatus.ok ? 'badge ok' : 'badge fail';
  const badgeTitle = escapeHtml(proxyStatus.title);
  const badgeDetail = escapeHtml(proxyStatus.detail);
  const bookmarkItems = bookmarks
      .map((bookmark) => {
        const url = normalizeBookmarkUrl(bookmark.url);
        if (!url) {
          return '';
        }
        const title = escapeHtml(bookmark.title || url);
        const safeUrl = escapeHtml(url);
        const initial = escapeHtml((bookmark.title || url).trim()[0]?.toUpperCase() || 'A');
        return `<a class="bookmark" href="${safeUrl}">
          <span>${initial}</span>
          <strong>${title}</strong>
          <small>${safeUrl}</small>
        </a>`;
      })
      .join('');
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${safeName}</title>
<style>
body{margin:0;background:#fbfaf8;color:#1d1c18;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
main{min-height:100vh;padding:56px;box-sizing:border-box}
header{display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #e4ddd1;padding-bottom:24px}
h1{font-size:34px;margin:0 0 8px;font-weight:850}
p{margin:0;color:#716b62;font-size:17px}
.badge{align-items:flex-start;border:1px solid #ded6c8;border-radius:14px;display:grid;gap:4px;max-width:420px;padding:10px 14px;background:#fff;font-weight:750;text-decoration:none}
.badge::before{border-radius:999px;content:"";height:10px;margin-top:4px;width:10px;grid-row:1 / span 2}
.badge.ok{border-color:#9fd3b2;background:#f1fbf5;color:#14532d;grid-template-columns:10px 1fr}
.badge.ok::before{background:#16a34a}
.badge.fail{border-color:#f0b4ad;background:#fff5f4;color:#7f1d1d;grid-template-columns:10px 1fr}
.badge.fail::before{background:#dc2626}
.badge:hover{filter:brightness(.98)}
.badge strong{font-size:13px;line-height:1.2}
.badge small{color:inherit;font-size:12px;font-weight:650;line-height:1.35;opacity:.78;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:14px;margin-top:34px}
.bookmark{display:grid;grid-template-columns:44px 1fr;gap:10px;align-items:center;text-decoration:none;color:inherit;background:#fff;border:1px solid #e4ddd1;border-radius:12px;padding:16px;min-height:82px}
.bookmark:hover{border-color:#171613}
.bookmark span{width:44px;height:44px;border-radius:12px;background:#171613;color:#fff;display:grid;place-items:center;font-weight:850}
.bookmark strong{font-size:16px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bookmark small{grid-column:2;color:#716b62;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.empty{margin-top:34px;color:#716b62}
</style>
</head>
<body>
<main>
<header>
<div><h1>${safeName}</h1><p>Anonymous Argys Browser session</p></div>
<a class="${badgeClass}" href="https://ip.me/"><strong>${badgeTitle}</strong><small>${badgeDetail}</small></a>
</header>
${bookmarkItems ? `<section class="grid">${bookmarkItems}</section>` : '<p class="empty">No shared bookmarks yet.</p>'}
</main>
</body>
</html>`;
}

function browserStartUrl(profile: ArgusProfile) {
  const startUrl = profile.start_url?.trim();
  if (!startUrl ||
      startUrl === 'about:blank' ||
      startUrl.startsWith('chrome://') ||
      startUrl.includes('127.0.0.1') ||
      startUrl.includes('localhost') ||
      startUrl.includes('argus-launcher') ||
      startUrl.includes('/dist/index.html')) {
    return '';
  }
  return startUrl;
}

function statusList(...groups: Array<Array<string | undefined | null>>) {
  const seen = new Set<string>();
  const list: string[] = [];
  for (const group of groups) {
    for (const value of group) {
      const status = String(value || '').trim();
      const key = status.toLowerCase();
      if (!status || seen.has(key)) {
        continue;
      }
      seen.add(key);
      list.push(status);
    }
  }
  return list;
}

function newProfileDraft(): ProfileDraft {
  return {
    name: `Profile ${new Date().toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'})}`,
    status: 'Ready',
    color: profileColors[1],
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

function draftFromProfile(profile: ArgusProfile): ProfileDraft {
  const fingerprint = profile.fingerprint || {};
  return {
    id: profile.id,
    name: profile.name,
    status: profile.status || 'Ready',
    color: profile.color || profileColors[1],
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

function tagsFromDraft(value: string) {
  return value.split(',')
      .map((tag) => tag.trim())
      .filter(Boolean);
}

function comparable(value: unknown) {
  return String(value || '').trim().toLowerCase();
}

function numberOrNull(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

type ImportResult = {
  created: number;
  updated: number;
  proxiesCreated: number;
  proxiesReused: number;
  foldersCreated: number;
  skipped: Array<{name: string; reason: string}>;
};

// Minimal RFC 4180 CSV parser: handles quoted fields, embedded commas/newlines,
// and doubled "" quote-escaping, which the profile inventory export relies on
// (user-agent strings, HTML notes, cookie-name lists all contain commas).
function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') {
        i++;
      }
      row.push(field);
      field = '';
      rows.push(row);
      row = [];
    } else {
      field += ch;
    }
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  const nonEmptyRows = rows.filter((r) => r.some((cell) => cell.trim() !== ''));
  if (!nonEmptyRows.length) {
    return [];
  }
  const [header, ...body] = nonEmptyRows;
  return body.map((cells) => {
    const record: Record<string, string> = {};
    header.forEach((key, index) => {
      record[key.trim()] = cells[index] ?? '';
    });
    return record;
  });
}

// Parses the "<type>://<host>:<port>:<username>:<password>" connection string
// the browser/inventory tooling embeds in proxy_name (see argus-browser's CSV
// fix-up), e.g. "socks5://45.192.39.37:63947:Evd8sDYf:pr1Ywfsh".
function parseProxyConnectionString(raw: string): {
  type: 'http' | 'socks5';
  host: string;
  port: number;
  username: string;
  password: string;
} | null {
  const match = /^(http|socks5):\/\/([^:]+):(\d+):([^:]*):(.*)$/.exec(raw.trim());
  if (!match) {
    return null;
  }
  const [, type, host, port, username, password] = match;
  return {type: type as 'http' | 'socks5', host, port: Number(port), username, password};
}

function proxyDedupeKey(type: string, host: string, port: number, username: string) {
  return [type, host, port, username].join('|').toLowerCase();
}

function csvEscape(value: string) {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

const pageSizeOptions = [25, 50, 100];

// Clamps the requested page into range so a shrinking list (filter/delete)
// never leaves the view stuck on a now-empty trailing page.
function paginate<T>(list: T[], page: number, pageSize: number) {
  const totalPages = Math.max(1, Math.ceil(list.length / pageSize));
  const clampedPage = Math.min(page, totalPages - 1);
  const start = clampedPage * pageSize;
  return {
    items: list.slice(start, start + pageSize),
    page: clampedPage,
    totalPages,
    total: list.length,
  };
}

function normalizeOsPreset(value?: string) {
  if (value === 'Windows') {
    return 'Windows 11';
  }
  if (value === 'Linux') {
    return 'Ubuntu';
  }
  return value && osPresets.includes(value) ? value : 'macOS';
}

function fingerprintPatchForOs(os: string): Partial<ProfileDraft> {
  if (os.startsWith('Windows')) {
    const matchingPatterns = realisticWindowsFingerprintPatterns.filter((pattern) =>
      pattern.fingerprint_os === os);
    return {
      ...randomChoice(matchingPatterns.length ? matchingPatterns : realisticWindowsFingerprintPatterns),
      fingerprint_user_agent: '',
    };
  }
  return osFingerprintDefaults[os] || {};
}

function withFingerprintOs(draft: ProfileDraft, os: string): ProfileDraft {
  return {
    ...draft,
    fingerprint_os: os,
    ...fingerprintPatchForOs(os),
  };
}

function randomChoice<T>(items: T[]) {
  return items[Math.floor(Math.random() * items.length)];
}

// `os` is the profile's *current* platform selection -- rotating must pick a
// new device within that same platform (another iPhone, another Android
// phone, another Windows box), never silently switch platforms. Previously
// this always drew from realisticWindowsFingerprintPatterns regardless of
// os, so rotating on an iOS/Android profile would overwrite it with a
// random Windows/Samsung-style identity -- the actual bug behind "why does
// iOS let me pick a Samsung device".
function randomFingerprintPatch(os: string): Partial<ProfileDraft> {
  const mobilePool = mobileDevicePatternsFor(os);
  if (mobilePool.length > 0) {
    const {label: _label, ...pattern} = randomChoice(mobilePool);
    return {
      ...pattern,
      fingerprint_timezone: 'Auto from proxy',
      fingerprint_geolocation: AUTO_FROM_PROXY,
      fingerprint_language: AUTO_FROM_PROXY,
      fingerprint_webrtc: 'Proxy only',
      fingerprint_canvas: 'Noise',
      fingerprint_webgl: 'Noise',
      fingerprint_webgpu: 'Real',
      fingerprint_client_rects: 'Noise',
      fingerprint_audio: 'Noise',
      fingerprint_media_devices: mediaDevicePresets[0],
      fingerprint_do_not_track: false,
      fingerprint_user_agent: '',
    };
  }
  const pattern = randomChoice(realisticWindowsFingerprintPatterns);
  return {
    ...pattern,
    // Timezone and language are deliberately NOT randomized to an unrelated
    // preset here: leaving timezone on "Auto from proxy" and preserving the
    // current language lets the launcher derive location-sensitive values
    // from the assigned proxy at launch time.
    fingerprint_timezone: 'Auto from proxy',
    fingerprint_geolocation: AUTO_FROM_PROXY,
    fingerprint_language: AUTO_FROM_PROXY,
    fingerprint_webrtc: 'Proxy only',
    fingerprint_canvas: 'Noise',
    fingerprint_webgl: 'Noise',
    fingerprint_webgpu: 'Real',
    fingerprint_client_rects: 'Noise',
    fingerprint_audio: 'Noise',
    fingerprint_media_devices: mediaDevicePresets[0],
    fingerprint_do_not_track: false,
    fingerprint_user_agent: '',
  };
}

function parseProxyLink(value: string): Omit<ArgusProxy, 'id' | 'name'> | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  try {
    const withProtocol = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `socks5://${trimmed}`;
    const url = new URL(withProtocol);
    const protocol = url.protocol.replace(':', '').toLowerCase();
    const type = protocol.startsWith('http') ? 'http' : 'socks5';
    const port = Number(url.port);
    if (!url.hostname || !Number.isInteger(port) || port < 1 || port > 65535) {
      return null;
    }
    return {
      type,
      host: url.hostname,
      port,
      username: decodeURIComponent(url.username || '') || undefined,
      password: decodeURIComponent(url.password || '') || undefined,
    };
  } catch {
    const parts = trimmed.split(':').map((part) => part.trim()).filter(Boolean);
    const first = parts[0]?.toLowerCase();
    const hasTypePrefix = first === 'http' || first === 'https' ||
      first === 'socks' || first === 'socks5';
    const type = hasTypePrefix && first?.startsWith('http') ? 'http' : 'socks5';
    const offset = hasTypePrefix ? 1 : 0;
    if (parts.length >= 2) {
      const port = Number(parts[offset + 1]);
      if (parts[offset] && Number.isInteger(port) && port > 0 && port < 65536) {
        return {
          type,
          host: parts[offset],
          port,
          username: parts[offset + 2] || undefined,
          password: parts[offset + 3] || undefined,
        };
      }
    }
    return null;
  }
}

function matchedProxyForProfile(profile: ArgusProfile, proxies: ArgusProxy[]) {
  const current = proxies.find((proxy) =>
    comparable(proxy.id) === comparable(profile.proxy_id));
  if (current) {
    return current;
  }
  const profileName = comparable(profile.name);
  return proxies.find((proxy) => {
    const proxyName = comparable(proxy.name);
    return proxyName === `${profileName} proxy` ||
      proxyName === profileName ||
      proxyName.startsWith(`${profileName} `);
  }) || null;
}

function repairProxyAssignments(state: CloudState) {
  let repaired = 0;
  const profiles = state.profiles.map((profile) => {
    const proxy = matchedProxyForProfile(profile, state.proxies);
    if (!proxy) {
      return profile;
    }
    const alreadyAssigned = comparable(profile.proxy_id) === comparable(proxy.id);
    const alreadyAssignedMode = (profile.proxy_mode || 'assigned') === 'assigned';
    if (alreadyAssigned && alreadyAssignedMode) {
      return profile;
    }
    repaired++;
    return {...profile, proxy_id: proxy.id, proxy_mode: 'assigned' as const};
  });
  return {state: {...state, profiles}, repaired};
}

// One-time backfill: profiles saved before the Cookies tab existed carry
// their cookie file only as cookie_import_url/name (no cookie_id), so they
// never show up in the shared library even though the profile clearly has
// cookies assigned. Promotes each such profile's existing import into its own
// library entry and points cookie_id at it, so the Cookies tab reflects what
// was already configured instead of appearing empty.
//
// Self-healing, not just one-time: it checks that cookie_id actually resolves
// to a real entry in `cookies`, not merely that it is set. Under the old blob
// schema a save could drop the whole `cookies` column while cookie_id -- which
// lived inside the profiles blob -- persisted fine, and a plain truthiness
// check then skipped those profiles forever, leaving the Cookies tab stuck
// empty. Relational rows make that exact failure impossible, but the resolve
// check is still the right test: a cookie set deleted by one worker leaves
// another worker's profile pointing at nothing, and this rebuilds it.
function migrateLegacyCookieImports(state: CloudState) {
  let migrated = 0;
  const cookies = [...state.cookies];
  const profiles = state.profiles.map((profile) => {
    const hasValidCookieId =
      profile.cookie_id && cookies.some((cookie) => cookie.id === profile.cookie_id);
    if (hasValidCookieId || !profile.cookie_import_url) {
      return profile;
    }
    const id = profile.cookie_id || `legacy:${profile.id}`;
    if (!cookies.some((cookie) => cookie.id === id)) {
      cookies.push({
        id,
        name: profile.cookie_import_name || `${profile.name} cookies`,
        url: profile.cookie_import_url,
        count: profile.cookie_import_count ?? null,
      });
    }
    migrated++;
    return {...profile, cookie_id: id, cookie_mode: 'saved' as const};
  });
  return {state: {...state, profiles, cookies}, migrated};
}

function proxyOptionLabel(proxy: ArgusProxy) {
  const name = proxy.name || `${proxy.host}:${proxy.port || ''}`;
  const type = (proxy.type || 'http').toUpperCase();
  const port = proxy.port ? proxy.port : 'no port';
  return `${name} · ${type} · ${proxy.host}:${port}`;
}

function fingerprintFromDraftPatch(patch: Partial<ProfileDraft>): NonNullable<ArgusProfile['fingerprint']> {
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

function fingerprintSwitches(profile: ArgusProfile) {
  const fingerprint = profile.fingerprint;
  if (!fingerprint) {
    return '';
  }
  const switches = [];
  if (fingerprint.os) {
    switches.push(`--argys-fingerprint-os=${fingerprint.os}`);
  }
  if (fingerprint.user_agent) {
    switches.push(`--user-agent=${fingerprint.user_agent}`);
  }
  if (fingerprint.language) {
    switches.push(`--lang=${fingerprint.language.split(',')[0]}`);
  }
  if (fingerprint.screen && fingerprint.screen !== 'Auto') {
    switches.push(`--window-size=${fingerprint.screen}`);
  }
  return switches.join('\n');
}

// Maps the profile-edit UI's os preset to argus::Fingerprint's `preset` and
// `platform` keys. Desktop presets use Chromium's UA-CH override path; mobile
// choices pass explicit UA/platform values through the runtime fingerprint.
function fingerprintPresetFor(os?: string): string | undefined {
  if (!os) {
    return undefined;
  }
  if (os.startsWith('Windows')) {
    return 'windows';
  }
  if (os === 'macOS') {
    return 'macos';
  }
  if (os === 'Ubuntu') {
    return 'linux';
  }
  if (os === 'Android') {
    return 'android';
  }
  if (os === 'iOS') {
    return 'ios';
  }
  return undefined;
}

function fingerprintPlatformFor(preset?: string, os?: string): string | undefined {
  if (os === 'Android') {
    return 'Linux armv8l';
  }
  if (os === 'iOS') {
    return 'iPhone';
  }
  if (preset === 'windows') {
    return 'Win32';
  }
  if (preset === 'macos') {
    return 'MacIntel';
  }
  if (preset === 'linux') {
    return 'Linux x86_64';
  }
  return undefined;
}

// iOS/CriOS has no "Chrome NNN" version concept -- it's WebKit-based, not
// Blink, so the same browserVersionPresets dropdown maps onto real iOS/
// Safari point releases instead of a Chrome major version. Previously this
// was silently ignored entirely (the iOS UA string was one hardcoded
// literal), so picking a different "Browser version" had zero effect on an
// iOS profile -- unlike Android/desktop, where it visibly changes the UA.
const iosVersionForBrowserPreset: Record<string, {ios: string; webkit: string}> = {
  'Chrome 126': {ios: '17_5', webkit: '605.1.15'},
  'Chrome 125': {ios: '17_4_1', webkit: '605.1.15'},
  'Chrome 124': {ios: '17_3_1', webkit: '605.1.15'},
};

function userAgentForFingerprint(os?: string, browserVersion?: string): string {
  const chromeVersion = browserVersion === 'Auto' || !browserVersion ?
    '149.0.0.0' :
    browserVersion.replace('Chrome ', '') + '.0.0.0';
  switch (os) {
    case 'Android':
      return `Mozilla/5.0 (Linux; Android 14; Pixel 8 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion} Mobile Safari/537.36`;
    case 'iOS': {
      const {ios, webkit} = iosVersionForBrowserPreset[browserVersion || ''] || {ios: '17_5', webkit: '605.1.15'};
      const dotted = ios.replace(/_/g, '.');
      return `Mozilla/5.0 (iPhone; CPU iPhone OS ${ios} like Mac OS X) AppleWebKit/${webkit} (KHTML, like Gecko) Version/${dotted} Mobile/15E148 Safari/604.1`;
    }
    case 'macOS':
      return `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion} Safari/537.36`;
    case 'Ubuntu':
      return `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion} Safari/537.36`;
    default:
      return `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion} Safari/537.36`;
  }
}

// UI webrtc preset -> argus::Fingerprint.webrtc_mode ("real"|"noise"|"off").
// "Proxy only" and "Custom" both resolve to "noise", which is what makes
// ArgusManager::OnBrowserCreated disable non-proxied UDP -- there's no UI
// concept mapping onto a literal "manual" WebRTC mode today.
function fingerprintWebrtcModeFor(value?: string): string | undefined {
  switch (value) {
    case 'Real':
      return 'real';
    case 'Disabled':
      return 'off';
    case 'Proxy only':
    case 'Custom':
      return 'noise';
    default:
      return undefined;
  }
}

// UI canvas/webgl noise preset -> argus::Fingerprint's canvas_mode/webgl_mode
// ("real"|"noise"|"off"). "Block" maps to "off" (the closest the browser's
// spoof-mode vocabulary has to fully suppressing the surface).
function fingerprintNoiseModeFor(value?: string): string | undefined {
  switch (value) {
    case 'Real':
      return 'real';
    case 'Noise':
      return 'noise';
    case 'Block':
      return 'off';
    default:
      return undefined;
  }
}

// UI geolocation preset -> argus::Fingerprint.geolocation_mode
// ("real"|"off"|"manual"). "manual" needs latitude/longitude, which
// electron/main.cjs fills in from the assigned proxy's country (reusing its
// existing COUNTRY_DEFAULTS resolution) if this profile didn't set explicit
// coordinates elsewhere.
function fingerprintGeolocationModeFor(value?: string): string | undefined {
  switch (value) {
    case 'Ask':
      return 'real';
    case 'Block':
      return 'off';
    case 'Auto from proxy':
      return 'manual';
    default:
      return undefined;
  }
}

// Deterministic per-profile uint32: canvas/audio noise (argus_fingerprint_
// injector.cc's noiseAt()) is seeded by this, so a profile's noise is stable
// across relaunches unless the user opted into rotate_on_launch.
function stableSeedFor(profileId: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < profileId.length; i++) {
    hash ^= profileId.charCodeAt(i);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return hash >>> 0;
}

function randomSeed(): number {
  return Math.floor(Math.random() * 0x100000000) >>> 0;
}

// Builds the full fingerprint payload the browser applies, keyed exactly like
// argus::Fingerprint's JSON dict (see chrome/browser/argus/argus_fingerprint.cc
// ToDict/FromDict). Fields the browser should resolve from the assigned
// proxy's country (timezone/languages when left on "Auto from proxy", and
// latitude/longitude for "manual" geolocation) are left undefined here --
// electron/main.cjs fills those in immediately before serializing, reusing
// its existing COUNTRY_DEFAULTS-based resolution so that logic isn't
// duplicated between the renderer and the main process.
function buildRuntimeFingerprint(profile: ArgusProfile): RuntimeFingerprint {
  const fingerprint = profile.fingerprint || {};
  const preset = fingerprintPresetFor(fingerprint.os);
  const explicitTimezone = fingerprint.timezone && fingerprint.timezone !== AUTO_FROM_PROXY ?
    fingerprint.timezone :
    undefined;
  const explicitLanguages = fingerprint.language && fingerprint.language !== AUTO_FROM_PROXY ?
    fingerprint.language.split(',').map((part) => part.split(';')[0].trim()).filter(Boolean) :
    undefined;
  const rotate = Boolean(fingerprint.rotate_on_launch);
  const seed = rotate ? randomSeed() : stableSeedFor(profile.id);
  // Mirrors Generate()'s own platform-derived defaults in argus_fingerprint.cc
  // -- touch/sensor/battery aren't separate user-facing fields, they follow
  // directly from which platform (desktop vs mobile) is selected above, same
  // as webrtc_mode/canvas_mode etc already do.
  const isMobile = preset === 'android' || preset === 'ios';
  const kBatteryLevels = [23, 41, 58, 67, 82, 94];
  return {
    platform: fingerprintPlatformFor(preset, fingerprint.os),
    ua_string: fingerprint.user_agent || userAgentForFingerprint(fingerprint.os, fingerprint.browser_version),
    preset,
    seed,
    touch_points: isMobile ? 5 : 0,
    sensor_mode: isMobile ? 'idle-realistic' : 'off',
    battery_spoof: isMobile,
    battery_level: isMobile ? kBatteryLevels[seed % kBatteryLevels.length] / 100 : undefined,
    battery_charging: isMobile ? seed % 4 === 0 : undefined,
    webrtc_mode: fingerprintWebrtcModeFor(fingerprint.webrtc),
    canvas_mode: fingerprintNoiseModeFor(fingerprint.canvas),
    webgl_mode: fingerprintNoiseModeFor(fingerprint.webgl),
    webgpu_mode: fingerprintNoiseModeFor(fingerprint.webgpu),
    client_rects_mode: fingerprintNoiseModeFor(fingerprint.client_rects),
    audio_mode: fingerprintNoiseModeFor(fingerprint.audio),
    webgl_vendor: fingerprint.webgl_vendor || undefined,
    webgl_renderer: fingerprint.webgl_renderer || undefined,
    timezone: explicitTimezone,
    languages: explicitLanguages,
    geolocation_mode: fingerprintGeolocationModeFor(fingerprint.geolocation),
    cpu_cores: numberOrNull(String(fingerprint.cpu_cores ?? '')) || undefined,
    memory_gb: numberOrNull(String(fingerprint.memory_gb ?? '')) || undefined,
    screen: fingerprint.screen && fingerprint.screen !== 'Auto' ? fingerprint.screen : undefined,
    media_devices: fingerprint.media_devices || undefined,
    ports_to_protect: portsToProtect,
    do_not_track: Boolean(fingerprint.do_not_track),
    rotate_on_launch: rotate,
  };
}

function newProxyDraft(): ProxyDraft {
  return {
    name: '',
    type: 'socks5',
    host: '',
    port: '',
    username: '',
    password: '',
  };
}

function draftFromProxy(proxy: ArgusProxy): ProxyDraft {
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

function newBookmarkDraft(): BookmarkDraft {
  return {
    title: '',
    url: '',
    icon: '',
  };
}

function draftFromBookmark(bookmark: SharedBookmark): BookmarkDraft {
  return {
    originalUrl: bookmark.url,
    title: bookmark.title || '',
    url: bookmark.url || '',
    icon: bookmark.icon || '',
  };
}

function LoadingState({label, detail, failed = false, onRetry}: {
  label: string;
  detail: string;
  failed?: boolean;
  onRetry?: () => void;
}) {
  return (
    <section className="loading-state">
      {!failed && <div className="spinner" aria-hidden="true" />}
      <h1>{label}</h1>
      <p>{detail}</p>
      {failed && onRetry && <button type="button" onClick={onRetry}>Retry</button>}
    </section>
  );
}

function PaginationBar({page, totalPages, total, pageSize, onPage, onPageSize, extra}: {
  page: number;
  totalPages: number;
  total: number;
  pageSize: number;
  onPage: (page: number) => void;
  onPageSize: (size: number) => void;
  // Optional caller-specific content (e.g. the Trash filter toggle on the
  // Profiles tab) rendered in the same row, before the range text.
  extra?: React.ReactNode;
}) {
  if (total === 0) {
    return null;
  }
  const start = page * pageSize + 1;
  const end = Math.min(total, (page + 1) * pageSize);
  return (
    <section className="pagination-bar">
      {extra}
      <span className="pagination-range">{start}-{end} of {total}</span>
      <div className="pagination-controls">
        <select value={pageSize} onChange={(event) => onPageSize(Number(event.target.value))}>
          {pageSizeOptions.map((size) => <option key={size} value={size}>{size} / page</option>)}
        </select>
        <button className="ghost" disabled={page <= 0} onClick={() => onPage(page - 1)}>Prev</button>
        <span className="pagination-page">Page {page + 1} of {totalPages}</span>
        <button className="ghost" disabled={page >= totalPages - 1} onClick={() => onPage(page + 1)}>Next</button>
      </div>
    </section>
  );
}

function updateStatusLabel(state: UpdateState | null) {
  if (!state) {
    return 'Checking updater';
  }
  if (state.status === 'disabled') {
    return 'Packaged builds only';
  }
  if (state.status === 'checking') {
    return 'Checking for updates';
  }
  if (state.status === 'available') {
    return `Version ${state.updateInfo?.version || 'available'} ready`;
  }
  if (state.status === 'downloading') {
    return `Downloading ${Math.round(state.progress?.percent || 0)}%`;
  }
  if (state.status === 'downloaded') {
    return `Version ${state.updateInfo?.version || ''} downloaded`;
  }
  if (state.status === 'not-available') {
    return 'Up to date';
  }
  if (state.status === 'error') {
    return state.error || 'Update check failed';
  }
  return 'Ready to check';
}

// Google's mark, inline. Lucide has no brand icons and their guidelines require
// the official four-colour G on a sign-in button.
function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.34A9 9 0 0 0 9 18z" />
      <path fill="#FBBC05" d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.94H.96a9 9 0 0 0 0 8.12l3-2.34z" />
      <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58A9 9 0 0 0 .96 4.94l3 2.34C4.68 5.16 6.66 3.58 9 3.58z" />
    </svg>
  );
}

function App() {
  // Which tenant we are looking at. Every src/db call below takes this id
  // explicitly; OrgProvider resolves it from the user's org_members rows and
  // owns the auth subscription.
  const org = useOrg();
  const orgId = org.orgId;
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [signedInEmail, setSignedInEmail] = useState('');
  // Sign-in gets its own error/busy state rather than reusing `message`: that
  // one is the app-wide toast and self-clears after 5s (see below), which on a
  // login form means a wrong-password error silently disappears mid-read.
  const [signInError, setSignInError] = useState('');
  const [signInBusy, setSignInBusy] = useState(false);
  const [message, setMessage] = useState('');
  // Auto-dismiss the floating status-toast after a few seconds -- as an
  // inline footer this never needed a timer, but a floating corner banner
  // that never clears would sit there forever after the last action.
  useEffect(() => {
    if (!message) {
      return;
    }
    const timer = setTimeout(() => setMessage(''), 5000);
    return () => clearTimeout(timer);
  }, [message]);
  const [errorDialog, setErrorDialog] = useState<{title: string; detail: string} | null>(null);
  const {run: runAsyncAction, isPending: isActionPending} = useAsyncAction();
  // Tracks which update version the user has dismissed the corner toast for,
  // so closing it doesn't hide it forever -- a later, different version still
  // prompts. Previously an available/downloaded update only ever showed up as
  // a one-line status buried in Settings, so it was easy to sit on an old,
  // unpatched build indefinitely without ever knowing an update existed.
  const [updateToastDismissedVersion, setUpdateToastDismissedVersion] = useState('');
  const [appBooting, setAppBooting] = useState(true);
  const [cloudLoading, setCloudLoading] = useState(false);
  const [cloudState, setCloudState] = useState<CloudState>(defaultState);
  const [webstoreLinkInput, setWebstoreLinkInput] = useState('');
  const [webstoreNameInput, setWebstoreNameInput] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedFolderId, setSelectedFolderId] = useState('');
  const [profileSearch, setProfileSearch] = useState('');
  const [profileStatusFilter, setProfileStatusFilter] = useState('');
  const [profilePageSize, setProfilePageSize] = useState(25);
  const [profilePage, setProfilePage] = useState(0);
  const [proxySearch, setProxySearch] = useState('');
  const [proxyAssignedFilter, setProxyAssignedFilter] = useState<'' | 'assigned' | 'unassigned'>('');
  const [proxyPageSize, setProxyPageSize] = useState(25);
  const [proxyPage, setProxyPage] = useState(0);
  const [importFile, setImportFile] = useState<{path: string; rows: Record<string, string>[]} | null>(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>('profiles');
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [newKeyName, setNewKeyName] = useState('');
  const [revealedKey, setRevealedKey] = useState<{name: string; token: string} | null>(null);
  const [oauthRequest, setOauthRequest] = useState<{requestId: string; clientName: string; requestedScope: string} | null>(null);
  const [oauthApprovalFolder, setOauthApprovalFolder] = useState('');
  const [integrationStatus, setIntegrationStatus] = useState<Partial<Record<IntegrationId, {ok: boolean; message: string}>>>({});
  const [integrationToken, setIntegrationToken] = useState<Partial<Record<IntegrationId, string>>>({});
  const [copiedEndpoint, setCopiedEndpoint] = useState('');
  const [profileDraft, setProfileDraft] = useState<ProfileDraft | null>(null);
  const [proxyDraft, setProxyDraft] = useState<ProxyDraft | null>(null);
  const [proxyDraftSource, setProxyDraftSource] = useState<'profile' | null>(null);
  const [bookmarkDraft, setBookmarkDraft] = useState<BookmarkDraft | null>(null);
  const [folderDraft, setFolderDraft] = useState<FolderDraft | null>(null);
  const [statusDraft, setStatusDraft] = useState<StatusDraft | null>(null);
  const [fingerprintEditorOpen, setFingerprintEditorOpen] = useState(false);
  const [proxyPickerFocused, setProxyPickerFocused] = useState(false);
  const [checkingProxyId, setCheckingProxyId] = useState('');
  const [selectedProxyIds, setSelectedProxyIds] = useState<Set<string>>(new Set());
  const [selectedProfileIds, setSelectedProfileIds] = useState<Set<string>>(new Set());
  const [proxyDeleteRequest, setProxyDeleteRequest] = useState<{proxyIds: string[]; label: string; affectedProfiles: number} | null>(null);
  const [proxyDeleteAck, setProxyDeleteAck] = useState(false);
  const [profileDeleteRequest, setProfileDeleteRequest] = useState<{profileIds: string[]; label: string; exclusiveProxyIds: string[]} | null>(null);
  const [profileDeleteRemoveProxy, setProfileDeleteRemoveProxy] = useState(false);
  const [updateState, setUpdateState] = useState<UpdateState | null>(null);
  const [resourceState, setResourceState] = useState<ResourceState | null>(null);
  const [apiState, setApiState] = useState<ApiState | null>(null);
  const [updateBusy, setUpdateBusy] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [changelogOpen, setChangelogOpen] = useState(false);
  const [cookiePickerOpen, setCookiePickerOpen] = useState(false);
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [extensionAddOpen, setExtensionAddOpen] = useState(false);
  const proxyChecksInFlight = useRef(new Set<string>());
  const proxyChecksAttempted = useRef(new Set<string>());

  const selectedProfile = useMemo(
      () => cloudState.profiles.find((profile) => profile.id === selectedId) || null,
      [cloudState.profiles, selectedId],
  );
  const profileStatusOptions = useMemo(
      () => statusList(
          baseProfileStatuses,
          cloudState.custom_statuses,
          cloudState.profiles.map((profile) => profile.status)),
      [cloudState.custom_statuses, cloudState.profiles],
  );

  // Signed-in identity now comes from OrgProvider's onAuthStateChange
  // subscription instead of a one-shot getUser() at boot, so a session that
  // expires or is signed out in another window is noticed here too.
  useEffect(() => {
    setSignedInEmail(org.email);
  }, [org.email]);

  useEffect(() => {
    if (org.ready) {
      setAppBooting(false);
    }
  }, [org.ready]);

  useEffect(() => {
    if (org.error) {
      setMessage(org.error);
    }
  }, [org.error]);

  // Reload whenever the active organization changes. Everything keyed by an id
  // has to be dropped first: a profile id from org A is also a real directory
  // under E:\ArgysProfiles, so a leaked selection would launch the wrong
  // firm's data.
  useEffect(() => {
    setCloudState(defaultState);
    setSelectedId(null);
    setSelectedFolderId('');
    setSelectedProfileIds(new Set());
    setSelectedProxyIds(new Set());
    setProfileDraft(null);
    setProxyDraft(null);
    setFolderDraft(null);
    setBookmarkDraft(null);
    setStatusDraft(null);
    setImportFile(null);
    setImportResult(null);
    proxyChecksAttempted.current.clear();
    proxyChecksInFlight.current.clear();
    if (!orgId) {
      return;
    }
    void loadCloudState(orgId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId]);

  // A second worker's changes only reach this machine when we ask for them.
  // Window focus is the cheapest honest trigger: it is exactly the moment the
  // user comes back to the launcher, and eight small selects are far less
  // traffic than a poll. Throttled so alt-tabbing does not hammer the API.
  const lastRefreshRef = useRef(0);
  useEffect(() => {
    if (!orgId) {
      return;
    }
    const refresh = () => {
      if (document.visibilityState === 'hidden') {
        return;
      }
      const now = Date.now();
      if (now - lastRefreshRef.current < 10000) {
        return;
      }
      lastRefreshRef.current = now;
      void loadCloudState(orgId, {quiet: true});
    };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId]);

  // API keys are per-install, not per-user, and named/scoped rather than a
  // single shared secret -- they're whatever main.cjs's AUTOMATION_KEYS_PATH
  // holds. They don't change on sign-in/out.
  async function refreshApiKeys() {
    const keys = await native?.listApiKeys?.();
    if (keys) {
      setApiKeys(keys);
    }
  }

  useEffect(() => {
    void refreshApiKeys();
  }, []);

  async function createApiKey() {
    if (!native?.createApiKey) {
      return;
    }
    const created = await native.createApiKey(newKeyName || 'Unnamed key', null);
    setRevealedKey({name: created.name, token: created.token});
    setNewKeyName('');
    await refreshApiKeys();
  }

  async function revokeApiKey(id: string) {
    await native?.revokeApiKey?.(id);
    await refreshApiKeys();
  }

  // One click, no modal: create the key (full access -- there's no scope
  // picker in this flow) and immediately either write the target tool's
  // config directly (claude-code/codex) or, for Hive, reveal the token
  // inline right on the card since there's no local config file of Hive's
  // for Anty to write to.
  async function connectIntegrationOneClick(integrationId: IntegrationId) {
    if (!native?.createApiKey) {
      return;
    }
    const integration = INTEGRATIONS.find((item) => item.id === integrationId);
    if (!integration) {
      return;
    }
    const created = await native.createApiKey(integration.name, null);
    await refreshApiKeys();
    if (integrationId === 'hive') {
      setIntegrationToken((prev) => ({...prev, [integrationId]: created.token}));
      setIntegrationStatus((prev) => ({
        ...prev,
        [integrationId]: {ok: true, message: 'Copy this into argus-hive-bridge/.env as ARGYS_API_TOKEN -- shown once.'},
      }));
      return;
    }
    if (!native.applyIntegrationConfig) {
      return;
    }
    const result = await native.applyIntegrationConfig(integrationId, BRIDGE_PATH, created.token, API_BASE_URL);
    setIntegrationStatus((prev) => ({
      ...prev,
      [integrationId]: result.ok ?
        {ok: true, message: `Connected -- restart ${integration.name} to use it.`} :
        {ok: false, message: result.error || 'Failed to write config'},
    }));
  }

  useEffect(() => {
    let cancelled = false;
    void native?.getUpdateStatus?.().then((state) => {
      if (!cancelled) {
        setUpdateState(state);
      }
    });
    const unsubscribe = native?.onUpdateState?.((state) => {
      setUpdateState(state);
    });
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void native?.getResourceStatus?.().then((state) => {
      if (!cancelled) {
        setResourceState(state);
      }
    });
    const unsubscribe = native?.onResourceState?.((state) => {
      setResourceState(state);
    });
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, []);

  useEffect(() => {
    if (resourceState?.browserStatus === 'downloading') {
      const percent = resourceState.progress?.percent ? ` ${resourceState.progress.percent}%` : '';
      setMessage(`Downloading Argus Browser${percent}`);
    } else if (resourceState?.browserStatus === 'installing') {
      setMessage('Installing Argus Browser');
    } else if (resourceState?.browserStatus === 'ready') {
      setMessage((current) =>
        current.startsWith('Downloading Argus Browser') || current === 'Installing Argus Browser' ?
          '' :
          current);
    } else if (resourceState?.browserStatus === 'error') {
      setMessage(resourceState.error || 'Failed to download Argus Browser');
    }
  }, [resourceState]);

  useEffect(() => {
    let cancelled = false;
    void native?.getApiStatus?.().then((state) => {
      if (!cancelled) {
        setApiState(state);
      }
    });
    const unsubscribe = native?.onApiState?.((state) => {
      setApiState(state);
    });
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, []);

  useEffect(() => {
    if (cloudLoading || !signedInEmail || !native?.checkProxy) {
      return;
    }
    const proxiesToCheck = cloudState.proxies.filter((proxy) =>
      proxy.host &&
      proxy.port &&
      (!proxy.checked_at || proxy.check_error) &&
      !proxyChecksAttempted.current.has(proxy.id) &&
      !proxyChecksInFlight.current.has(proxy.id));
    if (proxiesToCheck.length === 0) {
      return;
    }
    let cancelled = false;
    for (const proxy of proxiesToCheck) {
      proxyChecksInFlight.current.add(proxy.id);
      proxyChecksAttempted.current.add(proxy.id);
    }
    void (async () => {
      // Each check writes only its own proxy's six result columns. The manual
      // nextState threading this loop used to need is gone with the whole-blob
      // write it existed to work around.
      for (const proxy of proxiesToCheck) {
        if (cancelled) {
          break;
        }
        setCheckingProxyId(proxy.id);
        try {
          const result = await native.checkProxy?.(proxy);
          if (!result) {
            continue;
          }
          const checkedProxy: ArgusProxy = {
            ...proxy,
            country: result.country,
            country_code: result.countryCode,
            egress_ip: result.ip,
            ping_ms: result.pingMs,
            checked_at: new Date().toISOString(),
            check_error: result.ok ? undefined : result.error || 'Proxy check failed',
          };
          await recordProxyCheck(checkedProxy);
        } catch (error) {
          const checkedProxy: ArgusProxy = {
            ...proxy,
            checked_at: new Date().toISOString(),
            check_error: error instanceof Error ? error.message : String(error),
          };
          await recordProxyCheck(checkedProxy);
        } finally {
          proxyChecksInFlight.current.delete(proxy.id);
          setCheckingProxyId('');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [cloudLoading, signedInEmail, cloudState.proxies]);

  // Local automation API listener: POST http://127.0.0.1:39219/v1/cookies/
  // bulk-match (electron/main.cjs) forwards requests here so they run against
  // the signed-in cloud state via the same matching logic the "Import
  // cookies" button uses, then reports the result back for the HTTP response.
  useEffect(() => {
    const onRequest = native?.onBulkMatchCookiesRequest;
    const sendResult = native?.sendBulkMatchCookiesResult;
    if (!onRequest || !sendResult) {
      return;
    }
    return onRequest(async ({requestId, folderPath, profileIds}) => {
      try {
        const result = await matchCookiesToProfiles(folderPath, profileIds);
        sendResult(requestId, result);
      } catch (error) {
        sendResult(requestId, undefined, error instanceof Error ? error.message : String(error));
      }
    });
  }, [cloudState]);

  // Argys Cookie Manager extensions can push decrypted local browser cookies
  // over the loopback automation API. Store that snapshot as the profile's
  // cloud cookie-import source so other machines and later launches seed it.
  useEffect(() => {
    const onRequest = native?.onPushLocalCookiesRequest;
    const sendResult = native?.sendPushLocalCookiesResult;
    if (!onRequest || !sendResult) {
      return;
    }
    return onRequest(async ({requestId, profileId, profileName, cookies}) => {
      try {
        const profile = cloudState.profiles.find((item) => item.id === profileId) ||
          cloudState.profiles.find((item) => comparable(item.name) === comparable(profileName));
        if (!profile) {
          sendResult(requestId, {matched: false, count: 0});
          return;
        }
        const safeName = (profile.name || profileId).replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '') || profileId;
        const raw = JSON.stringify({
          exportedAt: new Date().toISOString(),
          scope: 'all',
          source: 'local-profile',
          profileId,
          cookies,
        }, null, 2);
        const selection: CookieFileSelection = {
          path: `local-profile:${profileId}`,
          name: `argys-local-cookies-${safeName}.json`,
          count: cookies.length,
          base64: btoa(unescape(encodeURIComponent(raw))),
        };
        const cloudCookie = await cloudCookieFromSelection(profile.id, selection);
        const ok = await withDb((activeOrgId) =>
          db.profiles.update(activeOrgId, profile.id, cloudCookie));
        if (!ok) {
          sendResult(requestId, undefined, 'Failed to save to cloud state.');
          return;
        }
        patchProfiles((list) => list.map((item) =>
          item.id === profile.id ? {...item, ...cloudCookie} : item));
        sendResult(requestId, {matched: true, count: cookies.length});
        setMessage(`Migrated ${cookies.length} local cookies for ${profile.name}`);
      } catch (error) {
        sendResult(requestId, undefined, error instanceof Error ? error.message : String(error));
      }
    });
  }, [cloudState]);

  useEffect(() => {
    const onRequest = native?.onReimportProxiesRequest;
    const sendResult = native?.sendReimportProxiesResult;
    if (!onRequest || !sendResult) {
      return;
    }
    return onRequest(async ({requestId, proxies: rows}) => {
      try {
        let updated = 0;
        let created = 0;
        const proxies = [...cloudState.proxies];
        // The rows this run actually created or changed, so untouched proxies
        // are not rewritten.
        const touched: ArgusProxy[] = [];
        const keyFor = (type: string, host: string, port: number) =>
          `${type.toLowerCase()}|${host.toLowerCase()}|${port}`;
        const indexByKey = new Map<string, number>();
        proxies.forEach((proxy, index) => {
          indexByKey.set(keyFor(proxy.type || 'http', proxy.host, proxy.port), index);
        });
        for (const row of rows) {
          const host = String(row.ip || row.host || '').trim();
          const socksPort = Number(row.port_socks5 || row.socks_port || 0);
          const httpPort = Number(row.port_http || row.http_port || row.port || 0);
          const type: ArgusProxy['type'] = socksPort ? 'socks5' : 'http';
          const port = type === 'socks5' ? socksPort : httpPort;
          if (!host || !Number.isInteger(port) || port <= 0 || port > 65535) {
            continue;
          }
          const username = String(row.username || '').trim();
          const password = String(row.password || '');
          const country = String(row.country || '').trim();
          const key = keyFor(type, host, port);
          const existingIndex = indexByKey.get(key);
          const nextProxy: ArgusProxy = {
            ...(existingIndex == null ? {} : proxies[existingIndex]),
            id: existingIndex == null ?
              String(row.id || globalThis.crypto?.randomUUID?.() || `${Date.now()}-${created}`) :
              proxies[existingIndex].id,
            name: existingIndex == null ?
              (country ? `${country.toUpperCase()} proxy ${host}` : `${host}:${port}`) :
              proxies[existingIndex].name,
            type,
            host,
            port,
            username: username || undefined,
            password: password || undefined,
            country: country || (existingIndex == null ? undefined : proxies[existingIndex].country),
            country_code: country || (existingIndex == null ? undefined : proxies[existingIndex].country_code),
            checked_at: undefined,
            check_error: undefined,
            egress_ip: undefined,
            ping_ms: undefined,
          };
          if (existingIndex == null) {
            indexByKey.set(key, proxies.length);
            proxies.push(nextProxy);
            created++;
          } else {
            proxies[existingIndex] = nextProxy;
            updated++;
          }
          touched.push(nextProxy);
        }
        // repairProxyAssignments only ever rewrites proxy_id/proxy_mode, and it
        // returns the same object for a profile it did not change -- so an
        // identity comparison is enough to find the profiles that need writing.
        const repairedProfiles = repairProxyAssignments({...cloudState, proxies}).state.profiles;
        const ok = await withDb(async (activeOrgId) => {
          for (const proxy of touched) {
            await db.proxies.upsert(activeOrgId, proxy);
          }
          for (let index = 0; index < repairedProfiles.length; index++) {
            const profile = repairedProfiles[index];
            if (profile === cloudState.profiles[index]) {
              continue;
            }
            await db.profiles.update(activeOrgId, profile.id,
                {proxy_id: profile.proxy_id, proxy_mode: profile.proxy_mode});
          }
        });
        if (!ok) {
          sendResult(requestId, undefined, 'Failed to save to cloud state.');
          return;
        }
        setCloudState((current) => ({...current, proxies, profiles: repairedProfiles}));
        sendResult(requestId, {updated, created, total: rows.length});
        setMessage(`Reimported proxies: ${updated} updated, ${created} created`);
      } catch (error) {
        sendResult(requestId, undefined, error instanceof Error ? error.message : String(error));
      }
    });
  }, [cloudState]);

  useEffect(() => {
    const onRequest = native?.onAssignProfileProxyRequest;
    const sendResult = native?.sendAssignProfileProxyResult;
    if (!onRequest || !sendResult) {
      return;
    }
    return onRequest(async ({requestId, profileId, proxyId, proxyHost, proxyPort}) => {
      try {
        const proxy = cloudState.proxies.find((item) => proxyId && item.id === proxyId) ||
          cloudState.proxies.find((item) =>
            proxyHost &&
            item.host === proxyHost &&
            (!proxyPort || item.port === proxyPort));
        if (!proxy) {
          sendResult(requestId, {matched: false, profileId});
          return;
        }
        const ok = await withDb((activeOrgId) => db.profiles.update(activeOrgId, profileId,
            {proxy_id: proxy.id, proxy_mode: 'assigned'}));
        if (!ok) {
          sendResult(requestId, undefined, 'Failed to save to cloud state.');
          return;
        }
        patchProfiles((list) => list.map((profile) =>
          profile.id === profileId ? {
            ...profile,
            proxy_id: proxy.id,
            proxy_mode: 'assigned' as const,
          } : profile));
        sendResult(requestId, {matched: true, profileId, proxyId: proxy.id});
        setMessage(`Assigned ${proxy.host}:${proxy.port} to ${profileId}`);
      } catch (error) {
        sendResult(requestId, undefined, error instanceof Error ? error.message : String(error));
      }
    });
  }, [cloudState]);

  useEffect(() => {
    const onRequest = native?.onGetProfileRequest;
    const sendResult = native?.sendGetProfileResult;
    if (!onRequest || !sendResult) {
      return;
    }
    return onRequest(({requestId, profileId, allowedFolders}) => {
      const profile = cloudState.profiles.find((item) => item.id === profileId && !item.deleted_at);
      if (!profile || (allowedFolders && !allowedFolders.includes(profile.folder_id || ''))) {
        sendResult(requestId, {profile: null});
        return;
      }
      sendResult(requestId, {profile});
    });
  }, [cloudState]);

  useEffect(() => {
    const onRequest = native?.onListProxiesRequest;
    const sendResult = native?.sendListProxiesResult;
    if (!onRequest || !sendResult) {
      return;
    }
    return onRequest(({requestId}) => {
      const proxies = cloudState.proxies.map((proxy) => ({
        ...proxy,
        assignedProfileIds: cloudState.profiles
          .filter((profile) => !profile.deleted_at && profile.proxy_id === proxy.id)
          .map((profile) => profile.id),
      }));
      sendResult(requestId, {proxies});
    });
  }, [cloudState]);

  useEffect(() => {
    const onRequest = native?.onCreateProxyRequest;
    const sendResult = native?.sendCreateProxyResult;
    if (!onRequest || !sendResult) {
      return;
    }
    return onRequest(async ({requestId, name, type, host, port, username, password}) => {
      try {
        const proxy: ArgusProxy = {
          id: globalThis.crypto?.randomUUID?.() || `${Date.now()}`,
          name: name || `${host}:${port}`,
          type,
          host,
          port,
          username,
          password,
        };
        const ok = await withDb((activeOrgId) => db.proxies.upsert(activeOrgId, proxy));
        if (!ok) {
          sendResult(requestId, undefined, 'Failed to save to cloud state.');
          return;
        }
        patchProxies((list) => [...list, proxy]);
        sendResult(requestId, {proxyId: proxy.id});
        setMessage(`Created proxy ${proxy.name}`);
      } catch (error) {
        sendResult(requestId, undefined, error instanceof Error ? error.message : String(error));
      }
    });
  }, [cloudState]);

  useEffect(() => {
    const onRequest = native?.onUpdateProxyRequest;
    const sendResult = native?.sendUpdateProxyResult;
    if (!onRequest || !sendResult) {
      return;
    }
    return onRequest(async ({requestId, proxyId, fields}) => {
      try {
        const existing = cloudState.proxies.find((item) => item.id === proxyId);
        if (!existing) {
          sendResult(requestId, {matched: false});
          return;
        }
        const updated = {...existing, ...fields};
        const ok = await withDb((activeOrgId) => db.proxies.upsert(activeOrgId, updated));
        if (!ok) {
          sendResult(requestId, undefined, 'Failed to save to cloud state.');
          return;
        }
        patchProxies((list) => list.map((proxy) => proxy.id === proxyId ? updated : proxy));
        sendResult(requestId, {matched: true});
        setMessage(`Updated proxy ${proxyId}`);
      } catch (error) {
        sendResult(requestId, undefined, error instanceof Error ? error.message : String(error));
      }
    });
  }, [cloudState]);

  useEffect(() => {
    const onRequest = native?.onDeleteProxyRequest;
    const sendResult = native?.sendDeleteProxyResult;
    if (!onRequest || !sendResult) {
      return;
    }
    return onRequest(async ({requestId, proxyId}) => {
      try {
        const exists = cloudState.proxies.some((item) => item.id === proxyId);
        if (!exists) {
          sendResult(requestId, {deleted: false, unassignedProfileIds: []});
          return;
        }
        const unassignedProfileIds = cloudState.profiles
            .filter((profile) => profile.proxy_id === proxyId)
            .map((profile) => profile.id);
        // profiles.proxy_id is ON DELETE SET NULL, so the assigned profiles are
        // cleared by the same statement; the patch below only mirrors it.
        const ok = await withDb((activeOrgId) => db.proxies.remove(activeOrgId, [proxyId]));
        if (!ok) {
          sendResult(requestId, undefined, 'Failed to save to cloud state.');
          return;
        }
        patchProxies((list) => list.filter((proxy) => proxy.id !== proxyId));
        patchProfiles((list) => list.map((profile) =>
          profile.proxy_id === proxyId ? {...profile, proxy_id: null} : profile));
        sendResult(requestId, {deleted: true, unassignedProfileIds});
        setMessage(`Deleted proxy ${proxyId}${unassignedProfileIds.length ? ` (unassigned from ${unassignedProfileIds.length} profile(s))` : ''}`);
      } catch (error) {
        sendResult(requestId, undefined, error instanceof Error ? error.message : String(error));
      }
    });
  }, [cloudState]);

  useEffect(() => {
    const onRequest = native?.onUpdateProfileRequest;
    const sendResult = native?.sendUpdateProfileResult;
    if (!onRequest || !sendResult) {
      return;
    }
    return onRequest(async ({requestId, profileId, fields}) => {
      try {
        const exists = cloudState.profiles.some((item) => item.id === profileId);
        if (!exists) {
          sendResult(requestId, {matched: false, profileId});
          return;
        }
        const ok = await withDb((activeOrgId) => db.profiles.update(activeOrgId, profileId, fields));
        if (!ok) {
          sendResult(requestId, undefined, 'Failed to save to cloud state.');
          return;
        }
        patchProfiles((list) => list.map((profile) =>
          profile.id === profileId ? {...profile, ...fields} : profile));
        sendResult(requestId, {matched: true, profileId});
        setMessage(`Updated ${profileId}`);
      } catch (error) {
        sendResult(requestId, undefined, error instanceof Error ? error.message : String(error));
      }
    });
  }, [cloudState]);

  useEffect(() => {
    const onRequest = native?.onDeleteProfileRequest;
    const sendResult = native?.sendDeleteProfileResult;
    if (!onRequest || !sendResult) {
      return;
    }
    return onRequest(async ({requestId, profileId, permanent, allowedFolders}) => {
      try {
        if (!orgId) {
          sendResult(requestId, undefined, 'No organization is selected yet.');
          return;
        }
        // Still re-read before the folder check: allowedFolders is an
        // authorization gate, so it has to see where the profile lives now
        // rather than trusting this window's render cache. The delete itself
        // is one statement against one id and needs nothing fresh.
        const latestProfiles = await db.profiles.list(orgId);
        const target = latestProfiles.find((item) => item.id === profileId);
        if (!target || (allowedFolders && !allowedFolders.includes(target.folder_id || ''))) {
          sendResult(requestId, {deleted: false, permanent});
          return;
        }
        const ok = await withDb((activeOrgId) => permanent ?
          db.profiles.purge(activeOrgId, [profileId]) :
          db.profiles.softDelete(activeOrgId, [profileId]));
        if (!ok) {
          sendResult(requestId, undefined, 'Failed to save to cloud state.');
          return;
        }
        const profiles = permanent ?
          latestProfiles.filter((item) => item.id !== profileId) :
          latestProfiles.map((item) =>
            item.id === profileId ? {...item, deleted_at: new Date().toISOString()} : item);
        patchProfiles(() => profiles);
        if (selectedId === profileId) {
          setSelectedId(profiles.find((item) => !item.deleted_at)?.id || null);
        }
        sendResult(requestId, {deleted: true, permanent});
        setMessage(permanent ? `${profileId} permanently deleted` : `${profileId} moved to Trash`);
      } catch (error) {
        sendResult(requestId, undefined, error instanceof Error ? error.message : String(error));
      }
    });
  }, [cloudState]);

  useEffect(() => {
    const onRequest = native?.onUpdateFingerprintRequest;
    const sendResult = native?.sendUpdateFingerprintResult;
    if (!onRequest || !sendResult) {
      return;
    }
    return onRequest(async ({requestId, profileId, fingerprint}) => {
      try {
        const target = cloudState.profiles.find((item) => item.id === profileId);
        if (!target) {
          sendResult(requestId, {matched: false, profileId});
          return;
        }
        const merged = {...target.fingerprint, ...fingerprint};
        const ok = await withDb((activeOrgId) =>
          db.profiles.update(activeOrgId, profileId, {fingerprint: merged}));
        if (!ok) {
          sendResult(requestId, undefined, 'Failed to save to cloud state.');
          return;
        }
        patchProfiles((list) => list.map((profile) =>
          profile.id === profileId ? {...profile, fingerprint: merged} : profile));
        sendResult(requestId, {matched: true, profileId});
        setMessage(`Updated fingerprint for ${profileId}`);
      } catch (error) {
        sendResult(requestId, undefined, error instanceof Error ? error.message : String(error));
      }
    });
  }, [cloudState]);

  useEffect(() => {
    const onRequest = native?.onListProfilesRequest;
    const sendResult = native?.sendListProfilesResult;
    if (!onRequest || !sendResult) {
      return;
    }
    return onRequest(({requestId, folder, allowedFolders}) => {
      const profiles = cloudState.profiles
          .filter((profile) => !profile.deleted_at)
          .filter((profile) => !folder || profile.folder_id === folder)
          .filter((profile) => !allowedFolders || allowedFolders.includes(profile.folder_id || ''))
          .map((profile) => ({id: profile.id, name: profile.name}));
      sendResult(requestId, {profiles});
    });
  }, [cloudState]);

  useEffect(() => {
    const onRequest = native?.onLaunchAutomationRequest;
    const sendResult = native?.sendLaunchAutomationResult;
    const launchProfile = native?.launchProfile;
    if (!onRequest || !sendResult || !launchProfile) {
      return;
    }
    return onRequest(async ({requestId, profileId, cdpPort, allowedFolders}) => {
      try {
        const profile = cloudState.profiles.find((item) => item.id === profileId && !item.deleted_at);
        if (!profile) {
          sendResult(requestId, {ok: false, error: 'Profile not found'});
          return;
        }
        if (allowedFolders && !allowedFolders.includes(profile.folder_id || '')) {
          sendResult(requestId, {ok: false, error: 'This key is not scoped to that profile\'s folder'});
          return;
        }
        const commandLineSwitches = [
          profile.command_line_switches || '',
          fingerprintSwitches(profile),
        ].filter(Boolean).join('\n');
        const proxyMode = profile.proxy_mode || 'assigned';
        let selectedProxy: ArgusProxy | null = null;
        if (proxyMode === 'assigned') {
          selectedProxy = proxyFor(profile);
          if (!selectedProxy?.host || !selectedProxy.port) {
            sendResult(requestId, {ok: false, error: `Proxy for ${profile.name} is invalid`});
            return;
          }
        }
        // spawnProfileUnchecked (main process) is the authoritative proxy
        // gate on every launch regardless -- unlike the manual Launch button,
        // this path skips the interactive pre-check/retry UI (nothing to
        // show it to) and skips fingerprint-rotate-on-launch, since automated
        // QA/monitoring runs want a stable, comparable fingerprint across
        // repeated sweeps rather than a fresh one each time.
        const savedCookie = profile.cookie_mode === 'saved' && profile.cookie_id ?
          cloudState.cookies.find((item) => item.id === profile.cookie_id) :
          null;
        const result = await launchProfile({
          id: profile.id,
          name: profile.name,
          userDataDir: profileDataDir(profile.id),
          proxy: selectedProxy,
          useFreeProxy: proxyMode === 'free_proxy',
          sharedExtensions: cloudState.shared_extensions,
          commandLineSwitches,
          runtimeFingerprint: buildRuntimeFingerprint(profile),
          startUrl: browserStartUrl(profile),
          homeHtml: anonymousHomeHtml(profile, cloudState.shared_bookmarks, selectedProxy),
          cookieImportPath: savedCookie ? null : (profile.cookie_import_path || null),
          cookieImportUrl: savedCookie ? savedCookie.url : (profile.cookie_import_url || null),
          cookieImportName: savedCookie ? savedCookie.name : (profile.cookie_import_name || null),
          enableCookieManager: cloudState.built_in_extensions?.cookie_manager !== false,
          enableSmsActivate: cloudState.built_in_extensions?.sms_activate !== false,
          enableFoxywallFreeProxy: cloudState.built_in_extensions?.foxywall_free_proxy !== false,
        }, [`--remote-debugging-port=${cdpPort}`, '--remote-allow-origins=*']);
        sendResult(requestId, {ok: result.ok, pid: result.pid, error: result.error});
      } catch (error) {
        sendResult(requestId, undefined, error instanceof Error ? error.message : String(error));
      }
    });
  }, [cloudState]);

  useEffect(() => {
    const onRequest = native?.onMonitoringReportRequest;
    const sendResult = native?.sendMonitoringReportResult;
    if (!onRequest || !sendResult) {
      return;
    }
    return onRequest(async ({requestId, runId, profileId, ok, detail, screenshotBase64}) => {
      try {
        if (!supabase) {
          sendResult(requestId, undefined, 'Supabase env is missing in .env');
          return;
        }
        const {data: userData, error: userError} = await supabase.auth.getUser();
        const userId = userData.user?.id;
        if (userError || !userId) {
          sendResult(requestId, undefined, 'Not signed in');
          return;
        }
        const {error} = await supabase.from('argus_monitoring_results').insert({
          user_id: userId,
          run_id: runId,
          profile_id: profileId,
          ok,
          detail: detail || null,
          screenshot_base64: screenshotBase64,
        });
        if (error) {
          sendResult(requestId, undefined, error.message);
          return;
        }
        sendResult(requestId, {ok: true});
      } catch (error) {
        sendResult(requestId, undefined, error instanceof Error ? error.message : String(error));
      }
    });
  }, []);

  useEffect(() => {
    const onRequest = native?.onOAuthAuthorizeRequest;
    if (!onRequest) {
      return;
    }
    return onRequest(({requestId, clientName, requestedScope}) => {
      const requestedFolder = requestedScope.startsWith('folder:') ? requestedScope.slice('folder:'.length) : '';
      setOauthApprovalFolder(requestedFolder);
      setOauthRequest({requestId, clientName, requestedScope});
    });
  }, []);

  async function respondToOAuthRequest(approved: boolean) {
    if (!oauthRequest || !native?.sendOAuthAuthorizeResult) {
      return;
    }
    native.sendOAuthAuthorizeResult(
        oauthRequest.requestId,
        approved,
        approved && oauthApprovalFolder ? [oauthApprovalFolder] : approved ? null : null,
        oauthRequest.clientName,
    );
    setOauthRequest(null);
    if (approved) {
      await refreshApiKeys();
    }
  }

  async function runUpdateAction(action: 'check' | 'download' | 'install') {
    try {
      setUpdateBusy(true);
      if (action === 'check') {
        const state = await native?.checkForUpdates?.();
        if (state) {
          setUpdateState(state);
        }
      } else if (action === 'download') {
        const state = await native?.downloadUpdate?.();
        if (state) {
          setUpdateState(state);
        }
      } else {
        const result = await native?.installUpdate?.();
        if (result && !result.ok) {
          setMessage(result.error || 'Update is not ready to install');
        }
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setUpdateBusy(false);
    }
  }

  // One parallel read per table instead of five sequential selects against one
  // jsonb row. `quiet` suppresses the selection reset and the repair toast so a
  // window-focus refresh does not move the user's cursor or nag them.
  async function loadCloudState(targetOrgId: string, options?: {quiet?: boolean}) {
    const quiet = Boolean(options?.quiet);
    if (!quiet) {
      setCloudLoading(true);
    }
    try {
      const [profiles, proxies, folders, cookies, sharedExtensions, bookmarkRows,
        customStatuses, organization] = await Promise.all([
        db.profiles.list(targetOrgId),
        db.proxies.list(targetOrgId),
        db.folders.list(targetOrgId),
        db.cookieSets.list(targetOrgId),
        db.extensions.list(targetOrgId),
        db.bookmarks.list(targetOrgId),
        db.statuses.list(targetOrgId),
        db.orgs.getOrg(targetOrgId),
      ]);
      const mergedBookmarks = mergeBookmarks(bookmarkRows, socialBookmarks);
      const loaded: CloudState = {
        profiles,
        folders,
        proxies,
        cookies,
        shared_extensions: sharedExtensions,
        shared_bookmarks: mergedBookmarks.bookmarks,
        custom_statuses: customStatuses,
        built_in_extensions: organization?.built_in_extensions,
      };

      // The three self-healing passes below used to rewrite the whole document
      // when any of them changed anything. Each now writes only the rows it
      // actually touched.
      const {state: repairedState, repaired} = repairProxyAssignments(loaded);
      const {state: migratedState, migrated} = migrateLegacyCookieImports(repairedState);

      const purgedIds = await db.profiles.purgeExpired(targetOrgId, trashCutoffIso());
      const purged = purgedIds.length;
      const finalState: CloudState = purged === 0 ?
        migratedState :
        {
          ...migratedState,
          profiles: migratedState.profiles.filter((profile) => !purgedIds.includes(profile.id)),
        };

      if (mergedBookmarks.changed) {
        for (let index = 0; index < mergedBookmarks.bookmarks.length; index++) {
          const bookmark = mergedBookmarks.bookmarks[index];
          if (!bookmarkRows.some((existing) => existing.url === bookmark.url)) {
            await db.bookmarks.create(targetOrgId, {...bookmark, position: index});
          }
        }
      }
      if (repaired > 0) {
        for (const profile of repairedState.profiles) {
          const before = profiles.find((item) => item.id === profile.id);
          if (before && (before.proxy_id !== profile.proxy_id ||
              before.proxy_mode !== profile.proxy_mode)) {
            await db.profiles.update(targetOrgId, profile.id,
                {proxy_id: profile.proxy_id, proxy_mode: profile.proxy_mode});
          }
        }
      }
      if (migrated > 0) {
        for (const cookie of migratedState.cookies) {
          if (!cookies.some((existing) => existing.id === cookie.id)) {
            await db.cookieSets.create(targetOrgId, cookie);
          }
        }
        for (const profile of migratedState.profiles) {
          const before = repairedState.profiles.find((item) => item.id === profile.id);
          if (before && (before.cookie_id !== profile.cookie_id ||
              before.cookie_mode !== profile.cookie_mode)) {
            await db.profiles.update(targetOrgId, profile.id,
                {cookie_id: profile.cookie_id, cookie_mode: profile.cookie_mode});
          }
        }
      }

      setCloudState(finalState);
      if (!quiet) {
        setSelectedId(finalState.profiles.find((profile) => !profile.deleted_at)?.id || null);
      }
      if (!quiet && (repaired > 0 || mergedBookmarks.changed || purged > 0 || migrated > 0)) {
        setMessage(`${repaired ? `Repaired ${repaired} proxy assignments` : ''}${repaired && mergedBookmarks.changed ? ' · ' : ''}${mergedBookmarks.changed ? 'Added social bookmarks' : ''}${purged ? `${repaired || mergedBookmarks.changed ? ' · ' : ''}Purged ${purged} trashed ${purged === 1 ? 'profile' : 'profiles'}` : ''}${migrated ? `${repaired || mergedBookmarks.changed || purged ? ' · ' : ''}Added ${migrated} existing cookie ${migrated === 1 ? 'import' : 'imports'} to the library` : ''}`);
      }
    } catch (error) {
      setMessage(describeDbError(error, 'Could not load your data.'));
    } finally {
      if (!quiet) {
        setCloudLoading(false);
      }
    }
  }

  // Runs targeted db writes and reports failure the way the whole app already
  // expects: message set, false returned, caller bails without a false
  // success toast.
  async function withDb(action: (activeOrgId: string) => Promise<unknown>): Promise<boolean> {
    if (!orgId) {
      setMessage('No organization is selected yet.');
      return false;
    }
    try {
      await action(orgId);
      return true;
    } catch (error) {
      setMessage(describeDbError(error, 'Could not save to the cloud.'));
      return false;
    }
  }

  // cloudState stays the render cache the whole UI reads from; these apply the
  // local half of a write. The updater form matters: several call sites write
  // more than one row in a loop, and reading the closure-captured cloudState
  // between iterations would lose the earlier ones.
  function patchProfiles(fn: (list: ArgusProfile[]) => ArgusProfile[]) {
    setCloudState((current) => ({...current, profiles: fn(current.profiles)}));
  }

  function patchProxies(fn: (list: ArgusProxy[]) => ArgusProxy[]) {
    setCloudState((current) => ({...current, proxies: fn(current.proxies)}));
  }

  function patchFolders(fn: (list: ArgusFolder[]) => ArgusFolder[]) {
    setCloudState((current) => ({...current, folders: fn(current.folders)}));
  }

  function patchCookies(fn: (list: ArgusCookie[]) => ArgusCookie[]) {
    setCloudState((current) => ({...current, cookies: fn(current.cookies)}));
  }

  function patchExtensions(fn: (list: SharedExtension[]) => SharedExtension[]) {
    setCloudState((current) => ({...current, shared_extensions: fn(current.shared_extensions)}));
  }

  function patchBookmarks(fn: (list: SharedBookmark[]) => SharedBookmark[]) {
    setCloudState((current) => ({...current, shared_bookmarks: fn(current.shared_bookmarks)}));
  }

  // Every proxy-check path (background loop, manual re-check, pre-launch check)
  // lands here. The write touches the six last_* columns only, so a check
  // completing while someone edits that proxy's credentials cannot undo the
  // edit. Explicit nulls matter: a proxy that just started working must clear
  // its stored error, and PostgREST drops undefined rather than nulling it.
  async function recordProxyCheck(proxy: ArgusProxy): Promise<boolean> {
    patchProxies((list) => list.map((item) => item.id === proxy.id ? proxy : item));
    return withDb((activeOrgId) => db.proxies.recordCheck(activeOrgId, proxy.id, {
      country: proxy.country,
      country_code: proxy.country_code,
      egress_ip: proxy.egress_ip,
      ping_ms: proxy.ping_ms,
      checked_at: proxy.checked_at,
      check_error: proxy.check_error,
    }));
  }

  async function signIn(event?: React.FormEvent) {
    event?.preventDefault();
    if (signInBusy) {
      return;
    }
    if (!supabase) {
      setSignInError('Supabase env is missing in .env');
      return;
    }
    setSignInBusy(true);
    setSignInError('');
    try {
      // OrgProvider's onAuthStateChange picks the session up from here, resolves
      // the user's organizations (bootstrapping one if they have none) and the
      // orgId effect above loads the data.
      const {error} = await supabase.auth.signInWithPassword({email, password});
      if (error) {
        setSignInError(error.message);
        return;
      }
      setPassword('');
    } finally {
      setSignInBusy(false);
    }
  }

  // Registration and password reset live on the web. Anything opened here goes
  // to the real browser via the main process, which allowlists the host.
  function openAccountPage(pathname: string) {
    void native?.openExternal?.(`${SITE_URL}${pathname}`);
  }

  // Google sign-in, PKCE style (RFC 8252). We ask Supabase for the authorize
  // URL rather than letting it navigate (skipBrowserRedirect), open that in the
  // user's real browser, and Supabase redirects back to argus://auth?code=...
  // once Google approves. The code_verifier that matches this request stays in
  // this renderer's storage and is never sent anywhere, so the code in the deep
  // link is useless to anyone who intercepts it.
  async function signInWithGoogle() {
    if (signInBusy) {
      return;
    }
    if (!supabase) {
      setSignInError('Supabase env is missing in .env');
      return;
    }
    if (!native?.openExternal) {
      setSignInError('Google sign-in needs the desktop app shell. Restart Argus Launcher and try again.');
      return;
    }
    setSignInBusy(true);
    setSignInError('');
    try {
      const {data, error} = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {redirectTo: 'argus://auth', skipBrowserRedirect: true},
      });
      if (error) {
        setSignInError(error.message);
        return;
      }
      if (!data?.url) {
        setSignInError('Could not start Google sign-in.');
        return;
      }
      const opened = await native.openExternal(data.url);
      if (!opened) {
        setSignInError('Could not open your browser to finish signing in.');
        return;
      }
      setSignInError('Finish signing in with Google in your browser…');
    } catch (caught) {
      setSignInError(caught instanceof Error ? caught.message : 'Google sign-in failed.');
    } finally {
      setSignInBusy(false);
    }
  }

  // The other half of the flow: the main process hands us whatever came back
  // through argus://. Exchanging the code establishes the session, and
  // OrgProvider's onAuthStateChange takes it from there (including bootstrapping
  // an org for a brand-new account), so there is nothing else to do here.
  useEffect(() => {
    if (!native?.onDeepLink) {
      return;
    }
    const unsubscribe = native.onDeepLink((payload) => {
      // Action only -- never the payload, which carries an authorization code.
      console.log('[deep-link] renderer received:', payload.action);
      if (payload.action !== 'auth') {
        return;
      }
      if (payload.error) {
        setSignInError(payload.error);
        return;
      }
      if (!payload.code || !supabase) {
        return;
      }
      setSignInBusy(true);
      setSignInError('');
      supabase.auth.exchangeCodeForSession(payload.code)
          .then(({error}) => {
            if (error) {
              console.log('[deep-link] code exchange failed:', error.message);
              setSignInError(error.message);
            }
          })
          .catch((caught: unknown) => {
            setSignInError(caught instanceof Error ? caught.message : 'Could not complete Google sign-in.');
          })
          .finally(() => setSignInBusy(false));
    });
    // Tells the main process we are listening, so a link that arrived during a
    // cold start gets replayed instead of dropped.
    void native.deepLinkReady?.();
    return unsubscribe;
  }, []);

  async function signOut() {
    await supabase?.auth.signOut();
    setCloudState(defaultState);
    setSelectedId(null);
    setSelectedFolderId('');
  }

  function authHeader() {
    return 'Authorization: Bearer <YOUR_API_KEY>';
  }

  function curlFor(endpoint: ApiEndpoint) {
    const lines = [
      `curl -X ${endpoint.method} "${API_BASE_URL}${endpoint.path}"`,
      `  -H "${authHeader()}"`,
      '  -H "Content-Type: application/json"',
    ];
    if (endpoint.body) {
      lines.push(`  -d '${endpoint.body}'`);
    }
    return lines.join(' \\\n');
  }

  function apiExampleScript() {
    return `#!/usr/bin/env node
// Argus Launcher Browser API example.
// Keep Argus Launcher open and signed in while running this script.

const BASE_URL = ${JSON.stringify(API_BASE_URL)};
// Create a key in Settings -> API and paste it here. Keys are only shown
// once, at creation -- Anty never stores or displays the raw value again.
const TOKEN = '<YOUR_API_KEY>';

async function argys(method, path, body) {
  const response = await fetch(\`\${BASE_URL}\${path}\`, {
    method,
    headers: {
      Authorization: \`Bearer \${TOKEN}\`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(\`\${method} \${path} failed: \${response.status} \${text}\`);
  }
  return data;
}

async function main() {
  console.log('Health:', await argys('GET', '/health'));

  const profiles = await argys('GET', '/v1/profiles');
  console.log('Profiles:', profiles);

  const proxy = await argys('POST', '/v1/proxies', {
    name: 'Example US proxy',
    type: 'socks5',
    host: '1.2.3.4',
    port: 1080,
    username: 'user',
    password: 'pass',
  });
  console.log('Created proxy:', proxy);

  const profile = await argys('POST', '/v1/profiles', {
    name: 'API example profile',
    proxyId: proxy.id,
    startUrl: 'https://browserargus.com/',
  });
  console.log('Created profile:', profile);

  console.log('Launch:', await argys('POST', \`/v1/profiles/\${profile.id}/launch\`));

  // Optional cookie import helper. Replace folderPath with the folder that
  // contains exported cookie txt/json files named after profile names.
  // console.log('Cookie match:', await argys('POST', '/v1/cookies/bulk-match', {
  //   folderPath: '/Users/name/Downloads/cookies',
  //   profileIds: [profile.id],
  // }));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
`;
  }

  async function copyCurl(endpoint: ApiEndpoint) {
    await navigator.clipboard.writeText(curlFor(endpoint));
    setCopiedEndpoint(`${endpoint.method} ${endpoint.path}`);
    window.setTimeout(() => setCopiedEndpoint(''), 1800);
  }

  async function downloadApiExample() {
    const content = apiExampleScript();
    const defaultName = `argys-api-example-${Date.now()}.js`;
    if (native?.saveTextFile) {
      const savedPath = await native.saveTextFile(defaultName, content);
      if (savedPath) {
        setMessage(`Saved API example to ${savedPath.split('/').pop()}`);
      }
      return;
    }
    const blob = new Blob([content], {type: 'text/javascript'});
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = defaultName;
    link.click();
    URL.revokeObjectURL(url);
    setMessage('Downloaded API example');
  }

  function proxyFor(profile: ArgusProfile) {
    return matchedProxyForProfile(profile, cloudState.proxies);
  }

  function folderFor(profile: ArgusProfile) {
    return cloudState.folders.find((folder) => folder.id === profile.folder_id) || null;
  }

  function visibleProfiles() {
    const inTrash = selectedFolderId === TRASH_FOLDER_ID;
    const notTrashed = cloudState.profiles.filter((profile) => Boolean(profile.deleted_at) === inTrash);
    const inFolder = selectedFolderId && !inTrash ?
      notTrashed.filter((profile) => profile.folder_id === selectedFolderId) :
      notTrashed;
    const byStatus = profileStatusFilter ?
      inFolder.filter((profile) =>
        (profile.status || 'Ready').toLowerCase() === profileStatusFilter.toLowerCase()) :
      inFolder;
    const query = profileSearch.trim().toLowerCase();
    if (!query) {
      return byStatus;
    }
    return byStatus.filter((profile) =>
      profile.name?.toLowerCase().includes(query) ||
      profile.tags?.some((tag) => tag.toLowerCase().includes(query)));
  }

  function isProxyAssigned(proxy: ArgusProxy) {
    return cloudState.profiles.some((profile) =>
      !profile.deleted_at && comparable(profile.proxy_id) === comparable(proxy.id));
  }

  function visibleProxies() {
    const byAssignment = proxyAssignedFilter ?
      cloudState.proxies.filter((proxy) => isProxyAssigned(proxy) === (proxyAssignedFilter === 'assigned')) :
      cloudState.proxies;
    const query = proxySearch.trim().toLowerCase();
    if (!query) {
      return byAssignment;
    }
    return byAssignment.filter((proxy) =>
      [proxy.name, proxy.host, proxy.country, proxy.country_code, proxy.type]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
          .includes(query));
  }

  async function launch(profile: ArgusProfile) {
    if (!native) {
      setMessage('Native launcher bridge is not available');
      return;
    }
    try {
      let launchProfile = profile;
      if (profile.fingerprint?.rotate_on_launch) {
        const rotated = fingerprintFromDraftPatch(randomFingerprintPatch(profile.fingerprint?.os || ''));
        launchProfile = {...profile, fingerprint: {...profile.fingerprint, ...rotated, rotate_on_launch: true}};
        await withDb((activeOrgId) => db.profiles.update(activeOrgId, profile.id,
            {fingerprint: launchProfile.fingerprint}));
        patchProfiles((list) => list.map((item) =>
          item.id === profile.id ? launchProfile : item));
      }
      const commandLineSwitches = [
        launchProfile.command_line_switches || '',
        fingerprintSwitches(launchProfile),
      ].filter(Boolean).join('\n');
      const proxyMode = launchProfile.proxy_mode || 'assigned';
      let selectedProxy: ArgusProxy | null = null;
      if (proxyMode === 'assigned') {
        selectedProxy = proxyFor(launchProfile);
        if (!selectedProxy?.host || !selectedProxy.port) {
          setMessage('');
          setErrorDialog({
            title: 'Launch blocked',
            detail: `Proxy for ${launchProfile.name} is invalid. Fix host and port before launch.`,
          });
          return;
        }
        if (!selectedProxy.checked_at || selectedProxy.check_error) {
          if (!native.checkProxy) {
            setMessage('');
            setErrorDialog({
              title: 'Launch blocked',
              detail: 'Native proxy checker is not available. Restart Argus Launcher and try again.',
            });
            return;
          }
          setMessage(`Checking proxy for ${launchProfile.name}`);
          setCheckingProxyId(selectedProxy.id);
          try {
            const result = await native.checkProxy(selectedProxy);
            const checkedProxy: ArgusProxy = {
              ...selectedProxy,
              country: result.country,
              country_code: result.countryCode,
              egress_ip: result.ip,
              ping_ms: result.pingMs,
              checked_at: new Date().toISOString(),
              check_error: result.ok ? undefined : result.error || 'Proxy check failed',
            };
            selectedProxy = checkedProxy;
            // Only the proxy's check result is new here -- launchProfile was
            // already written above if its fingerprint rotated.
            await recordProxyCheck(checkedProxy);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            setMessage('');
            setErrorDialog({
              title: 'Launch blocked',
              detail: `Proxy for ${launchProfile.name} failed its check: ${message}`,
            });
            return;
          } finally {
            setCheckingProxyId('');
          }
          if (selectedProxy.check_error) {
            setMessage('');
            setErrorDialog({
              title: 'Launch blocked',
              detail: `Proxy for ${launchProfile.name} failed its check: ${selectedProxy.check_error}`,
            });
            return;
          }
        }
      }
      // spawnProfileUnchecked (main process) re-checks the assigned proxy on
      // every launch regardless of the pre-check above -- it's the
      // authoritative gate, this one is just a UI convenience that skips
      // re-checking a proxy already known-good. Without this message that
      // second check is invisible: several seconds of silence between
      // clicking Launch and either the window opening or an error dialog.
      setMessage(`Launching ${launchProfile.name}`);
      // A saved cookie-set (Cookies tab) takes priority over the legacy
      // pasted/uploaded cookie_import_* fields -- both resolve to the same
      // cookieImportUrl the launch payload consumes, just from a different
      // source.
      const savedCookie = launchProfile.cookie_mode === 'saved' && launchProfile.cookie_id ?
        cloudState.cookies.find((item) => item.id === launchProfile.cookie_id) :
        null;
      const result = await native.launchProfile({
        id: launchProfile.id,
        name: launchProfile.name,
        userDataDir: profileDataDir(launchProfile.id),
        proxy: selectedProxy,
        useFreeProxy: proxyMode === 'free_proxy',
        sharedExtensions: cloudState.shared_extensions,
        commandLineSwitches,
        runtimeFingerprint: buildRuntimeFingerprint(launchProfile),
        startUrl: browserStartUrl(launchProfile),
        homeHtml: anonymousHomeHtml(launchProfile, cloudState.shared_bookmarks, selectedProxy),
        cookieImportPath: savedCookie ? null : (launchProfile.cookie_import_path || null),
        cookieImportUrl: savedCookie ? savedCookie.url : (launchProfile.cookie_import_url || null),
        cookieImportName: savedCookie ? savedCookie.name : (launchProfile.cookie_import_name || null),
        enableCookieManager: cloudState.built_in_extensions?.cookie_manager !== false,
        enableSmsActivate: cloudState.built_in_extensions?.sms_activate !== false,
        enableFoxywallFreeProxy: cloudState.built_in_extensions?.foxywall_free_proxy !== false,
      });
      if (result.ok) {
        setMessage(`Launched ${launchProfile.name}`);
      } else {
        setMessage('');
        setErrorDialog({title: `Couldn't launch ${launchProfile.name}`, detail: result.error || 'Launch failed for an unknown reason.'});
      }
    } catch (error) {
      setMessage('');
      setErrorDialog({
        title: `Couldn't launch ${profile.name}`,
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // withDb surfaces the real error via setMessage on failure; this function
  // previously gave no feedback either way, so a failed save (e.g. a status
  // change) looked identical to a successful one -- the change would show
  // locally but silently never reach the cloud, then vanish on another
  // machine's next fresh load.
  async function updateProfile(profile: ArgusProfile, patch: Partial<ArgusProfile>) {
    const ok = await withDb((activeOrgId) =>
      db.profiles.update(activeOrgId, profile.id, patch));
    if (!ok) {
      return;
    }
    patchProfiles((list) => list.map((item) =>
      item.id === profile.id ? {...item, ...patch} : item));
  }

  function openNewProfile() {
    setActiveTab('profiles');
    setProfileDraft(newProfileDraft());
  }

  function openEditProfile(profile: ArgusProfile) {
    setSelectedId(profile.id);
    setProfileDraft(draftFromProfile(profile));
  }

  function createFolder() {
    setFolderDraft({name: ''});
  }

  function renameFolder(folder: ArgusFolder) {
    setFolderDraft({id: folder.id, name: folder.name});
  }

  async function saveFolderDraft() {
    if (!folderDraft) {
      return;
    }
    const name = folderDraft.name.trim();
    if (!name) {
      setMessage('Folder name is required');
      return;
    }
    if (folderDraft.id) {
      const folderId = folderDraft.id;
      const ok = await withDb((activeOrgId) => db.folders.rename(activeOrgId, folderId, name));
      if (!ok) {
        return;
      }
      patchFolders((list) => list.map((item) =>
        item.id === folderId ? {...item, name} : item));
      setFolderDraft(null);
      setMessage(`${name} folder saved`);
      return;
    }
    const folder: ArgusFolder = {
      id: globalThis.crypto?.randomUUID?.() || `${Date.now()}`,
      name,
      created_at: new Date().toISOString(),
    };
    const ok = await withDb((activeOrgId) => db.folders.create(activeOrgId, folder));
    if (!ok) {
      return;
    }
    patchFolders((list) => [...list, folder]);
    setSelectedFolderId(folder.id);
    setFolderDraft(null);
    setMessage(`${folder.name} folder created`);
  }

  async function deleteFolder(folder: ArgusFolder) {
    if (!window.confirm(`Delete folder ${folder.name}? Profiles will move to All profiles.`)) {
      return;
    }
    // profiles.folder_id is nulled server-side by the FK's ON DELETE SET NULL,
    // so this is genuinely one statement; the local list just mirrors it.
    const ok = await withDb((activeOrgId) => db.folders.remove(activeOrgId, folder.id));
    if (!ok) {
      return;
    }
    patchFolders((list) => list.filter((item) => item.id !== folder.id));
    patchProfiles((list) => list.map((profile) =>
      profile.folder_id === folder.id ? {...profile, folder_id: null} : profile));
    setSelectedFolderId('');
    setMessage(`${folder.name} folder deleted`);
  }

  function deleteFolderDraft() {
    if (!folderDraft?.id) {
      setFolderDraft(null);
      return;
    }
    const folder = cloudState.folders.find((item) => item.id === folderDraft.id);
    setFolderDraft(null);
    if (folder) {
      void deleteFolder(folder);
    }
  }

  function openNewStatus() {
    setStatusDraft({name: ''});
  }

  async function saveStatusDraft() {
    if (!statusDraft) {
      return;
    }
    const name = statusDraft.name.trim();
    if (!name) {
      setMessage('Status name is required');
      return;
    }
    // A built-in status needs no row; statusList still dedupes the local list.
    const isNew = !baseProfileStatuses.includes(name) &&
      !cloudState.custom_statuses.includes(name);
    if (isNew) {
      const ok = await withDb((activeOrgId) => db.statuses.create(activeOrgId, name));
      if (!ok) {
        return;
      }
    }
    const statuses = statusList(
        cloudState.custom_statuses,
        baseProfileStatuses.includes(name) ? [] : [name]);
    setCloudState((current) => ({...current, custom_statuses: statuses}));
    setStatusDraft(null);
    setMessage(`${name} status created`);
  }

  async function saveProfileDraft() {
    if (!profileDraft) {
      return;
    }
    const name = profileDraft.name.trim();
    if (!name) {
      setMessage('Profile name is required');
      return;
    }
    if (profileDraft.proxy_mode === 'assigned' &&
        (!profileDraft.proxy_id || !cloudState.proxies.some((proxy) => proxy.id === profileDraft.proxy_id))) {
      setMessage('Proxy is required, or pick Direct / Free Proxy instead.');
      return;
    }
    const profile: ArgusProfile = {
      id: profileDraft.id || globalThis.crypto?.randomUUID?.() || `${Date.now()}`,
      name,
      status: profileDraft.status.trim() || 'Ready',
      color: profileDraft.color || profileColors[1],
      folder_id: profileDraft.folder_id.trim() || null,
      email: profileDraft.email.trim() || undefined,
      password: profileDraft.password || undefined,
      proxy_id: profileDraft.proxy_mode === 'assigned' ? (profileDraft.proxy_id || null) : null,
      proxy_mode: profileDraft.proxy_mode,
      tags: tagsFromDraft(profileDraft.tags),
      start_url: profileDraft.start_url.trim() || null,
      cookie_import_path: profileDraft.cookie_import_path.trim() || null,
      cookie_import_url: profileDraft.cookie_import_url.trim() || null,
      cookie_import_name: profileDraft.cookie_import_name.trim() || null,
      cookie_import_count: profileDraft.cookie_import_path.trim() || profileDraft.cookie_import_url.trim() ?
        profileDraft.cookie_import_count || null :
        null,
      cookie_mode: profileDraft.cookie_mode,
      cookie_id: profileDraft.cookie_mode === 'saved' ? (profileDraft.cookie_id || null) : null,
      command_line_switches: profileDraft.command_line_switches.trim() || null,
      fingerprint: {
        os: profileDraft.fingerprint_os,
        browser_version: profileDraft.fingerprint_browser_version,
        user_agent: profileDraft.fingerprint_user_agent.trim(),
        language: profileDraft.fingerprint_language,
        timezone: profileDraft.fingerprint_timezone,
        geolocation: profileDraft.fingerprint_geolocation,
        webrtc: profileDraft.fingerprint_webrtc,
        canvas: profileDraft.fingerprint_canvas,
        webgl: profileDraft.fingerprint_webgl,
        webgpu: profileDraft.fingerprint_webgpu,
        client_rects: profileDraft.fingerprint_client_rects,
        audio: profileDraft.fingerprint_audio,
        webgl_vendor: profileDraft.fingerprint_webgl_vendor.trim(),
        webgl_renderer: profileDraft.fingerprint_webgl_renderer.trim(),
        screen: profileDraft.fingerprint_screen,
        cpu_model: profileDraft.fingerprint_cpu_model,
        cpu_cores: numberOrNull(profileDraft.fingerprint_cpu_cores),
        memory_gb: numberOrNull(profileDraft.fingerprint_memory_gb),
        media_devices: profileDraft.fingerprint_media_devices,
        do_not_track: profileDraft.fingerprint_do_not_track,
        rotate_on_launch: profileDraft.fingerprint_rotate,
      },
      created_at: profileDraft.id ?
        cloudState.profiles.find((item) => item.id === profileDraft.id)?.created_at :
        new Date().toISOString(),
    };
    // One row, keyed on the profile's own id -- which stays exactly what it was,
    // because it is also the E:\ArgysProfiles\<id> directory name. Create and
    // edit are separate statements on purpose (see db/profiles.ts): only the
    // create path should be able to raise profile_limit_reached.
    const isExisting = cloudState.profiles.some((item) => item.id === profile.id);
    const ok = await withDb((activeOrgId) =>
      db.profiles.save(activeOrgId, profile, isExisting));
    if (!ok) {
      // withDb already surfaced the real error via setMessage; don't overwrite
      // it with a false "saved" toast, and keep the dialog open so the user's
      // edits aren't lost.
      return;
    }
    patchProfiles((list) => isExisting ?
      list.map((item) => item.id === profile.id ? profile : item) :
      [...list, profile]);
    setSelectedId(profile.id);
    setProfileDraft(null);
    setMessage(`${profile.name} saved`);
  }

  function deleteProfileDraft() {
    if (!profileDraft?.id) {
      setProfileDraft(null);
      return;
    }
    const profile = cloudState.profiles.find((item) => item.id === profileDraft.id);
    if (!profile) {
      setProfileDraft(null);
      return;
    }
    deleteProfile(profile);
  }

  function deleteProfile(profile: ArgusProfile) {
    requestDeleteProfiles([profile.id], profile.name);
  }

  // A proxy is offered for "also delete" only when every profile assigned to
  // it is in the set being deleted -- otherwise removing it would silently
  // break a surviving profile's launch.
  function exclusiveProxyIdsFor(profileIds: string[]): string[] {
    const deletingIds = new Set(profileIds);
    const assigned = new Set(
      cloudState.profiles
          .filter((profile) => deletingIds.has(profile.id) && profile.proxy_id)
          .map((profile) => profile.proxy_id as string));
    return [...assigned].filter((proxyId) =>
      !cloudState.profiles.some((profile) =>
        !deletingIds.has(profile.id) && profile.proxy_id === proxyId));
  }

  function requestDeleteProfiles(profileIds: string[], label: string) {
    setProfileDeleteRemoveProxy(false);
    setProfileDeleteRequest({profileIds, label, exclusiveProxyIds: exclusiveProxyIdsFor(profileIds)});
  }

  async function confirmDeleteProfiles() {
    if (!profileDeleteRequest) {
      return;
    }
    const {profileIds, label, exclusiveProxyIds} = profileDeleteRequest;
    const deletedAt = new Date().toISOString();
    // One UPDATE stamping deleted_at on these ids, and nothing else. The old
    // path re-read the whole profiles array from the server first, because it
    // was about to rewrite all of it; there is nothing left to be stale about.
    const ok = await withDb(async (activeOrgId) => {
      await db.profiles.softDelete(activeOrgId, profileIds);
      if (profileDeleteRemoveProxy && exclusiveProxyIds.length) {
        await db.proxies.remove(activeOrgId, exclusiveProxyIds);
      }
    });
    if (!ok) {
      return;
    }
    const profiles = cloudState.profiles.map((item) =>
      profileIds.includes(item.id) ? {...item, deleted_at: deletedAt} : item);
    patchProfiles(() => profiles);
    if (profileDeleteRemoveProxy && exclusiveProxyIds.length) {
      // The proxies FK is ON DELETE SET NULL, so the affected profiles lose
      // their proxy_id server-side; mirror that locally.
      patchProxies((list) => list.filter((proxy) => !exclusiveProxyIds.includes(proxy.id)));
      patchProfiles((list) => list.map((item) =>
        item.proxy_id && exclusiveProxyIds.includes(item.proxy_id) ?
          {...item, proxy_id: null} :
          item));
    }
    if (selectedId && profileIds.includes(selectedId)) {
      setSelectedId(profiles.find((item) => !item.deleted_at)?.id || null);
    }
    setSelectedProfileIds(new Set());
    setProfileDraft(null);
    setMessage(`${label} moved to Trash${profileDeleteRemoveProxy && exclusiveProxyIds.length ? ' with its proxy deleted' : ''}`);
    setProfileDeleteRequest(null);
    setProfileDeleteRemoveProxy(false);
  }

  // Restoring crosses the profile limit as much as creating does, so
  // trg_profile_limit_restore fires on exactly this update and can refuse it.
  // A bulk restore is one statement, so it either all lands or none of it does.
  async function restoreProfile(profile: ArgusProfile) {
    const ok = await withDb((activeOrgId) =>
      db.profiles.restore(activeOrgId, [profile.id]));
    if (!ok) {
      return;
    }
    patchProfiles((list) => list.map((item) =>
      item.id === profile.id ? {...item, deleted_at: null} : item));
    setMessage(`${profile.name} restored`);
  }

  async function permanentlyDeleteProfile(profile: ArgusProfile) {
    if (!window.confirm(`Permanently delete ${profile.name}? This cannot be undone.`)) {
      return;
    }
    const ok = await withDb((activeOrgId) => db.profiles.purge(activeOrgId, [profile.id]));
    if (!ok) {
      return;
    }
    patchProfiles((list) => list.filter((item) => item.id !== profile.id));
    setMessage(`${profile.name} permanently deleted`);
  }

  async function restoreSelectedProfiles() {
    if (!selectedProfileIds.size) {
      return;
    }
    const count = selectedProfileIds.size;
    const ids = [...selectedProfileIds];
    const ok = await withDb((activeOrgId) => db.profiles.restore(activeOrgId, ids));
    if (!ok) {
      return;
    }
    patchProfiles((list) => list.map((item) =>
      selectedProfileIds.has(item.id) ? {...item, deleted_at: null} : item));
    setSelectedProfileIds(new Set());
    setMessage(`${count} ${count === 1 ? 'profile' : 'profiles'} restored`);
  }

  async function permanentlyDeleteSelectedProfiles() {
    if (!selectedProfileIds.size) {
      return;
    }
    const count = selectedProfileIds.size;
    if (!window.confirm(`Permanently delete ${count} selected ${count === 1 ? 'profile' : 'profiles'}? This cannot be undone.`)) {
      return;
    }
    const ids = [...selectedProfileIds];
    const ok = await withDb((activeOrgId) => db.profiles.purge(activeOrgId, ids));
    if (!ok) {
      return;
    }
    patchProfiles((list) => list.filter((item) => !selectedProfileIds.has(item.id)));
    setSelectedProfileIds(new Set());
    setMessage(`${count} ${count === 1 ? 'profile' : 'profiles'} permanently deleted`);
  }

  async function pickImportCsv() {
    if (!native?.selectImportCsv) {
      setMessage('Native CSV picker is not available. Restart Argus Launcher and try again.');
      return;
    }
    const result = await native.selectImportCsv();
    if (!result) {
      return;
    }
    const rows = parseCsv(result.content);
    setImportResult(null);
    setImportFile({path: result.path, rows});
    setImportModalOpen(true);
  }

  async function runImport() {
    if (!importFile || !importFile.rows.length) {
      return;
    }
    setImporting(true);
    try {
      const profiles = [...cloudState.profiles];
      const proxies = [...cloudState.proxies];
      const folders = [...cloudState.folders];
      // What this run actually has to write. The blob path rewrote everything;
      // rows the CSV never mentioned are now left alone.
      const newProxies: ArgusProxy[] = [];
      const newFolders: ArgusFolder[] = [];
      const touchedProfiles: Array<{profile: ArgusProfile; exists: boolean}> = [];
      const proxyIndexByKey = new Map<string, number>();
      proxies.forEach((proxy, index) => {
        proxyIndexByKey.set(proxyDedupeKey(proxy.type || 'http', proxy.host, proxy.port, proxy.username || ''), index);
      });
      const folderIdByCsvValue = new Map<string, string>();
      folders.forEach((folder) => {
        const match = /^Imported (.+)$/.exec(folder.name);
        if (match) {
          folderIdByCsvValue.set(match[1], folder.id);
        }
      });

      let created = 0;
      let updated = 0;
      let proxiesCreated = 0;
      let proxiesReused = 0;
      let foldersCreated = 0;
      const skipped: Array<{name: string; reason: string}> = [];

      for (const row of importFile.rows) {
        const name = (row.name || '').trim();
        if (!name) {
          skipped.push({name: row.profile_id || '(unnamed)', reason: 'Missing name'});
          continue;
        }

        let proxyId: string | null = null;
        const parsedProxy = parseProxyConnectionString(row.proxy_name || '');
        if (parsedProxy) {
          const key = proxyDedupeKey(parsedProxy.type, parsedProxy.host, parsedProxy.port, parsedProxy.username);
          const existingIndex = proxyIndexByKey.get(key);
          if (existingIndex !== undefined) {
            proxyId = proxies[existingIndex].id;
            proxiesReused++;
          } else {
            const proxy: ArgusProxy = {
              id: globalThis.crypto?.randomUUID?.() || `${Date.now()}-${proxies.length}`,
              name: row.proxy_id ? `${name} proxy` : `${parsedProxy.host}:${parsedProxy.port}`,
              type: parsedProxy.type,
              host: parsedProxy.host,
              port: parsedProxy.port,
              username: parsedProxy.username || undefined,
              password: parsedProxy.password || undefined,
            };
            proxies.push(proxy);
            newProxies.push(proxy);
            proxyIndexByKey.set(key, proxies.length - 1);
            proxyId = proxy.id;
            proxiesCreated++;
          }
        } else {
          skipped.push({name, reason: `Could not parse proxy from "${row.proxy_name || row.proxy_host || 'unknown'}"`});
        }

        let folderId: string | null = null;
        const csvFolder = (row.folder || '').trim();
        if (csvFolder) {
          const existingFolderId = folderIdByCsvValue.get(csvFolder);
          if (existingFolderId) {
            folderId = existingFolderId;
          } else {
            const folder: ArgusFolder = {
              id: globalThis.crypto?.randomUUID?.() || `${Date.now()}-${folders.length}`,
              name: `Imported ${csvFolder}`,
              created_at: new Date().toISOString(),
            };
            folders.push(folder);
            newFolders.push(folder);
            folderIdByCsvValue.set(csvFolder, folder.id);
            folderId = folder.id;
            foldersCreated++;
          }
        }

        // profile_id is written verbatim on purpose: re-creating a profile with
        // its exact original id is what reclaims an existing
        // E:\ArgysProfiles\<id> directory, cookies and logged-in sessions
        // intact. Which is also why a malformed one has to be refused here
        // rather than quietly renumbered.
        const importId = (row.profile_id || '').trim() ||
          globalThis.crypto?.randomUUID?.() || `${Date.now()}`;
        if (!isFsSafeId(importId)) {
          skipped.push({
            name,
            reason: `Profile id "${importId}" can't be a folder name (letters, digits, dot, dash, underscore only)`,
          });
          continue;
        }
        const existingProfileIndex = profiles.findIndex((item) => item.id === importId);
        const createdAt = Date.parse(row.created_at || '') ?
          new Date(row.created_at).toISOString() :
          new Date().toISOString();
        const profile: ArgusProfile = {
          id: importId,
          name,
          status: row.status_name?.trim() || 'Ready',
          color: existingProfileIndex >= 0 ? profiles[existingProfileIndex].color : profileColors[1],
          folder_id: folderId,
          proxy_id: proxyId,
          tags: tagsFromDraft(row.tags || ''),
          start_url: null,
          cookie_import_path: null,
          cookie_import_url: null,
          cookie_import_name: null,
          cookie_import_count: null,
          command_line_switches: null,
          fingerprint: existingProfileIndex >= 0 ? profiles[existingProfileIndex].fingerprint : {
            os: 'Windows 11',
            browser_version: 'Auto',
            language: languagePresets[0],
            timezone: 'Auto from proxy',
            geolocation: 'Ask',
            webrtc: 'Proxy only',
            canvas: 'Noise',
            webgl: 'Noise',
            webgpu: 'Real',
            client_rects: 'Noise',
            audio: 'Noise',
            webgl_vendor: defaultWindowsFingerprintPattern.fingerprint_webgl_vendor,
            webgl_renderer: defaultWindowsFingerprintPattern.fingerprint_webgl_renderer,
            screen: defaultWindowsFingerprintPattern.fingerprint_screen,
            cpu_model: defaultWindowsFingerprintPattern.fingerprint_cpu_model,
            cpu_cores: numberOrNull(defaultWindowsFingerprintPattern.fingerprint_cpu_cores),
            memory_gb: numberOrNull(defaultWindowsFingerprintPattern.fingerprint_memory_gb),
            media_devices: mediaDevicePresets[0],
            do_not_track: false,
            rotate_on_launch: true,
          },
          created_at: existingProfileIndex >= 0 ? profiles[existingProfileIndex].created_at : createdAt,
        };
        if (existingProfileIndex >= 0) {
          profiles[existingProfileIndex] = profile;
          updated++;
        } else {
          profiles.push(profile);
          created++;
        }
        touchedProfiles.push({profile, exists: existingProfileIndex >= 0});
      }

      // FK order: a profile cannot reference a folder or proxy that is not
      // there yet. Unlike the single blob write this replaces, these are
      // separate statements -- if the org hits its profile limit partway
      // through, the rows written before that point stay written, and the
      // counts below are what the loop planned rather than what landed.
      const writtenProfiles: string[] = [];
      const ok = await withDb(async (activeOrgId) => {
        for (const folder of newFolders) {
          await db.folders.create(activeOrgId, folder);
        }
        for (const proxy of newProxies) {
          await db.proxies.upsert(activeOrgId, proxy);
        }
        for (const {profile, exists} of touchedProfiles) {
          await db.profiles.save(activeOrgId, profile, exists);
          writtenProfiles.push(profile.id);
        }
      });
      setCloudState((current) => ({
        ...current,
        folders,
        proxies,
        profiles: profiles.filter((profile) =>
          writtenProfiles.includes(profile.id) ||
          current.profiles.some((item) => item.id === profile.id)),
      }));
      if (!ok) {
        return;
      }
      setImportResult({created, updated, proxiesCreated, proxiesReused, foldersCreated, skipped});
      setMessage(`Imported ${created} new, updated ${updated} profiles`);
      setImportFile(null);
    } finally {
      setImporting(false);
    }
  }

  function filteredProfileProxies() {
    if (!profileDraft?.proxy_search.trim()) {
      return cloudState.proxies;
    }
    const query = profileDraft.proxy_search.trim().toLowerCase();
    return cloudState.proxies.filter((proxy) =>
      [proxy.name, proxy.host, proxy.type, String(proxy.port), proxy.username]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
          .includes(query));
  }

  function profileProxyValue() {
    if (!profileDraft) {
      return '';
    }
    if (proxyPickerFocused) {
      return profileDraft.proxy_search;
    }
    if (profileDraft.proxy_search) {
      return profileDraft.proxy_search;
    }
    const proxy = cloudState.proxies.find((item) => item.id === profileDraft.proxy_id);
    return proxy ? proxyOptionLabel(proxy) : 'Proxy required';
  }

  function updateProfileProxyValue(value: string) {
    if (!profileDraft) {
      return;
    }
    if (!value.trim() || value === 'Direct connection') {
      setProfileDraft({...profileDraft, proxy_search: ''});
      return;
    }
    const matchedProxy = cloudState.proxies.find((proxy) =>
      proxyOptionLabel(proxy) === value ||
      proxy.id === value ||
      `${proxy.host}:${proxy.port}` === value);
    setProfileDraft({
      ...profileDraft,
      proxy_id: matchedProxy?.id || '',
      proxy_search: value,
    });
  }

  function commitProfileProxyValue() {
    if (!profileDraft) {
      return;
    }
    setProxyPickerFocused(false);
    const value = profileDraft.proxy_search.trim();
    if (!value || value === 'Direct connection') {
      setProfileDraft({...profileDraft, proxy_search: ''});
      return;
    }
    const matchedProxy = cloudState.proxies.find((proxy) =>
      proxyOptionLabel(proxy) === value ||
      proxy.id === value ||
      `${proxy.host}:${proxy.port}` === value);
    if (matchedProxy) {
      setProfileDraft({
        ...profileDraft,
        proxy_id: matchedProxy.id,
        proxy_search: '',
      });
    }
  }

  function focusProfileProxyPicker() {
    if (!profileDraft) {
      return;
    }
    setProxyPickerFocused(true);
    setProfileDraft({...profileDraft, proxy_search: ''});
  }

  function proxyForDraft() {
    if (!profileDraft) {
      return null;
    }
    return cloudState.proxies.find((proxy) => proxy.id === profileDraft.proxy_id) || null;
  }

  function effectiveUserAgent() {
    if (!profileDraft) {
      return 'Auto';
    }
    if (profileDraft.fingerprint_user_agent.trim()) {
      return profileDraft.fingerprint_user_agent.trim();
    }
    return userAgentForFingerprint(profileDraft.fingerprint_os, profileDraft.fingerprint_browser_version);
  }

  function summaryRows() {
    if (!profileDraft) {
      return [];
    }
    const proxy = proxyForDraft();
    const webglInfo = [
      profileDraft.fingerprint_webgl_vendor || 'Google Inc. (Auto)',
      profileDraft.fingerprint_webgl_renderer || 'ANGLE (Auto renderer)',
    ];
    return [
      ['ID', profileDraft.id || 'New profile'],
      ['Name', profileDraft.name || '-'],
      ['Status', profileDraft.status || 'Ready'],
      ['Tags', tagsFromDraft(profileDraft.tags)],
      ['Platform', profileDraft.fingerprint_os],
      ['UserAgent', effectiveUserAgent()],
      ['Proxy', proxy?.name || (profileDraft.proxy_id ? 'Selected proxy' : 'No proxy')],
      ['WebRTC', profileDraft.fingerprint_webrtc],
      ['Canvas', profileDraft.fingerprint_canvas],
      ['WebGL', profileDraft.fingerprint_webgl],
      ['WebGL Info', webglInfo],
      ['WebGPU', profileDraft.fingerprint_webgpu],
      ['Client Rects', profileDraft.fingerprint_client_rects],
      ['Timezone', profileDraft.fingerprint_timezone],
      ['Language', profileDraft.fingerprint_language],
      ['Geolocation', profileDraft.fingerprint_geolocation],
      ['CPU', profileDraft.fingerprint_cpu_model ?
        `${profileDraft.fingerprint_cpu_model} (${profileDraft.fingerprint_cpu_cores || 'real'} threads)` :
        profileDraft.fingerprint_cpu_cores ? `${profileDraft.fingerprint_cpu_cores} threads` : 'Real'],
      ['Memory', profileDraft.fingerprint_memory_gb ? `${profileDraft.fingerprint_memory_gb} GB` : 'Real'],
      ['MAC address', 'OFF'],
      ['DeviceName', 'OFF'],
      ['Audio', profileDraft.fingerprint_audio],
      ['Screen', profileDraft.fingerprint_screen],
      ['Media devices', profileDraft.fingerprint_media_devices],
      ['Do not track', profileDraft.fingerprint_do_not_track ? 'On' : 'Off'],
    ] as const;
  }

  function createProxyFromProfileLink() {
    if (!profileDraft) {
      return;
    }
    const value = profileDraft.proxy_link.trim();
    if (!value) {
      setProxyDraftSource('profile');
      setProxyDraft(newProxyDraft());
      return;
    }
    const parsed = parseProxyLink(value);
    if (!parsed) {
      setMessage('Proxy link is invalid. Use http://user:pass@host:port, socks5://user:pass@host:port, or http:host:port:user:pass');
      return;
    }
    setProxyDraftSource('profile');
    setProxyDraft({
      name: '',
      type: parsed.type || 'http',
      host: parsed.host,
      port: String(parsed.port),
      username: parsed.username || '',
      password: parsed.password || '',
    });
  }

  function openNewProxy() {
    setActiveTab('proxies');
    setProxyDraftSource(null);
    setProxyDraft(newProxyDraft());
  }

  function openEditProxy(proxy: ArgusProxy) {
    setProxyDraftSource(null);
    setProxyDraft(draftFromProxy(proxy));
  }

  function closeProxyDraft() {
    setProxyDraft(null);
    setProxyDraftSource(null);
  }

  async function saveProxyDraft() {
    if (!proxyDraft) {
      return;
    }
    const host = proxyDraft.host.trim();
    const port = Number(proxyDraft.port);
    if (!host || !Number.isInteger(port) || port < 1 || port > 65535) {
      setMessage('Proxy host and valid port are required');
      return;
    }
    const existing = cloudState.proxies.find((item) => item.id === proxyDraft.id);
    const connectionUnchanged = existing &&
      existing.type === proxyDraft.type &&
      existing.host === host &&
      existing.port === port &&
      (existing.username || '') === proxyDraft.username.trim() &&
      (existing.password || '') === proxyDraft.password;
    const proxy: ArgusProxy = {
      ...(connectionUnchanged ? {
        country: existing.country,
        country_code: existing.country_code,
        egress_ip: existing.egress_ip,
        ping_ms: existing.ping_ms,
        checked_at: existing.checked_at,
        check_error: existing.check_error,
      } : {}),
      id: proxyDraft.id || globalThis.crypto?.randomUUID?.() || `${Date.now()}`,
      name: proxyDraft.name.trim() || `${host}:${port}`,
      type: proxyDraft.type,
      host,
      port,
      username: proxyDraft.username.trim() || undefined,
      password: proxyDraft.password || undefined,
    };
    // When the connection details changed, the six last_* columns are written
    // as explicit nulls by proxyToRow -- the stored check result no longer
    // describes this proxy, and the background loop will re-check it.
    const isExisting = Boolean(proxyDraft.id) &&
      cloudState.proxies.some((item) => item.id === proxy.id);
    const ok = await withDb((activeOrgId) => db.proxies.upsert(activeOrgId, proxy));
    if (!ok) {
      return;
    }
    patchProxies((list) => isExisting ?
      list.map((item) => item.id === proxy.id ? proxy : item) :
      [...list, proxy]);
    if (!proxyDraft.id && proxyDraftSource === 'profile') {
      setProfileDraft((current) => current ? {
        ...current,
        proxy_id: proxy.id,
        proxy_link: '',
        proxy_search: '',
      } : current);
    }
    closeProxyDraft();
    setMessage(!proxyDraft.id && proxyDraftSource === 'profile' ?
      `${proxy.name} proxy created and assigned` :
      `${proxy.name} saved`);
  }

  async function checkProxyOnce(proxy: ArgusProxy) {
    if (!native?.checkProxy) {
      setMessage('Native proxy checker is not available. Restart Argus Launcher and try again.');
      return;
    }
    setCheckingProxyId(proxy.id);
    try {
      const result = await native.checkProxy(proxy);
      const checkedProxy: ArgusProxy = {
        ...proxy,
        country: result.country,
        country_code: result.countryCode,
        egress_ip: result.ip,
        ping_ms: result.pingMs,
        checked_at: new Date().toISOString(),
        check_error: result.ok ? undefined : result.error || 'Proxy check failed',
      };
      const ok = await recordProxyCheck(checkedProxy);
      if (!ok) {
        return;
      }
      setMessage(result.ok ?
        `${proxy.name || proxy.host} checked · ${result.country || result.countryCode || result.ip || 'OK'} · ${result.pingMs}ms` :
        `${proxy.name || proxy.host} check failed · ${checkedProxy.check_error}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setCheckingProxyId('');
    }
  }

  function deleteProxyDraft() {
    if (!proxyDraft?.id) {
      closeProxyDraft();
      return;
    }
    const proxy = cloudState.proxies.find((item) => item.id === proxyDraft.id);
    if (!proxy) {
      closeProxyDraft();
      return;
    }
    requestDeleteProxies([proxy.id], proxy.name || proxy.host);
  }

  function toggleProxySelected(proxyId: string) {
    setSelectedProxyIds((current) => {
      const next = new Set(current);
      if (next.has(proxyId)) {
        next.delete(proxyId);
      } else {
        next.add(proxyId);
      }
      return next;
    });
  }

  function toggleSelectAllProxies(list: ArgusProxy[]) {
    setSelectedProxyIds((current) => {
      const allChecked = list.length > 0 && list.every((proxy) => current.has(proxy.id));
      const next = new Set(current);
      list.forEach((proxy) => (allChecked ? next.delete(proxy.id) : next.add(proxy.id)));
      return next;
    });
  }

  function deleteSelectedProxies() {
    if (!selectedProxyIds.size) {
      return;
    }
    const count = selectedProxyIds.size;
    requestDeleteProxies([...selectedProxyIds], `${count} selected ${count === 1 ? 'proxy' : 'proxies'}`);
  }

  function requestDeleteProxies(proxyIds: string[], label: string) {
    const affectedProfiles = cloudState.profiles.filter((profile) =>
      profile.proxy_id && proxyIds.includes(profile.proxy_id)).length;
    setProxyDeleteAck(false);
    setProxyDeleteRequest({proxyIds, label, affectedProfiles});
  }

  async function confirmDeleteProxies() {
    if (!proxyDeleteRequest) {
      return;
    }
    const {proxyIds, label} = proxyDeleteRequest;
    // The FK on profiles.proxy_id is ON DELETE SET NULL, so the assigned
    // profiles are cleared by the same statement; this only mirrors it locally.
    const ok = await withDb((activeOrgId) => db.proxies.remove(activeOrgId, proxyIds));
    if (!ok) {
      return;
    }
    patchProxies((list) => list.filter((item) => !proxyIds.includes(item.id)));
    patchProfiles((list) => list.map((profile) =>
      profile.proxy_id && proxyIds.includes(profile.proxy_id) ?
        {...profile, proxy_id: null} :
        profile));
    setMessage(`${label} deleted`);
    setSelectedProxyIds(new Set());
    setProxyDraft(null);
    setProxyDeleteRequest(null);
    setProxyDeleteAck(false);
  }

  async function exportProxiesToCsv(list: ArgusProxy[]) {
    if (!list.length) {
      return;
    }
    if (!native?.saveTextFile) {
      setMessage('Native file export is not available. Restart Argus Launcher and try again.');
      return;
    }
    const header = ['name', 'type', 'host', 'port', 'username', 'password', 'country', 'country_code'];
    const lines = [header.join(',')];
    for (const proxy of list) {
      lines.push(header.map((key) => csvEscape(String((proxy as unknown as Record<string, unknown>)[key] ?? ''))).join(','));
    }
    const csv = lines.join('\n');
    const savedPath = await native.saveTextFile(`argys-proxies-${Date.now()}.csv`, csv);
    if (savedPath) {
      setMessage(`Exported ${list.length} ${list.length === 1 ? 'proxy' : 'proxies'} to ${savedPath.split('/').pop()}`);
    }
  }

  function toggleProfileSelected(profileId: string) {
    setSelectedProfileIds((current) => {
      const next = new Set(current);
      if (next.has(profileId)) {
        next.delete(profileId);
      } else {
        next.add(profileId);
      }
      return next;
    });
  }

  function toggleSelectAllProfiles(list: ArgusProfile[]) {
    setSelectedProfileIds((current) => {
      const allChecked = list.length > 0 && list.every((profile) => current.has(profile.id));
      const next = new Set(current);
      list.forEach((profile) => (allChecked ? next.delete(profile.id) : next.add(profile.id)));
      return next;
    });
  }

  function deleteSelectedProfiles() {
    if (!selectedProfileIds.size) {
      return;
    }
    const count = selectedProfileIds.size;
    requestDeleteProfiles([...selectedProfileIds], `${count} selected ${count === 1 ? 'profile' : 'profiles'}`);
  }

  async function exportProfilesToCsv(list: ArgusProfile[]) {
    if (!list.length) {
      return;
    }
    if (!native?.saveTextFile) {
      setMessage('Native file export is not available. Restart Argus Launcher and try again.');
      return;
    }
    const header = [
      'name', 'status', 'folder', 'proxy', 'tags', 'start_url', 'created_at',
      'os', 'browser_version', 'user_agent', 'language', 'timezone',
    ];
    const lines = [header.join(',')];
    for (const profile of list) {
      const proxy = proxyFor(profile);
      const folder = folderFor(profile);
      const row: Record<string, string> = {
        name: profile.name || '',
        status: profile.status || '',
        folder: folder?.name || '',
        proxy: proxy ? `${proxy.type || 'http'}://${proxy.host}:${proxy.port}` : '',
        tags: profile.tags?.join('; ') || '',
        start_url: profile.start_url || '',
        created_at: profile.created_at || '',
        os: profile.fingerprint?.os || '',
        browser_version: profile.fingerprint?.browser_version || '',
        user_agent: profile.fingerprint?.user_agent || '',
        language: profile.fingerprint?.language || '',
        timezone: profile.fingerprint?.timezone || '',
      };
      lines.push(header.map((key) => csvEscape(row[key] ?? '')).join(','));
    }
    const csv = lines.join('\n');
    const savedPath = await native.saveTextFile(`argys-profiles-${Date.now()}.csv`, csv);
    if (savedPath) {
      setMessage(`Exported ${list.length} ${list.length === 1 ? 'profile' : 'profiles'} to ${savedPath.split('/').pop()}`);
    }
  }

  async function assignSelectedProfilesToFolder(folderId: string) {
    if (!selectedProfileIds.size) {
      return;
    }
    const nextFolderId = folderId || null;
    const ids = [...selectedProfileIds];
    const ok = await withDb(async (activeOrgId) => {
      for (const id of ids) {
        await db.profiles.update(activeOrgId, id, {folder_id: nextFolderId});
      }
    });
    if (!ok) {
      return;
    }
    patchProfiles((list) => list.map((profile) =>
      selectedProfileIds.has(profile.id) ? {...profile, folder_id: nextFolderId} : profile));
    const folderName = nextFolderId ?
      cloudState.folders.find((folder) => folder.id === nextFolderId)?.name :
      'All profiles';
    setMessage(`${selectedProfileIds.size} ${selectedProfileIds.size === 1 ? 'profile' : 'profiles'} moved to ${folderName || 'All profiles'}`);
  }

  // Shared by the "Import cookies" button (folder picked via native dialog,
  // targetProfileIds = the checked selection) and the local automation API
  // (POST /v1/cookies/bulk-match, targetProfileIds = null meaning "every
  // profile"). Matches by name against files in `folderPath`, same as the
  // Dolphin-export naming convention (dolphin-anty-cookies-<Name>-<id>.txt).
  async function matchCookiesToProfiles(
      folderPath: string, targetProfileIds: string[] | null): Promise<{matched: number; total: number}> {
    if (!native?.matchCookieFiles) {
      throw new Error('Native cookie import is not available. Restart Argus Launcher and try again.');
    }
    const targetIds = targetProfileIds ? new Set(targetProfileIds) : null;
    const isTarget = (profile: ArgusProfile) => !profile.deleted_at && (!targetIds || targetIds.has(profile.id));
    const selected = cloudState.profiles.filter(isTarget);
    const matches = await native.matchCookieFiles(folderPath, selected.map((profile) => profile.name));
    let matched = 0;
    const cookiePatches = new Map<string, Pick<ArgusProfile, 'cookie_import_path' | 'cookie_import_url' | 'cookie_import_name' | 'cookie_import_count'>>();
    for (const profile of selected) {
      const match = matches[profile.name];
      if (!match) {
        continue;
      }
      cookiePatches.set(profile.id, await cloudCookieFromSelection(profile.id, match));
      matched += 1;
    }
    // One update per profile that actually matched a cookie file; the ones that
    // did not match are never rewritten.
    const ok = await withDb(async (activeOrgId) => {
      for (const [profileId, patch] of cookiePatches) {
        await db.profiles.update(activeOrgId, profileId, patch);
      }
    });
    if (!ok) {
      throw new Error('Failed to save matched cookies to cloud state.');
    }
    patchProfiles((list) => list.map((profile) => {
      const patch = isTarget(profile) ? cookiePatches.get(profile.id) : undefined;
      return patch ? {...profile, ...patch} : profile;
    }));
    return {matched, total: selected.length};
  }

  async function importCookiesForSelectedProfiles() {
    if (!selectedProfileIds.size) {
      return;
    }
    if (!native?.selectCookieFolder || !native?.matchCookieFiles) {
      setMessage('Native cookie import is not available. Restart Argus Launcher and try again.');
      return;
    }
    const folderPath = await native.selectCookieFolder();
    if (!folderPath) {
      return;
    }
    try {
      const {matched, total} = await matchCookiesToProfiles(folderPath, [...selectedProfileIds]);
      setMessage(`Matched cookies for ${matched} of ${total} selected profiles`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }

  function openNewBookmark() {
    setActiveTab('bookmarks');
    setBookmarkDraft(newBookmarkDraft());
  }

  function openEditBookmark(bookmark: SharedBookmark) {
    setBookmarkDraft(draftFromBookmark(bookmark));
  }

  async function saveBookmarkDraft() {
    if (!bookmarkDraft) {
      return;
    }
    const url = normalizeBookmarkUrl(bookmarkDraft.url);
    if (!url) {
      setMessage('Bookmark URL is required');
      return;
    }
    const bookmark: SharedBookmark = {
      title: bookmarkDraft.title.trim() || url,
      url,
      icon: bookmarkDraft.icon.trim() || undefined,
    };
    // Bookmarks are addressed by url, the way the edit dialog already thinks of
    // them: originalUrl identifies the row when the url itself is being changed.
    const originalUrl = bookmarkDraft.originalUrl;
    const existing = cloudState.shared_bookmarks.find((item) =>
      item.url === (originalUrl || bookmark.url));
    const position = existing?.position ?? cloudState.shared_bookmarks.length;
    const saved: SharedBookmark = {...bookmark, position};
    const ok = await withDb(async (activeOrgId) => {
      if (existing) {
        await db.bookmarks.updateByUrl(activeOrgId, existing.url, saved);
      } else {
        await db.bookmarks.create(activeOrgId, saved);
      }
    });
    if (!ok) {
      return;
    }
    patchBookmarks((list) => [
      ...list.filter((item) => item.url !== (originalUrl || bookmark.url)),
      saved,
    ]);
    setBookmarkDraft(null);
    setMessage(`${bookmark.title} saved`);
  }

  async function deleteBookmarkDraft() {
    if (!bookmarkDraft?.originalUrl) {
      setBookmarkDraft(null);
      return;
    }
    const originalUrl = bookmarkDraft.originalUrl;
    const ok = await withDb((activeOrgId) => db.bookmarks.removeByUrl(activeOrgId, originalUrl));
    if (!ok) {
      return;
    }
    patchBookmarks((list) => list.filter((bookmark) => bookmark.url !== originalUrl));
    setBookmarkDraft(null);
    setMessage('Bookmark deleted');
  }

  // Chrome extension ids are 32 lowercase letters restricted to a-p. Accepts
  // a bare id or any Web Store URL (chromewebstore.google.com/detail/.../<id>
  // or the older chrome.google.com/webstore/detail/.../<id>).
  function parseWebstoreExtensionId(input: string): string | null {
    const trimmed = input.trim();
    if (/^[a-p]{32}$/.test(trimmed)) {
      return trimmed;
    }
    try {
      const segments = new URL(trimmed).pathname.split('/').filter(Boolean);
      const last = segments.at(-1) || '';
      return /^[a-p]{32}$/.test(last) ? last : null;
    } catch {
      return null;
    }
  }

  // Uploads the zipped folder to Supabase Storage so every team member can
  // materialize their own local copy later (see main.cjs's
  // materializeSharedExtension) -- cloud state only ever holds this public
  // URL, never the extension's files directly.
  async function addExtensionFromFolder() {
    if (!native?.selectExtensionFolder || !native?.zipExtensionFolder) {
      setMessage('Native folder picker is not available. Restart Argus Launcher and try again.');
      return;
    }
    const folderPath = await native.selectExtensionFolder();
    if (!folderPath?.trim()) {
      return;
    }
    if (!supabase) {
      setMessage('Cloud sync is not configured, so this extension can only be shared with your team once it is.');
      return;
    }
    setMessage('Uploading extension for your team…');
    const zipped = await native.zipExtensionFolder(folderPath);
    if (!zipped.ok || !zipped.base64) {
      setMessage(zipped.error || 'Failed to zip that extension folder.');
      return;
    }
    const id = crypto.randomUUID();
    const name = folderPath.trim().split('/').filter(Boolean).at(-1) || 'Extension';
    let uploaded: {url: string; inline: boolean};
    try {
      uploaded = await db.extensions.uploadPackage(id, zipped.base64);
    } catch (error) {
      setMessage(describeDbError(error, 'Upload failed.'));
      return;
    }
    const nextExtension: SharedExtension = {
      id,
      name,
      source: 'local',
      storageUrl: uploaded.url,
    };
    const ok = await withDb((activeOrgId) =>
      db.extensions.upsert(activeOrgId, nextExtension, uploaded.inline ?
        null :
        `shared-extensions/${id}.zip`));
    if (!ok) {
      return;
    }
    patchExtensions((list) => [...list, nextExtension]);
    setExtensionAddOpen(false);
    setMessage(uploaded.inline ?
      `${name} shared inline. Check the ${db.STORAGE_BUCKET} storage bucket for large extensions.` :
      `${name} shared with your team`);
  }

  // Web Store extensions need no upload at all -- every team member
  // downloads/unpacks the same published CRX directly from Google's own CDN
  // the first time they launch a profile that uses it.
  async function addExtensionFromWebStoreLink(input: string, displayName: string) {
    const webstoreId = parseWebstoreExtensionId(input);
    if (!webstoreId) {
      setMessage('That doesn\'t look like a Chrome Web Store link or extension id.');
      return;
    }
    if (cloudState.shared_extensions.some((extension) => extension.webstoreId === webstoreId)) {
      setMessage('That extension is already shared');
      return;
    }
    const nextExtension: SharedExtension = {
      id: webstoreId,
      name: displayName.trim() || webstoreId,
      source: 'webstore',
      webstoreId,
    };
    const ok = await withDb((activeOrgId) => db.extensions.upsert(activeOrgId, nextExtension));
    if (!ok) {
      return;
    }
    patchExtensions((list) => [...list, nextExtension]);
    setExtensionAddOpen(false);
    setWebstoreLinkInput('');
    setWebstoreNameInput('');
    setMessage('Extension shared with your team');
  }

  async function cloudCookieFromSelection(
      profileId: string,
      selection: CookieFileSelection): Promise<Pick<ArgusProfile, 'cookie_import_path' | 'cookie_import_url' | 'cookie_import_name' | 'cookie_import_count'>> {
    const cookieName = selection.name || selection.path.split(/[\\/]/).filter(Boolean).at(-1) || 'cookies.txt';
    const base = {
      cookie_import_path: null,
      cookie_import_name: cookieName,
      cookie_import_count: selection.count || null,
    };
    if (!selection.base64) {
      throw new Error('Cookie file upload payload is missing. Select the cookie file again.');
    }
    const url = await db.cookieSets.uploadCookieFile(profileId, cookieName, selection.base64);
    return {...base, cookie_import_url: url};
  }

  async function pickProfileCookieFile() {
    if (!profileDraft) {
      return;
    }
    if (!native?.selectCookieFile) {
      setMessage('Native cookie file picker is not available. Restart Argus Launcher and try again.');
      return;
    }
    try {
      const selection = await native.selectCookieFile();
      if (!selection) {
        return;
      }
      const profileId = profileDraft.id || globalThis.crypto?.randomUUID?.() || `${Date.now()}`;
      const cloudCookie = await cloudCookieFromSelection(profileId, selection);
      setProfileDraft({
        ...profileDraft,
        id: profileDraft.id || profileId,
        cookie_import_path: cloudCookie.cookie_import_path || '',
        cookie_import_url: cloudCookie.cookie_import_url || '',
        cookie_import_name: cloudCookie.cookie_import_name || '',
        cookie_import_count: cloudCookie.cookie_import_count || 0,
      });
      setMessage(`Stored ${selection.count} cookies for import`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }

  // ---- Cookies tab / shared cookie-set library --------------------------

  function filteredCookieLibrary() {
    if (!profileDraft?.cookie_search.trim()) {
      return cloudState.cookies;
    }
    const query = profileDraft.cookie_search.trim().toLowerCase();
    return cloudState.cookies.filter((cookie) => cookie.name.toLowerCase().includes(query));
  }

  function cookieLibraryLabel(cookieId: string): string {
    const cookie = cloudState.cookies.find((item) => item.id === cookieId);
    if (!cookie) {
      return cookieId;
    }
    return cookie.count ? `${cookie.name} (${cookie.count} cookies)` : cookie.name;
  }

  function selectCookieFromLibrary(cookie: ArgusCookie) {
    if (!profileDraft) {
      return;
    }
    setProfileDraft({...profileDraft, cookie_mode: 'saved', cookie_id: cookie.id, cookie_search: ''});
  }

  function clearSelectedCookie() {
    if (!profileDraft) {
      return;
    }
    setProfileDraft({...profileDraft, cookie_mode: 'paste', cookie_id: ''});
  }

  // Uploads a new cookie file straight into the shared library (Cookies tab),
  // then selects it for the currently-open profile draft. Reuses
  // cloudCookieFromSelection's upload path, keyed by a fresh cookie id instead
  // of a profile id.
  async function addCookieToLibrary() {
    if (!native?.selectCookieFile) {
      setMessage('Native cookie file picker is not available. Restart Argus Launcher and try again.');
      return;
    }
    try {
      const selection = await native.selectCookieFile();
      if (!selection) {
        return;
      }
      const id = globalThis.crypto?.randomUUID?.() || `${Date.now()}`;
      const cloudCookie = await cloudCookieFromSelection(id, selection);
      if (!cloudCookie.cookie_import_url) {
        throw new Error('Cookie upload did not return a usable URL.');
      }
      const entry: ArgusCookie = {
        id,
        name: cloudCookie.cookie_import_name || 'cookies.txt',
        url: cloudCookie.cookie_import_url,
        count: cloudCookie.cookie_import_count,
      };
      const ok = await withDb((activeOrgId) => db.cookieSets.create(activeOrgId, entry));
      if (!ok) {
        return;
      }
      patchCookies((list) => [...list, entry]);
      if (profileDraft) {
        setProfileDraft({...profileDraft, cookie_mode: 'saved', cookie_id: entry.id, cookie_search: ''});
      }
      setMessage(`Added "${entry.name}" to the cookie library`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async function deleteCookieFromLibrary(id: string) {
    const cookie = cloudState.cookies.find((item) => item.id === id);
    // The FK nulls profiles.cookie_set_id server-side, but nothing puts those
    // profiles back into 'paste' mode -- that stays an explicit write, one per
    // profile that actually referenced this set.
    const referencing = cloudState.profiles.filter((profile) => profile.cookie_id === id);
    const ok = await withDb(async (activeOrgId) => {
      await db.cookieSets.remove(activeOrgId, id);
      for (const profile of referencing) {
        await db.profiles.update(activeOrgId, profile.id, {cookie_id: null, cookie_mode: 'paste'});
      }
    });
    if (!ok) {
      return;
    }
    patchCookies((list) => list.filter((item) => item.id !== id));
    patchProfiles((list) => list.map((profile) =>
      profile.cookie_id === id ?
        {...profile, cookie_id: null, cookie_mode: 'paste' as const} :
        profile));
    if (profileDraft?.cookie_id === id) {
      setProfileDraft({...profileDraft, cookie_mode: 'paste', cookie_id: ''});
    }
    setMessage(cookie ? `Deleted "${cookie.name}"` : 'Cookie-set deleted');
  }

  async function removeExtension(id: string) {
    const ok = await withDb((activeOrgId) => db.extensions.remove(activeOrgId, id));
    if (!ok) {
      return;
    }
    patchExtensions((list) => list.filter((extension) => extension.id !== id));
  }

  function renderProfilesTab() {
    const visible = visibleProfiles();
    const inTrash = selectedFolderId === TRASH_FOLDER_ID;
    const allVisibleSelected = visible.length > 0 &&
      visible.every((profile) => selectedProfileIds.has(profile.id));
    const {items: pageProfiles, page: clampedProfilePage, totalPages: profileTotalPages, total: profileTotal} =
      paginate(visible, profilePage, profilePageSize);
    return (
      <>
        <section className="table-toolbar">
          <select
            value={selectedFolderId}
            onChange={(event) => setSelectedFolderId(event.target.value)}
          >
            <option value="">All profiles</option>
            {cloudState.folders.map((folder) => (
              <option key={folder.id} value={folder.id}>{folder.name}</option>
            ))}
            <option value={TRASH_FOLDER_ID}>Trash</option>
          </select>
          {selectedFolderId && selectedFolderId !== TRASH_FOLDER_ID && (
            <button
              className="icon-button"
              aria-label={`Rename ${cloudState.folders.find((folder) => folder.id === selectedFolderId)?.name || 'folder'}`}
              onClick={() => {
                const folder = cloudState.folders.find((item) => item.id === selectedFolderId);
                if (folder) {
                  renameFolder(folder);
                }
              }}
            >
              <Pencil size={14} />
            </button>
          )}
          <button className="ghost" onClick={createFolder}><Plus size={16} /> Folder</button>
          <input
            type="text"
            value={profileSearch}
            onChange={(event) => setProfileSearch(event.target.value)}
            placeholder="Search profiles by name or tag"
          />
          <select
            value={profileStatusFilter}
            onChange={(event) => setProfileStatusFilter(event.target.value)}
          >
            <option value="">All statuses</option>
            {profileStatusOptions.map((status) => <option key={status} value={status}>{status}</option>)}
          </select>
        </section>
        {selectedProfileIds.size > 0 && inTrash && (
          <section className="selection-toolbar">
            <div className="selection-toolbar-actions">
              <button className="ghost" onClick={restoreSelectedProfiles}>Restore selected</button>
              <button className="danger ghost" onClick={permanentlyDeleteSelectedProfiles}>
                <Trash2 size={16} /> Delete forever
              </button>
            </div>
          </section>
        )}
        {selectedProfileIds.size > 0 && !inTrash && (
          <section className="selection-toolbar">
            <div className="selection-toolbar-actions">
              <select
                value=""
                onChange={(event) => void assignSelectedProfilesToFolder(event.target.value)}
              >
                <option value="" disabled>Assign to folder…</option>
                <option value="">All profiles</option>
                {cloudState.folders.map((folder) => (
                  <option key={folder.id} value={folder.id}>{folder.name}</option>
                ))}
              </select>
              <button
                  className="ghost"
                  disabled={isActionPending('import-cookies')}
                  onClick={() => runAsyncAction('import-cookies', importCookiesForSelectedProfiles)}>
                {isActionPending('import-cookies') ?
                    <RefreshCw size={16} className="btn-spin" /> :
                    <Cookie size={16} />}
                {isActionPending('import-cookies') ? 'Importing…' : 'Import cookies'}
              </button>
              <button
                className="ghost"
                onClick={() => exportProfilesToCsv(cloudState.profiles.filter((profile) => selectedProfileIds.has(profile.id)))}
              >
                <Download size={16} /> Export selected
              </button>
              <button className="danger ghost" onClick={deleteSelectedProfiles}>
                <Trash2 size={16} /> Delete selected
              </button>
            </div>
          </section>
        )}
        <section className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>
                  {visible.length > 0 && (
                    <input
                      type="checkbox"
                      aria-label="Select all"
                      checked={allVisibleSelected}
                      onChange={() => toggleSelectAllProfiles(visible)}
                    />
                  )}
                </th>
                <th>Name</th>
                <th>Platform</th>
                <th>Status</th>
                <th>Created</th>
                <th>Folder</th>
                <th>Proxy</th>
                <th>Tags</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {pageProfiles.map((profile) => {
                const proxy = proxyFor(profile);
                const folder = folderFor(profile);
                const rowClass = [
                  profile.id === selectedId ? 'selected' : '',
                  selectedProfileIds.has(profile.id) ? 'row-checked' : '',
                ].filter(Boolean).join(' ');
                return (
                  <tr key={profile.id} className={rowClass} onClick={() => setSelectedId(profile.id)}>
                    <td className="checkbox-cell" onClick={(event) => event.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={selectedProfileIds.has(profile.id)}
                        onChange={() => toggleProfileSelected(profile.id)}
                      />
                    </td>
                    <td className="name-cell">
                      <span className="avatar" style={{background: profile.color || '#2563eb'}}>
                        {initials(profile.name)}
                      </span>
                      {profile.name}
                    </td>
                    <td className="platform-cell">
                      <PlatformIcon os={profile.fingerprint?.os} />
                    </td>
                    <td>
                      <select
                        className={statusSelectClass(profile.status || 'Ready')}
                        value={profile.status || 'Ready'}
                        onClick={(event) => event.stopPropagation()}
                        onChange={(event) => updateProfile(profile, {status: event.target.value})}
                      >
                        {profileStatusOptions.map((status) => <option key={status}>{status}</option>)}
                      </select>
                    </td>
                    <td>{profile.created_at?.slice(0, 10) || '-'}</td>
                    <td>
                      {profile.deleted_at ?
                        `${daysUntilPurge(profile.deleted_at)}d left in Trash` :
                        (folder?.name || 'All profiles')}
                    </td>
                    <td>{proxy ? `${proxy.host}:${proxy.port}` : 'Direct'}</td>
                    <td>{profile.tags?.join(', ') || '-'}</td>
                    <td>
                      {profile.deleted_at ? (
                        <>
                          <button className="ghost" onClick={(event) => {
                            event.stopPropagation();
                            void restoreProfile(profile);
                          }}>Restore</button>
                          <button className="icon-button danger-icon" aria-label={`Permanently delete ${profile.name}`} onClick={(event) => {
                            event.stopPropagation();
                            void permanentlyDeleteProfile(profile);
                          }}><Trash2 size={16} /></button>
                        </>
                      ) : (
                        <>
                          <button
                              className="launch"
                              disabled={isActionPending(`launch-${profile.id}`)}
                              onClick={(event) => {
                                event.stopPropagation();
                                void runAsyncAction(`launch-${profile.id}`, () => launch(profile));
                              }}>
                            {isActionPending(`launch-${profile.id}`) ?
                                <RefreshCw size={16} className="btn-spin" /> :
                                <Play size={16} />}
                            Launch
                          </button>
                          <button className="icon-button" aria-label={`Edit ${profile.name}`} onClick={(event) => {
                            event.stopPropagation();
                            openEditProfile(profile);
                          }}><Pencil size={16} /></button>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
              {pageProfiles.length === 0 && (
                <tr>
                  <td colSpan={8}>
                    <span className="empty-state">
                      {profileSearch.trim() || profileStatusFilter ?
                        'No profiles match your search/filter.' :
                        inTrash ? 'Trash is empty.' : 'No profiles in this folder.'}
                    </span>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
        <PaginationBar
          page={clampedProfilePage}
          totalPages={profileTotalPages}
          total={profileTotal}
          pageSize={profilePageSize}
          onPage={setProfilePage}
          onPageSize={(size) => { setProfilePageSize(size); setProfilePage(0); }}
          extra={
            selectedProfileIds.size > 0 && (
              <span className="pagination-selected">{selectedProfileIds.size} selected</span>
            )
          }
        />
      </>
    );
  }

  function renderProxiesTab() {
    const visible = visibleProxies();
    const allSelected = visible.length > 0 &&
      visible.every((proxy) => selectedProxyIds.has(proxy.id));
    const {items: pageProxies, page: clampedProxyPage, totalPages: proxyTotalPages, total: proxyTotal} =
      paginate(visible, proxyPage, proxyPageSize);
    return (
      <>
        <section className="table-toolbar">
          {cloudState.proxies.length > 0 && (
            <label className="check-field">
              <input type="checkbox" checked={allSelected} onChange={() => toggleSelectAllProxies(visible)} />
              <span>{selectedProxyIds.size > 0 ? `${selectedProxyIds.size} selected` : 'Select all'}</span>
            </label>
          )}
          <input
            type="text"
            value={proxySearch}
            onChange={(event) => setProxySearch(event.target.value)}
            placeholder="Search proxies by name, host, or country"
          />
          <select
            value={proxyAssignedFilter}
            onChange={(event) => setProxyAssignedFilter(event.target.value as '' | 'assigned' | 'unassigned')}
          >
            <option value="">All proxies</option>
            <option value="assigned">Assigned to a profile</option>
            <option value="unassigned">Not assigned</option>
          </select>
          {visible.length > 0 && (
            <button className="ghost" onClick={() => exportProxiesToCsv(visible)}>
              <Download size={16} /> Export all
            </button>
          )}
        </section>
        {selectedProxyIds.size > 0 && (
          <section className="selection-toolbar">
            <div className="selection-toolbar-actions">
              <button
                className="ghost"
                onClick={() => exportProxiesToCsv(cloudState.proxies.filter((proxy) => selectedProxyIds.has(proxy.id)))}
              >
                <Download size={16} /> Export selected
              </button>
              <button className="danger ghost" onClick={deleteSelectedProxies}>
                <Trash2 size={16} /> Delete selected
              </button>
            </div>
          </section>
        )}
        <section className="card-grid">
          {pageProxies.map((proxy) => (
            <article className={selectedProxyIds.has(proxy.id) ? 'data-card proxy-card selected' : 'data-card proxy-card'} key={proxy.id}>
              <label className="card-select" onClick={(event) => event.stopPropagation()}>
                <input
                  type="checkbox"
                  checked={selectedProxyIds.has(proxy.id)}
                  onChange={() => toggleProxySelected(proxy.id)}
                />
              </label>
              <div className="proxy-card-main">
                <div className="proxy-title-row">
                  <span className="proxy-flag" title={proxy.country || proxy.country_code || 'Unchecked'}>
                    <FlagIcon countryCode={proxy.country_code} />
                  </span>
                  <h2>{proxy.name || proxy.host}</h2>
                </div>
                <p>{proxy.type || 'http'} · {proxy.host}:{proxy.port}</p>
                <p>
                  {proxy.checked_at ? (
                    proxy.check_error ?
                      `Check failed · ${proxy.check_error}` :
                      `${proxy.country || proxy.country_code || 'Unknown'} · ${proxy.egress_ip || 'No IP'} · ${proxy.ping_ms || 0}ms cached`
                  ) : 'Country not checked'}
                </p>
                <p>
                  <span className={isProxyAssigned(proxy) ? 'proxy-badge assigned' : 'proxy-badge unassigned'}>
                    {isProxyAssigned(proxy) ? 'Assigned' : 'Not assigned'}
                  </span>
                </p>
              </div>
              <div className="data-card-actions">
                {checkingProxyId === proxy.id && <span className="proxy-status">Checking...</span>}
                <button className="icon-button" aria-label={`Edit ${proxy.name || proxy.host}`} onClick={() => openEditProxy(proxy)}>
                  <Pencil size={16} />
                </button>
              </div>
            </article>
          ))}
          {pageProxies.length === 0 && (
            <p className="empty-state">
              {proxySearch.trim() ? 'No proxies match your search.' : 'No proxies loaded.'}
            </p>
          )}
        </section>
        <PaginationBar
          page={clampedProxyPage}
          totalPages={proxyTotalPages}
          total={proxyTotal}
          pageSize={proxyPageSize}
          onPage={setProxyPage}
          onPageSize={(size) => { setProxyPageSize(size); setProxyPage(0); }}
        />
      </>
    );
  }

  function renderBookmarksTab() {
    return (
      <section className="card-grid">
        {cloudState.shared_bookmarks.map((bookmark) => (
          <article className="data-card" key={`${bookmark.title}-${bookmark.url}`}>
            <div>
              <h2>{bookmark.title || bookmark.url}</h2>
              <p>{normalizeBookmarkUrl(bookmark.url)}</p>
            </div>
            <div className="data-card-actions">
              <button className="ghost" onClick={() => window.open(normalizeBookmarkUrl(bookmark.url), '_blank')}>Open</button>
              <button className="icon-button" aria-label={`Edit ${bookmark.title || bookmark.url}`} onClick={() => openEditBookmark(bookmark)}>
                <Pencil size={16} />
              </button>
            </div>
          </article>
        ))}
        {cloudState.shared_bookmarks.length === 0 && <p className="empty-state">No shared bookmarks loaded.</p>}
      </section>
    );
  }

  // Undefined/missing means enabled, for cloud state saved before this toggle
  // existed.
  function builtInExtensionEnabled(key: keyof BuiltInExtensionToggles): boolean {
    return cloudState.built_in_extensions?.[key] !== false;
  }

  // These toggles now live on the organization, not on the individual user, so
  // one worker cannot silently change what their colleagues' profiles launch
  // with. The RLS UPDATE policy on organizations requires is_org_admin, which
  // is why the switches are disabled for plain members rather than failing on
  // click.
  async function setBuiltInExtensionEnabled(key: keyof BuiltInExtensionToggles, enabled: boolean) {
    const next = {...cloudState.built_in_extensions, [key]: enabled};
    const ok = await withDb((activeOrgId) =>
      db.orgs.updateBuiltInExtensions(activeOrgId, next));
    if (!ok) {
      return;
    }
    setCloudState((current) => ({...current, built_in_extensions: next}));
  }

  const BUILT_IN_EXTENSIONS: Array<{key: keyof BuiltInExtensionToggles; name: string; description: string}> = [
    {
      key: 'cookie_manager',
      name: 'Argys Cookie Manager',
      description: 'Manual cookie export/import UI, bundled into every profile.',
    },
    {
      key: 'sms_activate',
      name: 'SMSActivate',
      description: 'Bundled into every profile regardless of proxy mode.',
    },
    {
      key: 'foxywall_free_proxy',
      name: 'FoxyWall Proxy',
      description: 'Bundled into every profile; only auto-connects for profiles set to Free Proxy mode. This switch turns off bundling it entirely.',
    },
  ];

  function renderCookiesTab() {
    return (
      <section className="panel">
        <div className="panel-title">
          <h2>Saved cookie-sets</h2>
        </div>
        <p>Shared cookie-set library. Assign one to a profile from its Cookie import section.</p>
        {cloudState.cookies.length === 0 && <p className="empty-state">No saved cookie-sets yet.</p>}
        {cloudState.cookies.map((cookie) => (
          <div className="extension-row" key={cookie.id}>
            <span>{cookie.name}</span>
            <small>{cookie.count ? `${cookie.count} cookies` : ''}</small>
            <button onClick={() => void deleteCookieFromLibrary(cookie.id)}><Trash2 size={16} /></button>
          </div>
        ))}
      </section>
    );
  }

  function renderExtensionsTab() {
    return (
      <section className="panel">
        <div className="panel-title">
          <h2>Built-in extensions</h2>
        </div>
        {!org.isAdmin && org.orgId && (
          <p className="empty-state">
            These apply to everyone in {org.org?.name || 'this organization'}, so only an owner
            or admin can change them.
          </p>
        )}
        {BUILT_IN_EXTENSIONS.map((entry) => (
          <div className="extension-row" key={entry.key}>
            <span>{entry.name}</span>
            <small>{entry.description}</small>
            <label className="switch" aria-label={`${builtInExtensionEnabled(entry.key) ? 'Disable' : 'Enable'} ${entry.name}`}>
              <input
                type="checkbox"
                checked={builtInExtensionEnabled(entry.key)}
                disabled={!org.isAdmin}
                onChange={(event) => void setBuiltInExtensionEnabled(entry.key, event.target.checked)}
              />
              <span className="switch-track"><span className="switch-thumb" /></span>
            </label>
          </div>
        ))}

        <div className="panel-subsection">
          <div className="panel-title">
            <h2>Shared extensions</h2>
            <button onClick={() => setExtensionAddOpen(true)}><Plus size={16} /> Add</button>
          </div>
          {cloudState.shared_extensions.map((extension) => (
            <div className="extension-row" key={extension.id}>
              <span>{extension.name || extension.id}</span>
              <small>{extension.source === 'webstore' ? 'Chrome Web Store' : 'Shared folder'}</small>
              <button onClick={() => removeExtension(extension.id)}><Trash2 size={16} /></button>
            </div>
          ))}
          {cloudState.shared_extensions.length === 0 && <p className="empty-state">No shared extensions loaded.</p>}
        </div>
      </section>
    );
  }

  function renderIntegrationsTab() {
    return (
      <section className="api-panel">
        <section className="api-note">
          <Plug size={18} />
          <span>
            Connect drives every profile in this account as MCP tools --
            launch, navigate, read, screenshot, close. One click creates a
            key and, for Claude Code/Codex, writes their config directly --
            nothing to copy or paste.
          </span>
        </section>

        <section className="integration-grid">
          {INTEGRATIONS.map((integration) => {
            const connectedKeys = apiKeys.filter((key) => key.name === integration.name);
            const Icon = integration.icon;
            const status = integrationStatus[integration.id];
            const token = integrationToken[integration.id];
            return (
              <div className="integration-card" key={integration.id}>
                <div className="integration-card-head">
                  <Icon size={22} />
                  <h2>{integration.name}</h2>
                </div>
                <p>{integration.description}</p>
                {connectedKeys.length > 0 ?
                  <span className="status-pill"><span className="status-dot" />Connected</span> :
                  <button onClick={() => void connectIntegrationOneClick(integration.id)}>Connect</button>}
                {status && <p className={status.ok ? 'apply-status-ok' : 'apply-status-error'}>{status.message}</p>}
                {token && (
                  <div className="snippet-block">
                    <button
                        className="snippet-copy"
                        onClick={() => { void navigator.clipboard.writeText(token); }}
                        title="Copy to clipboard">
                      <Copy size={14} /> Copy
                    </button>
                    <pre>{token}</pre>
                  </div>
                )}
                {connectedKeys.map((key) => (
                  <div className="endpoint" key={key.id}>
                    <div className="endpoint-head">
                      <code className="path">...{key.tokenPreview}</code>
                      <span className="endpoint-label">
                        {key.folderScope ?
                          (key.folderScope.map((id) => cloudState.folders.find((f) => f.id === id)?.name || id).join(', ') || 'no folders') :
                          'All folders'}
                      </span>
                      <span className="endpoint-label">
                        {key.lastUsedAt ? `Last used ${new Date(key.lastUsedAt).toLocaleString()}` : 'Never used'}
                      </span>
                      <button className="copy-button" onClick={() => void revokeApiKey(key.id)}>Revoke</button>
                    </div>
                  </div>
                ))}
              </div>
            );
          })}
        </section>
      </section>
    );
  }

  function renderApiTab() {
    return (
      <section className="api-panel">
        <section className="api-summary">
          <div className="summary-item">
            <span>Base URL</span>
            <code>{API_BASE_URL}</code>
          </div>
          <div className="summary-item">
            <span>Account</span>
            <code>{signedInEmail}</code>
          </div>
          <div className="summary-item wide">
            <span>Header</span>
            <code>{authHeader()}</code>
          </div>
          <div className="summary-actions">
            <button onClick={downloadApiExample}>
              <Download size={16} /> Download example
            </button>
          </div>
        </section>

        <section className="api-note">
          <Shield size={18} />
          <span>Connected apps (Hive, etc.) show up on the Integrations tab via the connect flow. Create a key by hand here only for your own scripts.</span>
        </section>

        <section className="api-group">
          <h2>Create a key</h2>
          <div className="endpoint">
            <input
              placeholder="Key name (e.g. my script)"
              value={newKeyName}
              spellCheck={false}
              onChange={(event) => setNewKeyName(event.target.value)}
            />
            <button className="copy-button" onClick={() => void createApiKey()}>Create key</button>
          </div>
        </section>

        <div className="api-groups">
          {API_GROUPS.map((group) => (
            <section className="api-group" key={group.title}>
              <h2>{group.title}</h2>
              {group.endpoints.map((endpoint) => (
                <article className="endpoint" key={`${endpoint.method}-${endpoint.path}`}>
                  <div className="endpoint-head">
                    <span className={`method ${endpoint.method.toLowerCase()}`}>{endpoint.method}</span>
                    <code className="path">{endpoint.path}</code>
                    <span className="endpoint-label">{endpoint.label}</span>
                    <button className="copy-button" onClick={() => copyCurl(endpoint)}>Copy curl</button>
                  </div>
                  {endpoint.body && <pre>{endpoint.body}</pre>}
                </article>
              ))}
            </section>
          ))}
        </div>

        {copiedEndpoint && <div className="toast">Copied {copiedEndpoint}</div>}
      </section>
    );
  }

  function renderRevealedKeyModal() {
    if (!revealedKey) {
      return null;
    }
    return (
      <div className="modal-backdrop" onMouseDown={() => setRevealedKey(null)}>
        <section className="profile-modal" onMouseDown={(event) => event.stopPropagation()}>
          <header>
            <div>
              <h2>Key created: {revealedKey.name}</h2>
            </div>
          </header>
          <p>Copy this now -- Anty won't show the raw key again.</p>
          <div className="snippet-block">
            <button
                className="snippet-copy"
                onClick={() => { void navigator.clipboard.writeText(revealedKey.token); }}
                title="Copy to clipboard">
              <Copy size={14} /> Copy
            </button>
            <pre>{revealedKey.token}</pre>
          </div>
          <div className="summary-actions">
            <button onClick={() => setRevealedKey(null)}>Done</button>
          </div>
        </section>
      </div>
    );
  }

  function renderOAuthApprovalModal() {
    if (!oauthRequest) {
      return null;
    }
    return (
      <div className="modal-backdrop">
        <section className="profile-modal" onMouseDown={(event) => event.stopPropagation()}>
          <header>
            <div>
              <h2>"{oauthRequest.clientName}" wants to connect</h2>
            </div>
          </header>
          <p>
            It's asking for: <strong>{oauthRequest.requestedScope === 'all' ? 'every profile folder' : oauthRequest.requestedScope}</strong>.
            You can grant a narrower folder instead before approving.
          </p>
          <label>
            <span>Grant access to</span>
            <select value={oauthApprovalFolder} onChange={(event) => setOauthApprovalFolder(event.target.value)}>
              <option value="">All folders</option>
              {cloudState.folders.map((folder) => (
                <option key={folder.id} value={folder.id}>{folder.name}</option>
              ))}
            </select>
          </label>
          <div className="summary-actions">
            <button onClick={() => void respondToOAuthRequest(false)}>Deny</button>
            <button onClick={() => void respondToOAuthRequest(true)}>Approve</button>
          </div>
        </section>
      </div>
    );
  }

  function renderImportModal() {
    if (!importModalOpen) {
      return null;
    }
    return (
      <div className="modal-backdrop" onMouseDown={() => setImportModalOpen(false)}>
        <section className="profile-modal import-panel" onMouseDown={(event) => event.stopPropagation()}>
          <header>
            <div>
              <h2>Mass import profiles</h2>
              <p>
                Import profiles in bulk from a Dolphin-style inventory CSV (the same format exported by
                the profiles-cookie-inventory tooling). Each row's proxy_name must carry the
                <code>type://host:port:username:password</code> connection string; proxies are matched
                and reused by host/port/username, and re-importing the same CSV updates existing profiles
                (matched by profile_id) instead of duplicating them.
              </p>
            </div>
            <button className="icon-button" aria-label="Close" onClick={() => setImportModalOpen(false)}><X size={18} /></button>
          </header>
        <div className="import-actions">
          <button className="ghost" onClick={pickImportCsv}><Upload size={18} /> Choose CSV file</button>
          {importFile && (
            <span className="import-file-label">
              {importFile.path.split('/').pop()} — {importFile.rows.length} row{importFile.rows.length === 1 ? '' : 's'}
            </span>
          )}
        </div>
        {importFile && (
          <button onClick={runImport} disabled={importing}>
            {importing ? 'Importing…' : `Import ${importFile.rows.length} profile${importFile.rows.length === 1 ? '' : 's'}`}
          </button>
        )}
        {importResult && (
          <div className="import-summary">
            <div className="summary-item">
              <span>Profiles created</span>
              <strong>{importResult.created}</strong>
            </div>
            <div className="summary-item">
              <span>Profiles updated</span>
              <strong>{importResult.updated}</strong>
            </div>
            <div className="summary-item">
              <span>Proxies created</span>
              <strong>{importResult.proxiesCreated}</strong>
            </div>
            <div className="summary-item">
              <span>Proxies reused</span>
              <strong>{importResult.proxiesReused}</strong>
            </div>
            <div className="summary-item">
              <span>Folders created</span>
              <strong>{importResult.foldersCreated}</strong>
            </div>
            {importResult.skipped.length > 0 && (
              <div className="summary-item wide">
                <span>Skipped ({importResult.skipped.length})</span>
                <div className="summary-lines">
                  {importResult.skipped.map((item, index) => (
                    <i key={index}>{item.name}: {item.reason}</i>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
        </section>
      </div>
    );
  }

  function renderActiveTab() {
    if (cloudLoading) {
      return <LoadingState label="Loading cloud data" detail="Profiles, proxies, bookmarks, and extensions are syncing." />;
    }
    switch (activeTab) {
      case 'proxies':
        return renderProxiesTab();
      case 'cookies':
        return renderCookiesTab();
      case 'bookmarks':
        return renderBookmarksTab();
      case 'extensions':
        return renderExtensionsTab();
      case 'integrations':
        return renderIntegrationsTab();
      case 'api':
        return renderApiTab();
      case 'profiles':
      default:
        return renderProfilesTab();
    }
  }

  function renderTopAction() {
    switch (activeTab) {
      case 'profiles':
        return (
          <>
            <button className="ghost" onClick={() => void pickImportCsv()}><Upload size={18} /> Import</button>
            <button onClick={openNewProfile}><Plus size={18} /> Profile</button>
          </>
        );
      case 'proxies':
        return <button onClick={openNewProxy}><Plus size={18} /> Proxy</button>;
      case 'cookies':
        return (
          <button
              disabled={isActionPending('pick-cookie-file')}
              onClick={() => runAsyncAction('pick-cookie-file', addCookieToLibrary)}>
            {isActionPending('pick-cookie-file') && <RefreshCw size={16} className="btn-spin" />}
            {isActionPending('pick-cookie-file') ? 'Uploading…' : <><Plus size={18} /> Cookie-set</>}
          </button>
        );
      case 'bookmarks':
        return <button onClick={openNewBookmark}><Plus size={18} /> Bookmark</button>;
      case 'extensions':
        return null;
      case 'integrations':
      case 'api':
      default:
        return null;
    }
  }

  function renderUpdateControl() {
    const state = updateState;
    const isChecking = state?.status === 'checking';
    const isDownloading = state?.status === 'downloading';
    const busy = updateBusy || isChecking || isDownloading;
    const canDownload = state?.status === 'available' && !busy;
    const canInstall = state?.status === 'downloaded' && !busy;
    return (
      <section className="update-panel">
        <div>
          <span>Launcher {state?.currentVersion || ''}</span>
          <strong>{updateStatusLabel(state)}</strong>
        </div>
        {state?.progress && (
          <div className="update-progress">
            <span style={{width: `${Math.min(100, Math.max(0, state.progress.percent))}%`}} />
          </div>
        )}
        <div className="update-actions">
          <button
            className="ghost icon-button"
            aria-label="Check for updates"
            disabled={busy || state?.canCheck === false}
            onClick={() => void runUpdateAction('check')}
          >
            <RefreshCw size={16} />
          </button>
          {canDownload && (
            <button onClick={() => void runUpdateAction('download')}>
              <Download size={16} /> Download
            </button>
          )}
          {canInstall && (
            <button onClick={() => void runUpdateAction('install')}>
              Restart
            </button>
          )}
        </div>
      </section>
    );
  }

  // The corner toast prompting an available/downloading/downloaded update.
  // Lives in the shared .toast-stack alongside the status toast so the two
  // stack instead of overlapping when both are visible at once.
  function renderUpdateToast() {
    if (!updateState ||
        !['available', 'downloading', 'downloaded'].includes(updateState.status) ||
        updateToastDismissedVersion === (updateState.updateInfo?.version || '')) {
      return null;
    }
    return (
      <div className="update-toast">
        <div className="update-toast-body">
          <strong>
            {updateState.status === 'downloaded'
              ? `Version ${updateState.updateInfo?.version || ''} downloaded — restart to install`
              : updateState.status === 'downloading'
              ? `Downloading update… ${Math.round(updateState.progress?.percent || 0)}%`
              : `Update ${updateState.updateInfo?.version || ''} available`}
          </strong>
        </div>
        <div className="update-toast-actions">
          {updateState.status === 'available' && (
            <button onClick={() => native?.downloadUpdate?.()}>Download</button>
          )}
          {updateState.status === 'downloaded' && (
            <button onClick={() => native?.installUpdate?.()}>Restart &amp; install</button>
          )}
          <button
            className="icon-button"
            aria-label="Dismiss update notice"
            onClick={() => setUpdateToastDismissedVersion(updateState.updateInfo?.version || 'unknown')}
          >
            <X size={16} />
          </button>
        </div>
      </div>
    );
  }

  function renderSettingsModal() {
    if (!settingsOpen) {
      return null;
    }
    return (
      <div className="modal-backdrop" onMouseDown={() => setSettingsOpen(false)}>
        <section className="profile-modal small-modal settings-modal" onMouseDown={(event) => event.stopPropagation()}>
          <header>
            <div>
              <h2>Settings</h2>
            </div>
            <button className="icon-button" aria-label="Close" onClick={() => setSettingsOpen(false)}><X size={18} /></button>
          </header>
          <section className="settings-section">
            <div>
              <h3>Updates</h3>
              <p>Check for launcher releases and choose when to download or restart.</p>
            </div>
            {renderUpdateControl()}
          </section>
          <section className="settings-section">
            <div>
              <h3>Changelog</h3>
              <p>What changed in the current or latest available release.</p>
            </div>
            <button className="ghost" onClick={() => setChangelogOpen(true)}>View changelog</button>
          </section>
          <section className="settings-section">
            <div>
              <h3>Account</h3>
              <p>{signedInEmail}</p>
            </div>
            <button className="ghost" onClick={signOut}>Sign out</button>
          </section>
        </section>
      </div>
    );
  }

  function renderChangelogModal() {
    if (!changelogOpen) {
      return null;
    }
    const notes = updateState?.updateInfo?.releaseNotes;
    const version = updateState?.updateInfo?.version || updateState?.currentVersion;
    return (
      <div className="modal-backdrop" onMouseDown={() => setChangelogOpen(false)}>
        <section className="profile-modal small-modal changelog-modal" onMouseDown={(event) => event.stopPropagation()}>
          <header>
            <div>
              <h2>Changelog{version ? ` · v${version}` : ''}</h2>
            </div>
            <button className="icon-button" aria-label="Close" onClick={() => setChangelogOpen(false)}><X size={18} /></button>
          </header>
          {notes ? (
            <pre className="changelog-notes">{notes}</pre>
          ) : (
            <div className="changelog-empty">
              <p>No changelog loaded yet.</p>
              <button onClick={() => void runUpdateAction('check')}>
                <RefreshCw size={16} /> Check for updates
              </button>
            </div>
          )}
        </section>
      </div>
    );
  }

  function renderCookiePickerModal() {
    if (!cookiePickerOpen || !profileDraft) {
      return null;
    }
    const results = filteredCookieLibrary();
    return (
      <div className="modal-backdrop" onMouseDown={() => setCookiePickerOpen(false)}>
        <section className="profile-modal small-modal cookie-picker-modal" onMouseDown={(event) => event.stopPropagation()}>
          <header>
            <div>
              <h2>Select cookies</h2>
              <p>Pick a saved cookie-set, or upload a new JSON/Netscape file to the library.</p>
            </div>
            <button className="icon-button" aria-label="Close" onClick={() => setCookiePickerOpen(false)}><X size={18} /></button>
          </header>
          <input
            type="text"
            placeholder="Search cookie-sets…"
            value={profileDraft.cookie_search}
            onChange={(event) => setProfileDraft({...profileDraft, cookie_search: event.target.value})}
          />
          <div className="cookie-picker-list">
            {results.length === 0 && (
              <p className="empty-state">No saved cookie-sets{profileDraft.cookie_search.trim() ? ' match your search' : ' yet'}.</p>
            )}
            {results.map((cookie) => (
              <button
                type="button"
                key={cookie.id}
                className={profileDraft.cookie_id === cookie.id ? 'cookie-picker-row active' : 'cookie-picker-row'}
                onClick={() => selectCookieFromLibrary(cookie)}
              >
                <span>{cookie.name}</span>
                <small>{cookie.count ? `${cookie.count} cookies` : ''}</small>
              </button>
            ))}
          </div>
          <footer className="modal-actions">
            <button
                className="ghost"
                type="button"
                disabled={isActionPending('pick-cookie-file')}
                onClick={() => runAsyncAction('pick-cookie-file', addCookieToLibrary)}>
              {isActionPending('pick-cookie-file') && <RefreshCw size={16} className="btn-spin" />}
              {isActionPending('pick-cookie-file') ? 'Uploading…' : 'Upload new'}
            </button>
            <button type="button" onClick={() => setCookiePickerOpen(false)}>Save</button>
          </footer>
        </section>
      </div>
    );
  }

  function renderExtensionAddModal() {
    if (!extensionAddOpen) {
      return null;
    }
    return (
      <div className="modal-backdrop" onMouseDown={() => setExtensionAddOpen(false)}>
        <section className="profile-modal small-modal extension-add-modal" onMouseDown={(event) => event.stopPropagation()}>
          <header>
            <div>
              <h2>Add extension</h2>
              <p>Share a Chrome Web Store extension or upload an unpacked folder.</p>
            </div>
            <button className="icon-button" aria-label="Close" onClick={() => setExtensionAddOpen(false)}><X size={18} /></button>
          </header>
          <section className="extension-add-section">
            <label className="field wide">
              <span>Chrome Web Store link or extension ID</span>
              <input
                autoFocus
                type="text"
                placeholder="https://chromewebstore.google.com/detail/..."
                value={webstoreLinkInput}
                onChange={(event) => setWebstoreLinkInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && webstoreLinkInput.trim()) {
                    void addExtensionFromWebStoreLink(webstoreLinkInput, webstoreNameInput);
                  }
                }}
              />
            </label>
            <label className="field wide">
              <span>Name (optional)</span>
              <input
                type="text"
                placeholder="Defaults to the extension id"
                value={webstoreNameInput}
                onChange={(event) => setWebstoreNameInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && webstoreLinkInput.trim()) {
                    void addExtensionFromWebStoreLink(webstoreLinkInput, webstoreNameInput);
                  }
                }}
              />
            </label>
            <div className="extension-add-actions">
              <button
                disabled={!webstoreLinkInput.trim()}
                onClick={() => void addExtensionFromWebStoreLink(webstoreLinkInput, webstoreNameInput)}
              >
                Add from link
              </button>
              <button className="ghost" onClick={() => void addExtensionFromFolder()}>
                Add from folder
              </button>
            </div>
          </section>
        </section>
      </div>
    );
  }

  function renderFingerprintFields() {
    if (!profileDraft) {
      return null;
    }
    return (
      <>
        <section className="form-section wide fingerprint-section">
          <div>
            <h3>Fingerprint</h3>
            <p>Profile-level browser identity settings stored with cloud data.</p>
            <button
              className="ghost"
              type="button"
              onClick={() => setProfileDraft({...profileDraft, ...randomFingerprintPatch(profileDraft.fingerprint_os)})}
            >
              Rotate fingerprint
            </button>
          </div>
          <label className="field">
            <span>Operating system</span>
            <select
              value={profileDraft.fingerprint_os}
              onChange={(event) => setProfileDraft(withFingerprintOs(profileDraft, event.target.value))}
            >
              {osPresets.map((item) => <option key={item}>{item}</option>)}
            </select>
          </label>
          <label className="field">
            <span>Browser version</span>
            <select
              value={profileDraft.fingerprint_browser_version}
              onChange={(event) => setProfileDraft({...profileDraft, fingerprint_browser_version: event.target.value})}
            >
              {browserVersionPresets.map((item) => <option key={item}>{item}</option>)}
            </select>
          </label>
          <label className="field wide">
            <span>User agent</span>
            <input
              placeholder="Auto when empty"
              value={profileDraft.fingerprint_user_agent}
              onChange={(event) => setProfileDraft({...profileDraft, fingerprint_user_agent: event.target.value})}
            />
          </label>
          <label className="field">
            <span>Language</span>
            <input
              list="language-presets"
              value={profileDraft.fingerprint_language}
              onChange={(event) => setProfileDraft({...profileDraft, fingerprint_language: event.target.value})}
            />
          </label>
          <label className="field">
            <span>Timezone</span>
            <input
              list="timezone-presets"
              value={profileDraft.fingerprint_timezone}
              onChange={(event) => setProfileDraft({...profileDraft, fingerprint_timezone: event.target.value})}
            />
          </label>
          <label className="field">
            <span>Geolocation</span>
            <select
              value={profileDraft.fingerprint_geolocation}
              onChange={(event) => setProfileDraft({...profileDraft, fingerprint_geolocation: event.target.value})}
            >
              <option>Ask</option>
              <option>Block</option>
              <option>Auto from proxy</option>
              <option>Custom</option>
            </select>
          </label>
          <label className="field">
            <span>WebRTC</span>
            <select
              value={profileDraft.fingerprint_webrtc}
              onChange={(event) => setProfileDraft({...profileDraft, fingerprint_webrtc: event.target.value})}
            >
              {webRtcModes.map((item) => <option key={item}>{item}</option>)}
            </select>
          </label>
          <label className="field">
            <span>Canvas</span>
            <select
              value={profileDraft.fingerprint_canvas}
              onChange={(event) => setProfileDraft({...profileDraft, fingerprint_canvas: event.target.value})}
            >
              {noiseModes.map((item) => <option key={item}>{item}</option>)}
            </select>
          </label>
          <label className="field">
            <span>WebGL</span>
            <select
              value={profileDraft.fingerprint_webgl}
              onChange={(event) => setProfileDraft({...profileDraft, fingerprint_webgl: event.target.value})}
            >
              {noiseModes.map((item) => <option key={item}>{item}</option>)}
            </select>
          </label>
          <label className="field">
            <span>WebGPU</span>
            <select
              value={profileDraft.fingerprint_webgpu}
              onChange={(event) => setProfileDraft({...profileDraft, fingerprint_webgpu: event.target.value})}
            >
              {webGpuModes.map((item) => <option key={item}>{item}</option>)}
            </select>
          </label>
          <label className="field">
            <span>Client rects</span>
            <select
              value={profileDraft.fingerprint_client_rects}
              onChange={(event) => setProfileDraft({...profileDraft, fingerprint_client_rects: event.target.value})}
            >
              {noiseModes.map((item) => <option key={item}>{item}</option>)}
            </select>
          </label>
          <label className="field">
            <span>Audio</span>
            <select
              value={profileDraft.fingerprint_audio}
              onChange={(event) => setProfileDraft({...profileDraft, fingerprint_audio: event.target.value})}
            >
              {noiseModes.map((item) => <option key={item}>{item}</option>)}
            </select>
          </label>
          {profileDraft.fingerprint_os === 'Android' || profileDraft.fingerprint_os === 'iOS' ? (
            <label className="field wide">
              <span>Device model</span>
              <select
                value={profileDraft.fingerprint_cpu_model}
                onChange={(event) => {
                  const device = mobileDevicePatternsFor(profileDraft.fingerprint_os)
                    .find((item) => item.fingerprint_cpu_model === event.target.value);
                  if (device) {
                    const {label: _label, ...pattern} = device;
                    setProfileDraft({...profileDraft, ...pattern});
                  }
                }}
              >
                <option value="">Auto</option>
                {mobileDevicePatternsFor(profileDraft.fingerprint_os).map((item) => (
                  <option value={item.fingerprint_cpu_model} key={item.fingerprint_cpu_model}>
                    {item.label} · {item.fingerprint_screen} · {item.fingerprint_memory_gb} GB
                  </option>
                ))}
              </select>
              {/* GPU/CPU/screen are picked together as one real device above
                  instead of mixed freely -- prevents e.g. an Android profile
                  ending up with a desktop NVIDIA GPU string, which is what a
                  real Android Chrome build could never actually report. */}
            </label>
          ) : (
            <>
              <label className="field">
                <span>GPU</span>
                <select
                  value={profileDraft.fingerprint_webgl_renderer}
                  onChange={(event) => {
                    const pattern = realisticWindowsFingerprintPatterns.find((item) =>
                      item.fingerprint_webgl_renderer === event.target.value);
                    if (pattern) {
                      setProfileDraft({...profileDraft, ...pattern});
                    }
                  }}
                >
                  <option value="">Auto</option>
                  {gpuPresets.map((item) => (
                    <option value={item.renderer} key={item.renderer}>{item.label}</option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Screen</span>
                <input
                  list="screen-presets"
                  value={profileDraft.fingerprint_screen}
                  onChange={(event) => setProfileDraft({...profileDraft, fingerprint_screen: event.target.value})}
                />
              </label>
              <label className="field">
                <span>CPU</span>
                <select
                  value={profileDraft.fingerprint_cpu_model}
                  onChange={(event) => {
                    const preset = cpuPresets.find((item) => item.model === event.target.value);
                    setProfileDraft({
                      ...profileDraft,
                      fingerprint_cpu_model: preset?.model || '',
                      fingerprint_cpu_cores: preset?.cores || profileDraft.fingerprint_cpu_cores,
                    });
                  }}
                >
                  <option value="">Auto</option>
                  {cpuPresets.map((item) => (
                    <option value={item.model} key={item.model}>{item.model} ({item.cores} threads)</option>
                  ))}
                </select>
              </label>
            </>
          )}
          <label className="field compact">
            <span>Memory GB</span>
            <select
              value={profileDraft.fingerprint_memory_gb}
              onChange={(event) => setProfileDraft({...profileDraft, fingerprint_memory_gb: event.target.value})}
            >
              {memoryPresets.map((item) => <option value={item} key={item}>{item} GB</option>)}
            </select>
          </label>
          <label className="field">
            <span>Media devices</span>
            <select
              value={profileDraft.fingerprint_media_devices}
              onChange={(event) => setProfileDraft({...profileDraft, fingerprint_media_devices: event.target.value})}
            >
              {mediaDevicePresets.map((item) => <option value={item} key={item}>{item}</option>)}
            </select>
          </label>
          <label className="check-field">
            <input
              checked={profileDraft.fingerprint_do_not_track}
              type="checkbox"
              onChange={(event) => setProfileDraft({...profileDraft, fingerprint_do_not_track: event.target.checked})}
            />
            <span>Do not track</span>
          </label>
          <label className="check-field wide">
            <input
              checked={profileDraft.fingerprint_rotate}
              type="checkbox"
              onChange={(event) => setProfileDraft({...profileDraft, fingerprint_rotate: event.target.checked})}
            />
            <span>Rotate fingerprint on each browser launch</span>
          </label>
        </section>
      </>
    );
  }

  const browserReady = resourceState?.browserStatus === 'ready';
  const browserFailed = resourceState?.browserStatus === 'error';
  const apiReady = apiState?.status === 'ready';
  const apiFailed = apiState?.status === 'error';
  const startupFailed = browserFailed || apiFailed;
  const startupBlocked = appBooting || !browserReady || !apiReady;
  const startupDetail = appBooting ?
    'Checking cloud session and loading workspace.' :
    browserFailed ?
      resourceState?.error || 'Argus Browser resource failed to install.' :
      apiFailed ?
        apiState?.error || 'Local API failed to start.' :
        !browserReady ?
          resourceState?.browserStatus === 'downloading' ?
            `Downloading Argus Browser ${resourceState.progress?.percent || 0}%` :
            resourceState?.browserStatus === 'installing' ?
              'Installing Argus Browser.' :
              'Checking Argus Browser resource.' :
          !apiReady ?
            'Starting local API.' :
            'Ready.';

  if (startupBlocked) {
    return (
      <main className="login-shell">
        <LoadingState
          label={startupFailed ? 'Argus Launcher is not ready' : 'Preparing Argus Launcher'}
          detail={startupDetail}
          failed={startupFailed}
          onRetry={browserFailed ? () => void native?.downloadBrowserResource?.().then(setResourceState) : undefined}
        />
      </main>
    );
  }

  if (!signedInEmail) {
    return (
      <main className="login-shell">
        <section className="login-panel">
          <Shield size={34} />
          <h1>Sign in to Argus Launcher</h1>
          <p>Cloud account required for profiles, proxies, bookmarks, and shared extensions.</p>
          <button type="button" className="google-button" onClick={signInWithGoogle} disabled={signInBusy}>
            <GoogleMark />
            Continue with Google
          </button>
          <div className="login-divider">
            <span />or<span />
          </div>
          <form className="login-form" onSubmit={signIn}>
            <input
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="Email"
              type="email"
              autoComplete="username"
              autoFocus
              required
            />
            <input
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Password"
              type="password"
              autoComplete="current-password"
              required
            />
            <button type="submit" disabled={signInBusy}>
              {signInBusy ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
          {signInError && <span className="message error">{signInError}</span>}
          <div className="login-links">
            <button type="button" className="link" onClick={() => openAccountPage('/signup')}>
              Create an account
            </button>
            <span aria-hidden="true">·</span>
            <button type="button" className="link" onClick={() => openAccountPage('/forgot-password')}>
              Forgot password?
            </button>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand">Argus Launcher</div>
        <nav>
          {tabs.map((tab) => (
            <button
              className={activeTab === tab.id ? 'active' : ''}
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </nav>
        <div className="account">
          <button className="account-row account-trigger" onClick={() => setSettingsOpen(true)}>
            <span>{initials(signedInEmail)}</span>
            <strong>{signedInEmail}</strong>
          </button>
        </div>
      </aside>

      <section className="content">
        <header className="topbar">
          <div>
            <h1>{tabs.find((tab) => tab.id === activeTab)?.label}</h1>
            <p>Argus Launcher owns cloud data. Argys Browser starts as a separate anonymous process.</p>
          </div>
          <div className="actions">
            {/* Only shown when the user is actually in more than one firm --
                the common case is one org, chosen silently. */}
            {org.orgs.length > 1 && (
              <label className="field">
                <span>Organization</span>
                <select
                  value={org.orgId || ''}
                  onChange={(event) => org.setOrgId(event.target.value)}
                >
                  {org.orgs.map((membership) => (
                    <option key={membership.org.id} value={membership.org.id}>
                      {membership.org.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {renderTopAction()}
          </div>
        </header>

        {renderActiveTab()}
      </section>

      <div className="toast-stack">
        {message && (
          <div className="status-toast" role="status">
            {message}
          </div>
        )}
        {renderUpdateToast()}
      </div>

      {renderSettingsModal()}
      {renderChangelogModal()}
      {renderExtensionAddModal()}
      {renderImportModal()}
      {renderOAuthApprovalModal()}
      {renderRevealedKeyModal()}

      {profileDraft && (
        <div className="modal-backdrop" onMouseDown={() => setProfileDraft(null)}>
          <section className="profile-modal" onMouseDown={(event) => event.stopPropagation()}>
            <header>
              <div>
                <h2>{profileDraft.id ? 'Edit profile' : 'Create profile'}</h2>
                <p>Cloud-backed profile settings used when Argys Browser launches anonymously.</p>
              </div>
              <button className="icon-button" aria-label="Close" onClick={() => setProfileDraft(null)}><X size={18} /></button>
            </header>

            <div className="profile-editor-layout">
            <div className="profile-form profile-editor-main">
              <label className="field wide">
                <span>Name</span>
                <input
                  autoFocus
                  value={profileDraft.name}
                  onChange={(event) => setProfileDraft({...profileDraft, name: event.target.value})}
                />
              </label>
              <label className="field">
                <span>Status</span>
                <div className="select-action">
                  <select
                    value={profileStatusOptions.includes(profileDraft.status) ? profileDraft.status : 'Ready'}
                    onChange={(event) => setProfileDraft({...profileDraft, status: event.target.value})}
                  >
                    {profileStatusOptions.map((status) => <option value={status} key={status}>{status}</option>)}
                  </select>
                  <button className="ghost" type="button" onClick={openNewStatus}>
                    <Plus size={16} /> Status
                  </button>
                </div>
              </label>
              <label className="field wide">
                <span>Proxy mode</span>
                <div className="segmented">
                  <button
                    type="button"
                    className={profileDraft.proxy_mode === 'assigned' ? 'active' : ''}
                    onClick={() => setProfileDraft({...profileDraft, proxy_mode: 'assigned'})}
                  >
                    Assigned proxy
                  </button>
                  <button
                    type="button"
                    className={profileDraft.proxy_mode === 'direct' ? 'active' : ''}
                    onClick={() => setProfileDraft({...profileDraft, proxy_mode: 'direct'})}
                  >
                    Direct
                  </button>
                  <button
                    type="button"
                    className={profileDraft.proxy_mode === 'free_proxy' ? 'active' : ''}
                    onClick={() => setProfileDraft({...profileDraft, proxy_mode: 'free_proxy'})}
                  >
                    Free Proxy
                  </button>
                </div>
                {profileDraft.proxy_mode === 'direct' && (
                  <p className="field-hint">No proxy, no fallback extension. Traffic goes out directly.</p>
                )}
                {profileDraft.proxy_mode === 'free_proxy' && (
                  <p className="field-hint">Uses the bundled FoxyWall Proxy extension instead of an assigned proxy.</p>
                )}
              </label>
              {profileDraft.proxy_mode === 'assigned' && (
                <label className="field">
                  <span>Proxy</span>
                  <div className="proxy-picker">
                    <input
                      list="profile-proxy-options"
                      placeholder="Search and select proxy"
                      value={profileProxyValue()}
                      onFocus={focusProfileProxyPicker}
                      onChange={(event) => updateProfileProxyValue(event.target.value)}
                      onBlur={commitProfileProxyValue}
                    />
                    <datalist id="profile-proxy-options">
                      {filteredProfileProxies().map((proxy) => (
                        <option value={proxyOptionLabel(proxy)} key={proxy.id} />
                      ))}
                    </datalist>
                    <div className="inline-action">
                      <input
                        placeholder="http://user:pass@host:port or socks5://..."
                        value={profileDraft.proxy_link}
                        onChange={(event) => setProfileDraft({...profileDraft, proxy_link: event.target.value})}
                      />
                      <button type="button" onClick={createProxyFromProfileLink}>Create new proxy</button>
                    </div>
                  </div>
                </label>
              )}
              <label className="field">
                <span>Folder</span>
                <select
                  value={profileDraft.folder_id}
                  onChange={(event) => setProfileDraft({...profileDraft, folder_id: event.target.value})}
                >
                  <option value="">All profiles</option>
                  {cloudState.folders.map((folder) => (
                    <option value={folder.id} key={folder.id}>{folder.name}</option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Color</span>
                <div className="color-row">
                  {profileColors.map((color) => (
                    <button
                      className={profileDraft.color === color ? 'swatch active' : 'swatch'}
                      key={color}
                      style={{background: color}}
                      type="button"
                      onClick={() => setProfileDraft({...profileDraft, color})}
                    />
                  ))}
                  <input
                    type="color"
                    value={profileDraft.color}
                    onChange={(event) => setProfileDraft({...profileDraft, color: event.target.value})}
                  />
                </div>
              </label>
              <label className="field wide">
                <span>Tags</span>
                <input
                  placeholder="warmup, facebook-cookies"
                  value={profileDraft.tags}
                  onChange={(event) => setProfileDraft({...profileDraft, tags: event.target.value})}
                />
              </label>
              <label className="field wide">
                <span>Start page</span>
                <input
                  placeholder="Leave empty for shared bookmarks home"
                  value={profileDraft.start_url}
                  onChange={(event) => setProfileDraft({...profileDraft, start_url: event.target.value})}
                />
              </label>
              <label className="field">
                <span>Account email</span>
                <input
                  type="email"
                  placeholder="Login for whatever account this profile is signed into"
                  value={profileDraft.email}
                  onChange={(event) => setProfileDraft({...profileDraft, email: event.target.value})}
                />
              </label>
              <label className="field">
                <span>Account password</span>
                <input
                  type="password"
                  autoComplete="new-password"
                  value={profileDraft.password}
                  onChange={(event) => setProfileDraft({...profileDraft, password: event.target.value})}
                />
              </label>
              <section className="form-section wide compact-section">
                <div>
                  <h3>Cookie import</h3>
                  <p>Upload a JSON or Netscape cookies.txt file to cloud sync and import it when this profile launches.</p>
                </div>
                <div className="file-row wide">
                  <button className="ghost" type="button" onClick={() => setCookiePickerOpen(true)}>
                    Select cookies…
                  </button>
                  {profileDraft.cookie_mode === 'saved' && profileDraft.cookie_id ? (
                    <>
                      <span>
                        {cookieLibraryLabel(profileDraft.cookie_id)}
                      </span>
                      <button
                        className="icon-button danger-icon"
                        type="button"
                        aria-label="Clear selected cookie-set"
                        onClick={clearSelectedCookie}
                      >
                        <Trash2 size={16} />
                      </button>
                    </>
                  ) : profileDraft.cookie_import_path || profileDraft.cookie_import_url ? (
                    <>
                      <span>
                        {profileDraft.cookie_import_count || 0} cookies · {profileDraft.cookie_import_name || (profileDraft.cookie_import_url ? 'Cloud cookie file' : profileDraft.cookie_import_path)}
                      </span>
                      <button
                        className="icon-button danger-icon"
                        type="button"
                        aria-label="Clear cookie import"
                        onClick={() => setProfileDraft({
                          ...profileDraft,
                          cookie_import_path: '',
                          cookie_import_url: '',
                          cookie_import_name: '',
                          cookie_import_count: 0,
                        })}
                      >
                        <Trash2 size={16} />
                      </button>
                    </>
                  ) : (
                    <span>No cookie file selected</span>
                  )}
                </div>
              </section>
              <section className="form-section wide compact-section fingerprint-card">
                <div>
                  <h3>Fingerprint</h3>
                  <p>{profileDraft.fingerprint_os} · {profileDraft.fingerprint_browser_version} · {profileDraft.fingerprint_webrtc}</p>
                </div>
                <button className="ghost" type="button" onClick={() => setFingerprintEditorOpen(true)}>
                  Edit fingerprint
                </button>
              </section>
              <label className="field wide">
                <span>Command line switches</span>
                <textarea
                  placeholder="--disable-features=ExampleFeature&#10;--lang=en-US"
                  value={profileDraft.command_line_switches}
                  onChange={(event) => setProfileDraft({...profileDraft, command_line_switches: event.target.value})}
                />
              </label>
            </div>
            <aside className="profile-summary">
              <div className="summary-heading">
                <h3>Summary</h3>
                <button
                  className="ghost"
                  type="button"
                  onClick={() => setProfileDraft({...profileDraft, ...randomFingerprintPatch(profileDraft.fingerprint_os)})}
                >
                  New fingerprint
                </button>
              </div>
              <div className="summary-list">
                {summaryRows().map(([label, value]) => (
                  <div className="summary-row" key={label}>
                    <strong>{label}</strong>
                    {Array.isArray(value) && label === 'Tags' ? (
                      <span className="summary-tags">
                        {value.length ? value.map((tag) => <em key={tag}>{tag}</em>) : '-'}
                      </span>
                    ) : Array.isArray(value) ? (
                      <span className="summary-lines">
                        {value.map((line) => <i key={line}>{line}</i>)}
                      </span>
                    ) : (
                      <span>{String(value || '-')}</span>
                    )}
                  </div>
                ))}
              </div>
            </aside>
            </div>

            <datalist id="language-presets">
              {languagePresets.map((item) => <option value={item} key={item} />)}
            </datalist>
            <datalist id="timezone-presets">
              {timezonePresets.map((item) => <option value={item} key={item} />)}
            </datalist>
            <datalist id="screen-presets">
              {screenPresets.map((item) => <option value={item} key={item} />)}
            </datalist>

            <footer className="modal-actions">
              {profileDraft.id && (
                <button className="danger ghost" onClick={deleteProfileDraft}><Trash2 size={16} /> Delete</button>
              )}
              <button
                  disabled={isActionPending('save-profile')}
                  onClick={() => runAsyncAction('save-profile', saveProfileDraft)}>
                {isActionPending('save-profile') && <RefreshCw size={16} className="btn-spin" />}
                {isActionPending('save-profile') ?
                    'Saving…' :
                    (profileDraft.id ? 'Save changes' : 'Create profile')}
              </button>
            </footer>
          </section>
        </div>
      )}

      {profileDraft && fingerprintEditorOpen && (
        <div className="modal-backdrop nested-backdrop" onMouseDown={() => setFingerprintEditorOpen(false)}>
          <section className="profile-modal fingerprint-modal" onMouseDown={(event) => event.stopPropagation()}>
            <header>
              <div>
                <h2>Edit fingerprint</h2>
                <p>Profile-level browser identity settings stored with cloud data.</p>
              </div>
              <button className="icon-button" aria-label="Close" onClick={() => setFingerprintEditorOpen(false)}><X size={18} /></button>
            </header>
            <div className="profile-form">
              {renderFingerprintFields()}
            </div>
            <footer className="modal-actions">
              <button
                className="ghost"
                onClick={() => setProfileDraft({...profileDraft, ...randomFingerprintPatch(profileDraft.fingerprint_os)})}
              >
                Rotate fingerprint
              </button>
              <button onClick={() => setFingerprintEditorOpen(false)}>Done</button>
            </footer>
          </section>
        </div>
      )}

      {renderCookiePickerModal()}

      {folderDraft && (
        <div className="modal-backdrop" onMouseDown={() => setFolderDraft(null)}>
          <section className="profile-modal small-modal" onMouseDown={(event) => event.stopPropagation()}>
            <header>
              <div>
                <h2>{folderDraft.id ? 'Edit folder' : 'Create folder'}</h2>
                <p>Folders organize launcher profiles only. Browser sessions stay separate.</p>
              </div>
              <button className="icon-button" aria-label="Close" onClick={() => setFolderDraft(null)}><X size={18} /></button>
            </header>

            <div className="profile-form">
              <label className="field wide">
                <span>Name</span>
                <input
                  autoFocus
                  placeholder="Warmup"
                  value={folderDraft.name}
                  onChange={(event) => setFolderDraft({...folderDraft, name: event.target.value})}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      void saveFolderDraft();
                    }
                  }}
                />
              </label>
            </div>

            <footer className="modal-actions">
              {folderDraft.id && (
                <button className="danger ghost" onClick={deleteFolderDraft}><Trash2 size={16} /> Delete</button>
              )}
              <button onClick={saveFolderDraft}>{folderDraft.id ? 'Save changes' : 'Create folder'}</button>
            </footer>
          </section>
        </div>
      )}

      {statusDraft && (
        <div className="modal-backdrop" onMouseDown={() => setStatusDraft(null)}>
          <section className="profile-modal small-modal" onMouseDown={(event) => event.stopPropagation()}>
            <header>
              <div>
                <h2>Create status</h2>
                <p>Custom statuses become available in every profile dropdown.</p>
              </div>
              <button className="icon-button" aria-label="Close" onClick={() => setStatusDraft(null)}><X size={18} /></button>
            </header>

            <div className="profile-form">
              <label className="field wide">
                <span>Name</span>
                <input
                  autoFocus
                  placeholder="Paused"
                  value={statusDraft.name}
                  onChange={(event) => setStatusDraft({...statusDraft, name: event.target.value})}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      void saveStatusDraft();
                    }
                  }}
                />
              </label>
            </div>

            <footer className="modal-actions">
              <button onClick={saveStatusDraft}>Create status</button>
            </footer>
          </section>
        </div>
      )}

      {proxyDraft && (
        <div className="modal-backdrop" onMouseDown={closeProxyDraft}>
          <section className="profile-modal" onMouseDown={(event) => event.stopPropagation()}>
            <header>
              <div>
                <h2>{proxyDraft.id ? 'Edit proxy' : proxyDraftSource === 'profile' ? 'Name your proxy' : 'Add proxy'}</h2>
                <p>{proxyDraftSource === 'profile' ?
                  'Create a proxy and assign it to this profile.' :
                  'Proxy settings are stored in Argus Launcher and assigned to profiles on launch.'}</p>
              </div>
              <button className="icon-button" aria-label="Close" onClick={closeProxyDraft}><X size={18} /></button>
            </header>

            <div className="profile-form">
              <label className="field wide">
                <span>Name</span>
                <input
                  autoFocus
                  placeholder="US socks proxy"
                  value={proxyDraft.name}
                  onChange={(event) => setProxyDraft({...proxyDraft, name: event.target.value})}
                />
              </label>
              <label className="field">
                <span>Type</span>
                <select
                  value={proxyDraft.type}
                  onChange={(event) => setProxyDraft({...proxyDraft, type: event.target.value as ProxyDraft['type']})}
                >
                  <option value="socks5">SOCKS5</option>
                  <option value="http">HTTP</option>
                </select>
              </label>
              <label className="field">
                <span>Host</span>
                <input
                  placeholder="1.2.3.4"
                  value={proxyDraft.host}
                  onChange={(event) => setProxyDraft({...proxyDraft, host: event.target.value})}
                />
              </label>
              <label className="field">
                <span>Port</span>
                <input
                  inputMode="numeric"
                  placeholder="1080"
                  value={proxyDraft.port}
                  onChange={(event) => setProxyDraft({...proxyDraft, port: event.target.value.replace(/[^\d]/g, '')})}
                />
              </label>
              <label className="field">
                <span>Username</span>
                <input
                  placeholder="Optional"
                  value={proxyDraft.username}
                  onChange={(event) => setProxyDraft({...proxyDraft, username: event.target.value})}
                />
              </label>
              <label className="field wide">
                <span>Password</span>
                <input
                  placeholder="Optional"
                  type="password"
                  value={proxyDraft.password}
                  onChange={(event) => setProxyDraft({...proxyDraft, password: event.target.value})}
                />
              </label>
            </div>

            <footer className="modal-actions">
              {proxyDraft.id && (
                <button className="danger ghost" onClick={deleteProxyDraft}><Trash2 size={16} /> Delete</button>
              )}
              <button onClick={saveProxyDraft}>
                {proxyDraft.id ? 'Save changes' : proxyDraftSource === 'profile' ? 'Create and assign' : 'Add proxy'}
              </button>
            </footer>
          </section>
        </div>
      )}

      {bookmarkDraft && (
        <div className="modal-backdrop" onMouseDown={() => setBookmarkDraft(null)}>
          <section className="profile-modal" onMouseDown={(event) => event.stopPropagation()}>
            <header>
              <div>
                <h2>{bookmarkDraft.originalUrl ? 'Edit bookmark' : 'Add bookmark'}</h2>
                <p>Shared bookmarks are injected into each anonymous browser home page.</p>
              </div>
              <button className="icon-button" aria-label="Close" onClick={() => setBookmarkDraft(null)}><X size={18} /></button>
            </header>

            <div className="profile-form">
              <label className="field wide">
                <span>Name</span>
                <input
                  autoFocus
                  placeholder="Facebook"
                  value={bookmarkDraft.title}
                  onChange={(event) => setBookmarkDraft({...bookmarkDraft, title: event.target.value})}
                />
              </label>
              <label className="field wide">
                <span>URL</span>
                <input
                  placeholder="https://www.facebook.com/"
                  value={bookmarkDraft.url}
                  onChange={(event) => setBookmarkDraft({...bookmarkDraft, url: event.target.value})}
                />
              </label>
              <label className="field wide">
                <span>Icon URL</span>
                <input
                  placeholder="Optional favicon URL"
                  value={bookmarkDraft.icon}
                  onChange={(event) => setBookmarkDraft({...bookmarkDraft, icon: event.target.value})}
                />
              </label>
            </div>

            <footer className="modal-actions">
              {bookmarkDraft.originalUrl && (
                <button className="danger ghost" onClick={deleteBookmarkDraft}><Trash2 size={16} /> Delete</button>
              )}
              <button onClick={saveBookmarkDraft}>{bookmarkDraft.originalUrl ? 'Save changes' : 'Add bookmark'}</button>
            </footer>
          </section>
        </div>
      )}

      {proxyDeleteRequest && (
        <div className="modal-backdrop" onMouseDown={() => {
          setProxyDeleteRequest(null);
          setProxyDeleteAck(false);
        }}>
          <section className="profile-modal small-modal" onMouseDown={(event) => event.stopPropagation()}>
            <header>
              <div>
                <h2>Delete {proxyDeleteRequest.label}?</h2>
              </div>
              <button
                className="icon-button"
                aria-label="Close"
                onClick={() => {
                  setProxyDeleteRequest(null);
                  setProxyDeleteAck(false);
                }}
              >
                <X size={18} />
              </button>
            </header>
            <p className="error-detail">
              {proxyDeleteRequest.affectedProfiles > 0 ?
                `This will permanently remove ${proxyDeleteRequest.proxyIds.length === 1 ? 'this proxy' : 'these proxies'} and unassign ${proxyDeleteRequest.affectedProfiles === 1 ? 'it' : 'them'} from ${proxyDeleteRequest.affectedProfiles} ${proxyDeleteRequest.affectedProfiles === 1 ? 'profile' : 'profiles'}. Those profiles will be blocked from launching until a new proxy is assigned.` :
                `This will permanently remove ${proxyDeleteRequest.proxyIds.length === 1 ? 'this proxy' : 'these proxies'}. No profile is currently assigned to it.`}
            </p>
            <label className="checkbox-confirm">
              <input
                type="checkbox"
                checked={proxyDeleteAck}
                onChange={(event) => setProxyDeleteAck(event.target.checked)}
              />
              <span>I understand this cannot be undone.</span>
            </label>
            <footer className="modal-actions">
              <button
                className="ghost"
                onClick={() => {
                  setProxyDeleteRequest(null);
                  setProxyDeleteAck(false);
                }}
              >
                Cancel
              </button>
              <button className="danger" onClick={confirmDeleteProxies}>
                <Trash2 size={16} /> Delete
              </button>
            </footer>
          </section>
        </div>
      )}

      {profileDeleteRequest && (
        <div className="modal-backdrop" onMouseDown={() => {
          setProfileDeleteRequest(null);
          setProfileDeleteRemoveProxy(false);
        }}>
          <section className="profile-modal small-modal" onMouseDown={(event) => event.stopPropagation()}>
            <header>
              <div>
                <h2>Delete {profileDeleteRequest.label}?</h2>
              </div>
              <button
                className="icon-button"
                aria-label="Close"
                onClick={() => {
                  setProfileDeleteRequest(null);
                  setProfileDeleteRemoveProxy(false);
                }}
              >
                <X size={18} />
              </button>
            </header>
            <p className="error-detail">
              Moved to Trash for {TRASH_RETENTION_DAYS} days (Profiles tab &rarr; Trash), then permanently deleted. You can restore
              {profileDeleteRequest.profileIds.length === 1 ? ' it' : ' them'} any time before that.
            </p>
            {profileDeleteRequest.exclusiveProxyIds.length > 0 && (
              <label className="checkbox-confirm">
                <input
                  type="checkbox"
                  checked={profileDeleteRemoveProxy}
                  onChange={(event) => setProfileDeleteRemoveProxy(event.target.checked)}
                />
                <span>
                  Also permanently delete {profileDeleteRequest.exclusiveProxyIds.length === 1 ? 'the proxy' : `the ${profileDeleteRequest.exclusiveProxyIds.length} proxies`} assigned
                  {profileDeleteRequest.profileIds.length === 1 ? ' to this profile' : ' to these profiles'} now (not used by any other profile). Proxies aren't moved to Trash.
                </span>
              </label>
            )}
            <footer className="modal-actions">
              <button
                className="ghost"
                onClick={() => {
                  setProfileDeleteRequest(null);
                  setProfileDeleteRemoveProxy(false);
                }}
              >
                Cancel
              </button>
              <button
                className="danger"
                disabled={isActionPending('delete-profiles')}
                onClick={() => runAsyncAction('delete-profiles', confirmDeleteProfiles)}
              >
                {isActionPending('delete-profiles') ?
                    <RefreshCw size={16} className="btn-spin" /> :
                    <Trash2 size={16} />}
                {isActionPending('delete-profiles') ? 'Deleting…' : 'Delete'}
              </button>
            </footer>
          </section>
        </div>
      )}

      {errorDialog && (
        <div className="modal-backdrop" onMouseDown={() => setErrorDialog(null)}>
          <section className="profile-modal small-modal error-modal" onMouseDown={(event) => event.stopPropagation()}>
            <header>
              <div>
                <h2>{errorDialog.title}</h2>
              </div>
              <button className="icon-button" aria-label="Close" onClick={() => setErrorDialog(null)}><X size={18} /></button>
            </header>
            <p className="error-detail">{errorDialog.detail}</p>
            <footer className="modal-actions">
              <button className="ghost" onClick={() => navigator.clipboard.writeText(errorDialog.detail)}>Copy error</button>
              <button onClick={() => setErrorDialog(null)}>Close</button>
            </footer>
          </section>
        </div>
      )}
    </main>
  );
}

// OrgProvider owns the auth subscription and resolves which organization's data
// App should show, so it has to sit above App rather than inside it.
createRoot(document.getElementById('root')!).render(
    <OrgProvider>
      <App />
    </OrgProvider>,
);
