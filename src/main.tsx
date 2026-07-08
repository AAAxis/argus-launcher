import React, {useEffect, useMemo, useRef, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {Cookie, Download, Pencil, Plus, Play, RefreshCw, Shield, Trash2, Upload, X} from 'lucide-react';
import {native} from './native';
import type {ApiState, CookieFileSelection, ResourceState, UpdateState} from './native';
import {supabase} from './supabase';
import type {ArgusFolder, ArgusProfile, ArgusProxy, BuiltInExtensionToggles, CloudState, ProxyMode, RuntimeFingerprint, SharedBookmark, SharedExtension} from './types';
import {useAsyncAction} from './useAsyncAction';
import './styles.css';

type TabId = 'profiles' | 'proxies' | 'bookmarks' | 'extensions' | 'api' | 'import';

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
  {id: 'bookmarks', label: 'Bookmarks'},
  {id: 'extensions', label: 'Extensions'},
  {id: 'api', label: 'API'},
  {id: 'import', label: 'Import'},
];

const API_BASE_URL = 'http://127.0.0.1:39219';
const SHARED_EXTENSIONS_BUCKET = 'global';
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

const defaultState: CloudState = {
  profiles: [],
  folders: [],
  proxies: [],
  shared_extensions: [],
  shared_bookmarks: [],
  custom_statuses: [],
};

const baseProfileStatuses = ['Ready', 'Active', 'Warmup', 'Ban', 'Review'];
// Sentinel folder_id used to view Trash in the profiles folder bar; never
// written to a profile's actual folder_id.
const TRASH_FOLDER_ID = '__trash__';
const TRASH_RETENTION_DAYS = 30;

function daysUntilPurge(deletedAt: string): number {
  const purgeAt = Date.parse(deletedAt) + TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  return Math.max(0, Math.ceil((purgeAt - Date.now()) / (24 * 60 * 60 * 1000)));
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

function countryFlag(countryCode?: string) {
  const code = countryCode?.trim().toUpperCase();
  if (!code || code.length !== 2) {
    return '--';
  }
  return code;
}

const socialBookmarks: SharedBookmark[] = [
  {title: 'Reddit', url: 'https://www.reddit.com/'},
  {title: 'Instagram', url: 'https://www.instagram.com/'},
  {title: 'TikTok', url: 'https://www.tiktok.com/'},
  {title: 'Facebook', url: 'https://www.facebook.com/'},
];

let sharedBookmarksColumnAvailable = true;
let foldersColumnAvailable = true;
let customStatusesColumnAvailable = true;
let builtInExtensionsColumnAvailable = true;

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

function isMissingColumnError(error: {message?: string; code?: string} | null) {
  return Boolean(error?.message?.includes('shared_bookmarks') ||
      error?.message?.includes('folders') ||
      error?.message?.includes('custom_statuses') ||
      error?.code === '42703' ||
      error?.code === 'PGRST204');
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

function randomFingerprintPatch(): Partial<ProfileDraft> {
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

function userAgentForFingerprint(os?: string, browserVersion?: string): string {
  const chromeVersion = browserVersion === 'Auto' || !browserVersion ?
    '149.0.0.0' :
    browserVersion.replace('Chrome ', '') + '.0.0.0';
  switch (os) {
    case 'Android':
      return `Mozilla/5.0 (Linux; Android 14; Pixel 8 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion} Mobile Safari/537.36`;
    case 'iOS':
      return 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
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
  return {
    platform: fingerprintPlatformFor(preset, fingerprint.os),
    ua_string: fingerprint.user_agent || userAgentForFingerprint(fingerprint.os, fingerprint.browser_version),
    preset,
    seed: rotate ? randomSeed() : stableSeedFor(profile.id),
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

function isSupabaseStorageNotWritable(error: {message?: string; statusCode?: string} | null) {
  const message = error?.message?.toLowerCase() || '';
  return message.includes('bucket not found') ||
      message.includes('bucket') && message.includes('not found') ||
      message.includes('row-level security') ||
      message.includes('permission') ||
      message.includes('unauthorized') ||
      error?.statusCode === '404';
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

function PaginationBar({page, totalPages, total, pageSize, onPage, onPageSize}: {
  page: number;
  totalPages: number;
  total: number;
  pageSize: number;
  onPage: (page: number) => void;
  onPageSize: (size: number) => void;
}) {
  if (total === 0) {
    return null;
  }
  const start = page * pageSize + 1;
  const end = Math.min(total, (page + 1) * pageSize);
  return (
    <section className="pagination-bar">
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

function App() {
  const [email, setEmail] = useState('holylabsltd@gmail.com');
  const [password, setPassword] = useState('');
  const [signedInEmail, setSignedInEmail] = useState('');
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
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedFolderId, setSelectedFolderId] = useState('');
  const [profileSearch, setProfileSearch] = useState('');
  const [profileStatusFilter, setProfileStatusFilter] = useState('');
  const [profileProxyFilter, setProfileProxyFilter] = useState<'' | 'assigned' | 'unassigned'>('');
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
  const [apiToken, setApiToken] = useState('argys_api_token');
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

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        if (!supabase) {
          return;
        }
        const {data} = await supabase.auth.getUser();
        if (cancelled) {
          return;
        }
        if (data.user?.email) {
          setSignedInEmail(data.user.email);
          setApiToken(tokenForEmail(data.user.email));
          await loadCloudState();
        }
      } finally {
        if (!cancelled) {
          setAppBooting(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

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
      let nextState = cloudState;
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
          nextState = {
            ...nextState,
            proxies: nextState.proxies.map((item) =>
              item.id === proxy.id ? checkedProxy : item),
          };
          await saveCloudState(nextState);
        } catch (error) {
          const checkedProxy: ArgusProxy = {
            ...proxy,
            checked_at: new Date().toISOString(),
            check_error: error instanceof Error ? error.message : String(error),
          };
          nextState = {
            ...nextState,
            proxies: nextState.proxies.map((item) =>
              item.id === proxy.id ? checkedProxy : item),
          };
          await saveCloudState(nextState);
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
        const profiles = cloudState.profiles.map((item) =>
          item.id === profile.id ? {...item, ...cloudCookie} : item);
        await saveCloudState({...cloudState, profiles});
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
        }
        const nextState = repairProxyAssignments({...cloudState, proxies}).state;
        await saveCloudState(nextState);
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
        const profiles = cloudState.profiles.map((profile) =>
          profile.id === profileId ? {
            ...profile,
            proxy_id: proxy.id,
            proxy_mode: 'assigned' as const,
          } : profile);
        await saveCloudState({...cloudState, profiles});
        sendResult(requestId, {matched: true, profileId, proxyId: proxy.id});
        setMessage(`Assigned ${proxy.host}:${proxy.port} to ${profileId}`);
      } catch (error) {
        sendResult(requestId, undefined, error instanceof Error ? error.message : String(error));
      }
    });
  }, [cloudState]);

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

  async function loadCloudState() {
    setCloudLoading(true);
    if (!supabase) {
      setMessage('Supabase env is missing in .env');
      setCloudLoading(false);
      return;
    }
    try {
      const {data: userData} = await supabase.auth.getUser();
      const userId = userData.user?.id;
      if (!userId) {
        return;
      }
      const {data, error}: {data: any; error: any} = await supabase
          .from('argus_cloud_state')
          .select('profiles,folders,proxies,shared_extensions')
          .eq('user_id', userId)
          .maybeSingle();
      if (error) {
        setMessage(error.message);
        return;
      }
      let sharedBookmarks: SharedBookmark[] = [];
      if (sharedBookmarksColumnAvailable) {
        const result = await supabase
            .from('argus_cloud_state')
            .select('shared_bookmarks')
            .eq('user_id', userId)
            .maybeSingle();
        if (isMissingColumnError(result.error)) {
          sharedBookmarksColumnAvailable = false;
        } else if (result.error) {
          setMessage(result.error.message);
        } else if (Array.isArray(result.data?.shared_bookmarks)) {
          sharedBookmarks = result.data.shared_bookmarks;
        }
      }
      let customStatuses: string[] = [];
      if (customStatusesColumnAvailable) {
        const result = await supabase
            .from('argus_cloud_state')
            .select('custom_statuses')
            .eq('user_id', userId)
            .maybeSingle();
        if (isMissingColumnError(result.error)) {
          customStatusesColumnAvailable = false;
        } else if (result.error) {
          setMessage(result.error.message);
        } else if (Array.isArray(result.data?.custom_statuses)) {
          customStatuses = result.data.custom_statuses;
        }
      }
      let builtInExtensions: BuiltInExtensionToggles | undefined;
      if (builtInExtensionsColumnAvailable) {
        const result = await supabase
            .from('argus_cloud_state')
            .select('built_in_extensions')
            .eq('user_id', userId)
            .maybeSingle();
        if (isMissingColumnError(result.error)) {
          builtInExtensionsColumnAvailable = false;
        } else if (result.error) {
          setMessage(result.error.message);
        } else if (result.data?.built_in_extensions) {
          builtInExtensions = result.data.built_in_extensions;
        }
      }
      const mergedBookmarks = mergeBookmarks(sharedBookmarks, socialBookmarks);
      const nextState = {
        profiles: Array.isArray(data?.profiles) ? data.profiles : [],
        folders: Array.isArray(data?.folders) ? data.folders : [],
        proxies: Array.isArray(data?.proxies) ? data.proxies : [],
        shared_extensions: Array.isArray(data?.shared_extensions) ?
          data.shared_extensions :
          [],
        shared_bookmarks: mergedBookmarks.bookmarks,
        custom_statuses: customStatuses,
        built_in_extensions: builtInExtensions,
      };
      const {state: repairedState, repaired} = repairProxyAssignments(nextState);
      const {state: purgedState, purged} = purgeExpiredTrash(repairedState);
      setCloudState(purgedState);
      setSelectedId(purgedState.profiles.find((profile) => !profile.deleted_at)?.id || null);
      if (repaired > 0 || mergedBookmarks.changed || purged > 0) {
        await saveCloudState(purgedState);
      }
      if (repaired > 0 || mergedBookmarks.changed || purged > 0) {
        setMessage(`${repaired ? `Repaired ${repaired} proxy assignments` : ''}${repaired && mergedBookmarks.changed ? ' · ' : ''}${mergedBookmarks.changed ? 'Added social bookmarks' : ''}${purged ? `${repaired || mergedBookmarks.changed ? ' · ' : ''}Purged ${purged} trashed ${purged === 1 ? 'profile' : 'profiles'}` : ''}`);
      }
    } finally {
      setCloudLoading(false);
    }
  }

  // Returns whether the write actually reached Supabase, so callers can tell
  // a genuine save apart from one that only updated local state -- without
  // this, every "$name saved" toast fired unconditionally, even when the
  // Supabase upsert failed, silently losing the change on the next reload.
  async function saveCloudState(nextState: CloudState): Promise<boolean> {
    setCloudState(nextState);
    if (!supabase) {
      return true;
    }
    const {data: userData} = await supabase.auth.getUser();
    const userId = userData.user?.id;
    if (!userId) {
      return false;
    }
    const payload: Record<string, unknown> = {
      user_id: userId,
      profiles: nextState.profiles,
      proxies: nextState.proxies,
      shared_extensions: nextState.shared_extensions,
      updated_at: new Date().toISOString(),
    };
    if (foldersColumnAvailable) {
      payload.folders = nextState.folders;
    }
    if (sharedBookmarksColumnAvailable) {
      payload.shared_bookmarks = nextState.shared_bookmarks;
    }
    if (customStatusesColumnAvailable) {
      payload.custom_statuses = nextState.custom_statuses;
    }
    if (builtInExtensionsColumnAvailable) {
      payload.built_in_extensions = nextState.built_in_extensions;
    }
    let {error} = await supabase
        .from('argus_cloud_state')
        .upsert(payload, {onConflict: 'user_id'});
    if (isMissingColumnError(error)) {
      if (error?.message?.includes('shared_bookmarks')) {
        sharedBookmarksColumnAvailable = false;
        delete payload.shared_bookmarks;
      }
      if (error?.message?.includes('folders')) {
        foldersColumnAvailable = false;
        delete payload.folders;
      }
      if (error?.message?.includes('custom_statuses')) {
        customStatusesColumnAvailable = false;
        delete payload.custom_statuses;
      }
      if (error?.message?.includes('built_in_extensions')) {
        builtInExtensionsColumnAvailable = false;
        delete payload.built_in_extensions;
      }
      const fallback = await supabase
          .from('argus_cloud_state')
          .upsert(payload, {onConflict: 'user_id'});
      error = fallback.error;
    }
    if (error) {
      setMessage(error.message);
      return false;
    }
    return true;
  }

  async function signIn() {
    if (!supabase) {
      setMessage('Supabase env is missing in .env');
      return;
    }
    const {data, error} = await supabase.auth.signInWithPassword({email, password});
    if (error) {
      setMessage(error.message);
      return;
    }
    setSignedInEmail(data.user.email || email);
    setApiToken(tokenForEmail(data.user.email || email));
    setPassword('');
    await loadCloudState();
  }

  async function signOut() {
    await supabase?.auth.signOut();
    setSignedInEmail('');
    setApiToken('argys_api_token');
    setCloudState(defaultState);
    setSelectedId(null);
    setSelectedFolderId('');
  }

  function tokenForEmail(value: string) {
    let hash = 0x811c9dc5;
    const normalized = value.trim().toLowerCase();
    for (let i = 0; i < normalized.length; i++) {
      hash ^= normalized.charCodeAt(i);
      hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) +
          (hash << 24);
    }
    return `argys_${normalized.replace(/[^a-z0-9]/g, '_')}_${(hash >>> 0).toString(16).padStart(8, '0')}`;
  }

  function authHeader() {
    return `Authorization: Bearer ${apiToken || 'argys_api_token'}`;
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
// Argys Anty Browser API example.
// Keep Argys Anty open and signed in while running this script.

const BASE_URL = ${JSON.stringify(API_BASE_URL)};
const TOKEN = ${JSON.stringify(apiToken || 'argys_api_token')};

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
    const byProxy = profileProxyFilter ?
      byStatus.filter((profile) =>
        Boolean(proxyFor(profile)) === (profileProxyFilter === 'assigned')) :
      byStatus;
    const query = profileSearch.trim().toLowerCase();
    if (!query) {
      return byProxy;
    }
    return byProxy.filter((profile) =>
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
        const rotated = fingerprintFromDraftPatch(randomFingerprintPatch());
        launchProfile = {...profile, fingerprint: {...profile.fingerprint, ...rotated, rotate_on_launch: true}};
        const profiles = cloudState.profiles.map((item) =>
          item.id === profile.id ? launchProfile : item);
        await saveCloudState({...cloudState, profiles});
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
              detail: 'Native proxy checker is not available. Restart Argys Anty and try again.',
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
            const profiles = cloudState.profiles.map((item) =>
              item.id === launchProfile.id ? launchProfile : item);
            const proxies = cloudState.proxies.map((item) =>
              item.id === checkedProxy.id ? checkedProxy : item);
            await saveCloudState({...cloudState, profiles, proxies});
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
        cookieImportPath: launchProfile.cookie_import_path || null,
        cookieImportUrl: launchProfile.cookie_import_url || null,
        cookieImportName: launchProfile.cookie_import_name || null,
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

  async function updateProfile(profile: ArgusProfile, patch: Partial<ArgusProfile>) {
    const profiles = cloudState.profiles.map((item) =>
      item.id === profile.id ? {...item, ...patch} : item);
    await saveCloudState({...cloudState, profiles});
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
      const folders = cloudState.folders.map((item) =>
        item.id === folderDraft.id ? {...item, name} : item);
      await saveCloudState({...cloudState, folders});
      setFolderDraft(null);
      setMessage(`${name} folder saved`);
      return;
    }
    const folder: ArgusFolder = {
      id: globalThis.crypto?.randomUUID?.() || `${Date.now()}`,
      name,
      created_at: new Date().toISOString(),
    };
    await saveCloudState({...cloudState, folders: [...cloudState.folders, folder]});
    setSelectedFolderId(folder.id);
    setFolderDraft(null);
    setMessage(`${folder.name} folder created`);
  }

  async function deleteFolder(folder: ArgusFolder) {
    if (!window.confirm(`Delete folder ${folder.name}? Profiles will move to All profiles.`)) {
      return;
    }
    const folders = cloudState.folders.filter((item) => item.id !== folder.id);
    const profiles = cloudState.profiles.map((profile) =>
      profile.folder_id === folder.id ? {...profile, folder_id: null} : profile);
    await saveCloudState({...cloudState, folders, profiles});
    setSelectedFolderId('');
    setMessage(`${folder.name} folder deleted`);
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
    const statuses = statusList(
        cloudState.custom_statuses,
        baseProfileStatuses.includes(name) ? [] : [name]);
    await saveCloudState({...cloudState, custom_statuses: statuses});
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
    const profiles = profileDraft.id ?
      cloudState.profiles.map((item) => item.id === profile.id ? profile : item) :
      [...cloudState.profiles, profile];
    const ok = await saveCloudState({...cloudState, profiles});
    if (!ok) {
      // saveCloudState already surfaced the real Supabase error via
      // setMessage; don't overwrite it with a false "saved" toast, and keep
      // the dialog open so the user's edits aren't lost.
      return;
    }
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
    const profiles = cloudState.profiles.map((item) =>
      profileIds.includes(item.id) ? {...item, deleted_at: deletedAt} : item);
    const proxies = profileDeleteRemoveProxy ?
      cloudState.proxies.filter((proxy) => !exclusiveProxyIds.includes(proxy.id)) :
      cloudState.proxies;
    await saveCloudState({...cloudState, profiles, proxies});
    if (selectedId && profileIds.includes(selectedId)) {
      setSelectedId(profiles.find((item) => !item.deleted_at)?.id || null);
    }
    setSelectedProfileIds(new Set());
    setProfileDraft(null);
    setMessage(`${label} moved to Trash${profileDeleteRemoveProxy && exclusiveProxyIds.length ? ' with its proxy deleted' : ''}`);
    setProfileDeleteRequest(null);
    setProfileDeleteRemoveProxy(false);
  }

  async function restoreProfile(profile: ArgusProfile) {
    const profiles = cloudState.profiles.map((item) =>
      item.id === profile.id ? {...item, deleted_at: null} : item);
    await saveCloudState({...cloudState, profiles});
    setMessage(`${profile.name} restored`);
  }

  async function permanentlyDeleteProfile(profile: ArgusProfile) {
    if (!window.confirm(`Permanently delete ${profile.name}? This cannot be undone.`)) {
      return;
    }
    const profiles = cloudState.profiles.filter((item) => item.id !== profile.id);
    await saveCloudState({...cloudState, profiles});
    setMessage(`${profile.name} permanently deleted`);
  }

  async function restoreSelectedProfiles() {
    if (!selectedProfileIds.size) {
      return;
    }
    const count = selectedProfileIds.size;
    const profiles = cloudState.profiles.map((item) =>
      selectedProfileIds.has(item.id) ? {...item, deleted_at: null} : item);
    await saveCloudState({...cloudState, profiles});
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
    const profiles = cloudState.profiles.filter((item) => !selectedProfileIds.has(item.id));
    await saveCloudState({...cloudState, profiles});
    setSelectedProfileIds(new Set());
    setMessage(`${count} ${count === 1 ? 'profile' : 'profiles'} permanently deleted`);
  }

  // Auto-purge: profiles trashed more than TRASH_RETENTION_DAYS ago are
  // permanently removed. Called once after cloud state loads (see
  // loadCloudState), matching the existing proxy-assignment-repair pattern.
  function purgeExpiredTrash(state: CloudState): {state: CloudState; purged: number} {
    const cutoff = Date.now() - TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000;
    const profiles = state.profiles.filter((profile) =>
      !profile.deleted_at || Date.parse(profile.deleted_at) > cutoff);
    return {state: {...state, profiles}, purged: state.profiles.length - profiles.length};
  }

  async function pickImportCsv() {
    if (!native?.selectImportCsv) {
      setMessage('Native CSV picker is not available. Restart Argys Anty and try again.');
      return;
    }
    const result = await native.selectImportCsv();
    if (!result) {
      return;
    }
    const rows = parseCsv(result.content);
    setImportResult(null);
    setImportFile({path: result.path, rows});
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
            folderIdByCsvValue.set(csvFolder, folder.id);
            folderId = folder.id;
            foldersCreated++;
          }
        }

        const importId = (row.profile_id || '').trim() ||
          globalThis.crypto?.randomUUID?.() || `${Date.now()}`;
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
      }

      await saveCloudState({...cloudState, profiles, proxies, folders});
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
    const proxies = proxyDraft.id ?
      cloudState.proxies.map((item) => item.id === proxy.id ? proxy : item) :
      [...cloudState.proxies, proxy];
    await saveCloudState({...cloudState, proxies});
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
      setMessage('Native proxy checker is not available. Restart Argys Anty and try again.');
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
      const proxies = cloudState.proxies.map((item) =>
        item.id === proxy.id ? checkedProxy : item);
      await saveCloudState({...cloudState, proxies});
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
    const proxies = cloudState.proxies.filter((item) => !proxyIds.includes(item.id));
    const profiles = cloudState.profiles.map((profile) =>
      profile.proxy_id && proxyIds.includes(profile.proxy_id) ?
        {...profile, proxy_id: null} :
        profile);
    await saveCloudState({...cloudState, proxies, profiles});
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
      setMessage('Native file export is not available. Restart Argys Anty and try again.');
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
      setMessage('Native file export is not available. Restart Argys Anty and try again.');
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
    const profiles = cloudState.profiles.map((profile) =>
      selectedProfileIds.has(profile.id) ? {...profile, folder_id: nextFolderId} : profile);
    await saveCloudState({...cloudState, profiles});
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
      throw new Error('Native cookie import is not available. Restart Argys Anty and try again.');
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
    const profiles = cloudState.profiles.map((profile) => {
      const patch = isTarget(profile) ? cookiePatches.get(profile.id) : undefined;
      if (!patch) {
        return profile;
      }
      return {...profile, ...patch};
    });
    await saveCloudState({...cloudState, profiles});
    return {matched, total: selected.length};
  }

  async function importCookiesForSelectedProfiles() {
    if (!selectedProfileIds.size) {
      return;
    }
    if (!native?.selectCookieFolder || !native?.matchCookieFiles) {
      setMessage('Native cookie import is not available. Restart Argys Anty and try again.');
      return;
    }
    const folderPath = await native.selectCookieFolder();
    if (!folderPath) {
      return;
    }
    const {matched, total} = await matchCookiesToProfiles(folderPath, [...selectedProfileIds]);
    setMessage(`Matched cookies for ${matched} of ${total} selected profiles`);
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
    const bookmarks = cloudState.shared_bookmarks.filter(
        (item) => item.url !== (bookmarkDraft.originalUrl || bookmark.url));
    await saveCloudState({
      ...cloudState,
      shared_bookmarks: [...bookmarks, bookmark],
    });
    setBookmarkDraft(null);
    setMessage(`${bookmark.title} saved`);
  }

  async function deleteBookmarkDraft() {
    if (!bookmarkDraft?.originalUrl) {
      setBookmarkDraft(null);
      return;
    }
    await saveCloudState({
      ...cloudState,
      shared_bookmarks: cloudState.shared_bookmarks.filter(
          (bookmark) => bookmark.url !== bookmarkDraft.originalUrl),
    });
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
      setMessage('Native folder picker is not available. Restart Argys Anty and try again.');
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
    const bytes = Uint8Array.from(atob(zipped.base64), (c) => c.charCodeAt(0));
    const objectPath = `shared-extensions/${id}.zip`;
    const {error: uploadError} = await supabase.storage
        .from(SHARED_EXTENSIONS_BUCKET)
        .upload(objectPath, bytes, {contentType: 'application/zip', upsert: true});
    let storageUrl = '';
    let usedInlinePackage = false;
    if (uploadError && isSupabaseStorageNotWritable(uploadError)) {
      storageUrl = `data:application/zip;base64,${zipped.base64}`;
      usedInlinePackage = true;
    } else if (uploadError) {
      setMessage(`Upload failed: ${uploadError.message}`);
      return;
    } else {
      const {data: publicUrlData} = supabase.storage.from(SHARED_EXTENSIONS_BUCKET).getPublicUrl(objectPath);
      storageUrl = publicUrlData.publicUrl;
    }
    const nextExtension: SharedExtension = {
      id,
      name,
      source: 'local',
      storageUrl,
    };
    await saveCloudState({
      ...cloudState,
      shared_extensions: [...cloudState.shared_extensions, nextExtension],
    });
    setExtensionAddOpen(false);
    setMessage(usedInlinePackage ?
      `${name} shared inline. Check the ${SHARED_EXTENSIONS_BUCKET} storage bucket for large extensions.` :
      `${name} shared with your team`);
  }

  // Web Store extensions need no upload at all -- every team member
  // downloads/unpacks the same published CRX directly from Google's own CDN
  // the first time they launch a profile that uses it.
  async function addExtensionFromWebStoreLink(input: string) {
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
      name: webstoreId,
      source: 'webstore',
      webstoreId,
    };
    await saveCloudState({
      ...cloudState,
      shared_extensions: [...cloudState.shared_extensions, nextExtension],
    });
    setExtensionAddOpen(false);
    setWebstoreLinkInput('');
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
    if (!supabase) {
      return {...base, cookie_import_url: `data:text/plain;base64,${selection.base64}`};
    }
    const safeName = cookieName.replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '') || 'cookies.txt';
    const objectPath = `profile-cookies/${profileId}/${Date.now()}-${safeName}`;
    const bytes = Uint8Array.from(atob(selection.base64), (c) => c.charCodeAt(0));
    const {error: uploadError} = await supabase.storage
        .from(SHARED_EXTENSIONS_BUCKET)
        .upload(objectPath, bytes, {contentType: 'text/plain', upsert: true});
    if (uploadError && isSupabaseStorageNotWritable(uploadError)) {
      return {...base, cookie_import_url: `data:text/plain;base64,${selection.base64}`};
    }
    if (uploadError) {
      throw new Error(`Cookie upload failed: ${uploadError.message}`);
    }
    const {data: publicUrlData} = supabase.storage.from(SHARED_EXTENSIONS_BUCKET).getPublicUrl(objectPath);
    return {...base, cookie_import_url: publicUrlData.publicUrl};
  }

  async function pickProfileCookieFile() {
    if (!profileDraft) {
      return;
    }
    if (!native?.selectCookieFile) {
      setMessage('Native cookie file picker is not available. Restart Argys Anty and try again.');
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

  async function removeExtension(id: string) {
    await saveCloudState({
      ...cloudState,
      shared_extensions: cloudState.shared_extensions.filter(
          (extension) => extension.id !== id),
    });
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
        <section className="folder-bar">
          <button
            className={selectedFolderId ? 'ghost' : ''}
            onClick={() => setSelectedFolderId('')}
          >
            All profiles
          </button>
          {cloudState.folders.map((folder) => (
            <div className={selectedFolderId === folder.id ? 'folder-chip active' : 'folder-chip'} key={folder.id}>
              <button onClick={() => setSelectedFolderId(folder.id)}>{folder.name}</button>
              <button className="icon-button" aria-label={`Rename ${folder.name}`} onClick={() => renameFolder(folder)}>
                <Pencil size={14} />
              </button>
              <button className="icon-button danger-icon" aria-label={`Delete ${folder.name}`} onClick={() => deleteFolder(folder)}>
                <Trash2 size={14} />
              </button>
            </div>
          ))}
          <button className="ghost" onClick={createFolder}><Plus size={16} /> Folder</button>
        </section>
        <section className="table-toolbar">
          {visible.length > 0 && (
            <label className="check-field">
              <input
                type="checkbox"
                checked={allVisibleSelected}
                onChange={() => toggleSelectAllProfiles(visible)}
              />
              <span>{selectedProfileIds.size > 0 ? `${selectedProfileIds.size} selected` : 'Select all'}</span>
            </label>
          )}
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
          <select
            value={profileProxyFilter}
            onChange={(event) => setProfileProxyFilter(event.target.value as '' | 'assigned' | 'unassigned')}
          >
            <option value="">Any proxy</option>
            <option value="assigned">Proxy assigned</option>
            <option value="unassigned">No proxy assigned</option>
          </select>
          {visible.length > 0 && (
            <button className="ghost" onClick={() => exportProfilesToCsv(visible)}>
              <Download size={16} /> Export all
            </button>
          )}
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
                <th />
                <th>Name</th>
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
                    <td>
                      <select
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
                            {isActionPending(`launch-${profile.id}`) ? 'Launching…' : 'Launch'}
                          </button>
                          <button className="icon-button" aria-label={`Edit ${profile.name}`} onClick={(event) => {
                            event.stopPropagation();
                            openEditProfile(profile);
                          }}><Pencil size={16} /></button>
                          <button className="icon-button danger-icon" aria-label={`Delete ${profile.name}`} onClick={(event) => {
                            event.stopPropagation();
                            void deleteProfile(profile);
                          }}><Trash2 size={16} /></button>
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
                    {countryFlag(proxy.country_code)}
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
                <span>{proxy.username ? 'Auth' : 'Open'}</span>
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

  async function setBuiltInExtensionEnabled(key: keyof BuiltInExtensionToggles, enabled: boolean) {
    await saveCloudState({
      ...cloudState,
      built_in_extensions: {...cloudState.built_in_extensions, [key]: enabled},
    });
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

  function renderExtensionsTab() {
    return (
      <section className="panel">
        <div className="panel-title">
          <h2>Built-in extensions</h2>
        </div>
        {BUILT_IN_EXTENSIONS.map((entry) => (
          <div className="extension-row" key={entry.key}>
            <span>{entry.name}</span>
            <small>{entry.description}</small>
            <label className="checkbox-confirm">
              <input
                type="checkbox"
                checked={builtInExtensionEnabled(entry.key)}
                onChange={(event) => void setBuiltInExtensionEnabled(entry.key, event.target.checked)}
              />
              <span>{builtInExtensionEnabled(entry.key) ? 'Enabled' : 'Disabled'}</span>
            </label>
          </div>
        ))}

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
          <label className="summary-item token-field">
            <span>Bearer token</span>
            <input value={apiToken} spellCheck={false} onChange={(event) => setApiToken(event.target.value)} />
          </label>
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
          <span>Argys API tokens are generated per signed-in email for local automation and cloud-backed profile data. Browser sessions stay anonymous.</span>
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

  function renderImportTab() {
    return (
      <section className="panel import-panel">
        <div className="panel-title">
          <h2>Mass import profiles</h2>
        </div>
        <p>
          Import profiles in bulk from a Dolphin-style inventory CSV (the same format exported by
          the profiles-cookie-inventory tooling). Each row's proxy_name must carry the
          <code>type://host:port:username:password</code> connection string; proxies are matched
          and reused by host/port/username, and re-importing the same CSV updates existing profiles
          (matched by profile_id) instead of duplicating them.
        </p>
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
    );
  }

  function renderActiveTab() {
    if (cloudLoading) {
      return <LoadingState label="Loading cloud data" detail="Profiles, proxies, bookmarks, and extensions are syncing." />;
    }
    switch (activeTab) {
      case 'proxies':
        return renderProxiesTab();
      case 'bookmarks':
        return renderBookmarksTab();
      case 'extensions':
        return renderExtensionsTab();
      case 'api':
        return renderApiTab();
      case 'import':
        return renderImportTab();
      case 'profiles':
      default:
        return renderProfilesTab();
    }
  }

  function renderTopAction() {
    switch (activeTab) {
      case 'profiles': {
        const trashedCount = cloudState.profiles.filter((profile) => profile.deleted_at).length;
        return (
          <>
            <button
                className={selectedFolderId === TRASH_FOLDER_ID ? '' : 'ghost'}
                onClick={() => setSelectedFolderId(selectedFolderId === TRASH_FOLDER_ID ? '' : TRASH_FOLDER_ID)}
            >
              <Trash2 size={14} /> Trash{trashedCount > 0 ? ` (${trashedCount})` : ''}
            </button>
            <button onClick={openNewProfile}><Plus size={18} /> Profile</button>
          </>
        );
      }
      case 'proxies':
        return <button onClick={openNewProxy}><Plus size={18} /> Proxy</button>;
      case 'bookmarks':
        return <button onClick={openNewBookmark}><Plus size={18} /> Bookmark</button>;
      case 'extensions':
        return null;
      case 'api':
      case 'import':
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
              <h3>Account</h3>
              <p>{signedInEmail}</p>
            </div>
            <button className="ghost" onClick={signOut}>Sign out</button>
          </section>
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
                    void addExtensionFromWebStoreLink(webstoreLinkInput);
                  }
                }}
              />
            </label>
            <div className="extension-add-actions">
              <button
                disabled={!webstoreLinkInput.trim()}
                onClick={() => void addExtensionFromWebStoreLink(webstoreLinkInput)}
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
              onClick={() => setProfileDraft({...profileDraft, ...randomFingerprintPatch()})}
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
          label={startupFailed ? 'Argys Anty is not ready' : 'Preparing Argys Anty'}
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
          <h1>Sign in to Argys Anty</h1>
          <p>Cloud account required for profiles, proxies, bookmarks, and shared extensions.</p>
          <input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="Email" />
          <input value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Password" type="password" />
          <button onClick={signIn}>Sign in</button>
          {message && <span className="message">{message}</span>}
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand">Argys Anty</div>
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
            <p>Argys Anty owns cloud data. Argys Browser starts as a separate anonymous process.</p>
          </div>
          <div className="actions">
            {renderTopAction()}
          </div>
        </header>

        {renderActiveTab()}
      </section>

      {message && (
        <div className="status-toast" role="status">
          {message}
        </div>
      )}

      {renderSettingsModal()}
      {renderExtensionAddModal()}

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
              <section className="form-section wide compact-section">
                <div>
                  <h3>Cookie import</h3>
                  <p>Upload a JSON or Netscape cookies.txt file to cloud sync and import it when this profile launches.</p>
                </div>
                <div className="file-row wide">
                  <button
                      className="ghost"
                      type="button"
                      disabled={isActionPending('pick-cookie-file')}
                      onClick={() => runAsyncAction('pick-cookie-file', pickProfileCookieFile)}>
                    {isActionPending('pick-cookie-file') && <RefreshCw size={16} className="btn-spin" />}
                    {isActionPending('pick-cookie-file') ? 'Uploading…' : 'Select cookies file'}
                  </button>
                  {profileDraft.cookie_import_path || profileDraft.cookie_import_url ? (
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
                  onClick={() => setProfileDraft({...profileDraft, ...randomFingerprintPatch()})}
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
              <button className="ghost" onClick={() => setProfileDraft(null)}>Cancel</button>
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
                onClick={() => setProfileDraft({...profileDraft, ...randomFingerprintPatch()})}
              >
                Rotate fingerprint
              </button>
              <button onClick={() => setFingerprintEditorOpen(false)}>Done</button>
            </footer>
          </section>
        </div>
      )}

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
              <button className="ghost" onClick={() => setFolderDraft(null)}>Cancel</button>
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
              <button className="ghost" onClick={() => setStatusDraft(null)}>Cancel</button>
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
                  'Proxy settings are stored in Argys Anty and assigned to profiles on launch.'}</p>
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
              <button className="ghost" onClick={closeProxyDraft}>Cancel</button>
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
              <button className="ghost" onClick={() => setBookmarkDraft(null)}>Cancel</button>
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

      {updateState &&
        ['available', 'downloading', 'downloaded'].includes(updateState.status) &&
        updateToastDismissedVersion !== (updateState.updateInfo?.version || '') && (
        <div className="update-toast">
          <div className="update-toast-body">
            <strong>
              {updateState.status === 'downloaded'
                ? `Version ${updateState.updateInfo?.version || ''} downloaded — restart to install`
                : updateState.status === 'downloading'
                ? `Downloading update… ${Math.round(updateState.progress?.percent || 0)}%`
                : `Update ${updateState.updateInfo?.version || ''} available`}
            </strong>
            {updateState.updateInfo?.releaseNotes && (
              <p className="update-toast-notes">{updateState.updateInfo.releaseNotes}</p>
            )}
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

createRoot(document.getElementById('root')!).render(<App />);
