import React, {useEffect, useMemo, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {Pencil, Plus, Play, Shield, Trash2, X} from 'lucide-react';
import {native} from './native';
import {supabase} from './supabase';
import type {ArgusProfile, ArgusProxy, CloudState, SharedBookmark, SharedExtension} from './types';
import './styles.css';

type TabId = 'profiles' | 'proxies' | 'bookmarks' | 'extensions' | 'api';

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
  proxy_search: string;
  tags: string;
  start_url: string;
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
  fingerprint_webgl_vendor: string;
  fingerprint_webgl_renderer: string;
  fingerprint_screen: string;
  fingerprint_cpu_cores: string;
  fingerprint_memory_gb: string;
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

const tabs: Array<{id: TabId; label: string}> = [
  {id: 'profiles', label: 'Profiles'},
  {id: 'proxies', label: 'Proxies'},
  {id: 'bookmarks', label: 'Bookmarks'},
  {id: 'extensions', label: 'Extensions'},
  {id: 'api', label: 'API'},
];

const API_BASE_URL = 'http://127.0.0.1:3001';
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
  proxies: [],
  shared_extensions: [],
  shared_bookmarks: [],
};

const profileStatuses = ['Ready', 'Active', 'Warmup', 'Ban', 'Review'];
const profileColors = ['#171613', '#2563eb', '#16a34a', '#a855f7', '#dc2626', '#f59e0b'];
const osPresets = ['macOS', 'Windows', 'Linux', 'Android'];
const browserVersionPresets = ['Auto', 'Chrome 126', 'Chrome 125', 'Chrome 124'];
const languagePresets = ['en-US,en;q=0.9', 'en-GB,en;q=0.9', 'ru-RU,ru;q=0.9,en;q=0.8'];
const timezonePresets = ['Auto from proxy', 'America/New_York', 'America/Los_Angeles', 'Europe/London', 'Asia/Jerusalem'];
const webRtcModes = ['Proxy only', 'Disabled', 'Real', 'Custom'];
const noiseModes = ['Real', 'Noise', 'Block'];
const screenPresets = ['Auto', '1920x1080', '1440x900', '1366x768', '1536x864'];

let sharedBookmarksColumnAvailable = true;

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

function anonymousHomePage(profile: ArgusProfile, bookmarks: SharedBookmark[]) {
  const safeName = escapeHtml(profile.name || 'Profile');
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
  const html = `<!doctype html>
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
.badge{border:1px solid #ded6c8;border-radius:999px;padding:10px 16px;background:#fff;font-weight:750}
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
<div class="badge">Anti-detect mode on</div>
</header>
${bookmarkItems ? `<section class="grid">${bookmarkItems}</section>` : '<p class="empty">No shared bookmarks yet.</p>'}
</main>
</body>
</html>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

function browserStartUrl(profile: ArgusProfile, bookmarks: SharedBookmark[]) {
  const startUrl = profile.start_url?.trim();
  if (!startUrl || startUrl === 'about:blank' || startUrl.startsWith('chrome://')) {
    return anonymousHomePage(profile, bookmarks);
  }
  return startUrl;
}

function isMissingColumnError(error: {message?: string; code?: string} | null) {
  return Boolean(error?.message?.includes('shared_bookmarks') ||
      error?.code === '42703' ||
      error?.code === 'PGRST204');
}

function newProfileDraft(): ProfileDraft {
  return {
    name: `Profile ${new Date().toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'})}`,
    status: 'Ready',
    color: profileColors[1],
    folder_id: '',
    proxy_id: '',
    proxy_search: '',
    tags: '',
    start_url: '',
    command_line_switches: '',
    fingerprint_os: 'macOS',
    fingerprint_browser_version: 'Auto',
    fingerprint_user_agent: '',
    fingerprint_language: languagePresets[0],
    fingerprint_timezone: 'Auto from proxy',
    fingerprint_geolocation: 'Ask',
    fingerprint_webrtc: 'Proxy only',
    fingerprint_canvas: 'Noise',
    fingerprint_webgl: 'Noise',
    fingerprint_webgl_vendor: '',
    fingerprint_webgl_renderer: '',
    fingerprint_screen: 'Auto',
    fingerprint_cpu_cores: '8',
    fingerprint_memory_gb: '8',
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
    proxy_search: '',
    tags: profile.tags?.join(', ') || '',
    start_url: profile.start_url || '',
    command_line_switches: profile.command_line_switches || '',
    fingerprint_os: fingerprint.os || 'macOS',
    fingerprint_browser_version: fingerprint.browser_version || 'Auto',
    fingerprint_user_agent: fingerprint.user_agent || '',
    fingerprint_language: fingerprint.language || languagePresets[0],
    fingerprint_timezone: fingerprint.timezone || 'Auto from proxy',
    fingerprint_geolocation: fingerprint.geolocation || 'Ask',
    fingerprint_webrtc: fingerprint.webrtc || 'Proxy only',
    fingerprint_canvas: fingerprint.canvas || 'Noise',
    fingerprint_webgl: fingerprint.webgl || 'Noise',
    fingerprint_webgl_vendor: fingerprint.webgl_vendor || '',
    fingerprint_webgl_renderer: fingerprint.webgl_renderer || '',
    fingerprint_screen: fingerprint.screen || 'Auto',
    fingerprint_cpu_cores: fingerprint.cpu_cores ? String(fingerprint.cpu_cores) : '8',
    fingerprint_memory_gb: fingerprint.memory_gb ? String(fingerprint.memory_gb) : '8',
  };
}

function tagsFromDraft(value: string) {
  return value.split(',')
      .map((tag) => tag.trim())
      .filter(Boolean);
}

function numberOrNull(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
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

function LoadingState({label, detail}: {label: string; detail: string}) {
  return (
    <section className="loading-state">
      <div className="spinner" aria-hidden="true" />
      <h1>{label}</h1>
      <p>{detail}</p>
    </section>
  );
}

function App() {
  const [email, setEmail] = useState('holylabsltd@gmail.com');
  const [password, setPassword] = useState('');
  const [signedInEmail, setSignedInEmail] = useState('');
  const [message, setMessage] = useState('');
  const [appBooting, setAppBooting] = useState(true);
  const [cloudLoading, setCloudLoading] = useState(false);
  const [cloudState, setCloudState] = useState<CloudState>(defaultState);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>('profiles');
  const [apiToken, setApiToken] = useState('argys_api_token');
  const [copiedEndpoint, setCopiedEndpoint] = useState('');
  const [profileDraft, setProfileDraft] = useState<ProfileDraft | null>(null);
  const [proxyDraft, setProxyDraft] = useState<ProxyDraft | null>(null);
  const [bookmarkDraft, setBookmarkDraft] = useState<BookmarkDraft | null>(null);

  const selectedProfile = useMemo(
      () => cloudState.profiles.find((profile) => profile.id === selectedId) || null,
      [cloudState.profiles, selectedId],
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
      let {data, error}: {data: any; error: any} = await supabase
          .from('argus_cloud_state')
          .select('profiles,proxies,shared_extensions,shared_bookmarks')
          .eq('user_id', userId)
          .maybeSingle();
      if (isMissingColumnError(error)) {
        sharedBookmarksColumnAvailable = false;
        const fallback = await supabase
            .from('argus_cloud_state')
            .select('profiles,proxies,shared_extensions')
            .eq('user_id', userId)
            .maybeSingle();
        data = fallback.data;
        error = fallback.error;
      }
      if (error) {
        setMessage(error.message);
        return;
      }
      const nextState = {
        profiles: Array.isArray(data?.profiles) ? data.profiles : [],
        proxies: Array.isArray(data?.proxies) ? data.proxies : [],
        shared_extensions: Array.isArray(data?.shared_extensions) ?
          data.shared_extensions :
          [],
        shared_bookmarks: Array.isArray(data?.shared_bookmarks) ?
          data.shared_bookmarks :
          [],
      };
      setCloudState(nextState);
      setSelectedId(nextState.profiles[0]?.id || null);
      setMessage(`Loaded ${nextState.profiles.length} profiles`);
    } finally {
      setCloudLoading(false);
    }
  }

  async function saveCloudState(nextState: CloudState) {
    setCloudState(nextState);
    if (!supabase) {
      return;
    }
    const {data: userData} = await supabase.auth.getUser();
    const userId = userData.user?.id;
    if (!userId) {
      return;
    }
    const payload: Record<string, unknown> = {
      user_id: userId,
      profiles: nextState.profiles,
      proxies: nextState.proxies,
      shared_extensions: nextState.shared_extensions,
      updated_at: new Date().toISOString(),
    };
    if (sharedBookmarksColumnAvailable) {
      payload.shared_bookmarks = nextState.shared_bookmarks;
    }
    let {error} = await supabase
        .from('argus_cloud_state')
        .upsert(payload, {onConflict: 'user_id'});
    if (isMissingColumnError(error)) {
      sharedBookmarksColumnAvailable = false;
      delete payload.shared_bookmarks;
      const fallback = await supabase
          .from('argus_cloud_state')
          .upsert(payload, {onConflict: 'user_id'});
      error = fallback.error;
    }
    if (error) {
      setMessage(error.message);
    }
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

  async function copyCurl(endpoint: ApiEndpoint) {
    await navigator.clipboard.writeText(curlFor(endpoint));
    setCopiedEndpoint(`${endpoint.method} ${endpoint.path}`);
    window.setTimeout(() => setCopiedEndpoint(''), 1800);
  }

  function proxyFor(profile: ArgusProfile) {
    return cloudState.proxies.find((proxy) => proxy.id === profile.proxy_id) || null;
  }

  async function launch(profile: ArgusProfile) {
    if (!native) {
      setMessage('Native launcher bridge is not available');
      return;
    }
    try {
      const result = await native.launchProfile({
        id: profile.id,
        name: profile.name,
        userDataDir: profileDataDir(profile.id),
        proxy: proxyFor(profile),
        extensionPaths: cloudState.shared_extensions.map((extension) => extension.path),
        commandLineSwitches: profile.command_line_switches || '',
        startUrl: browserStartUrl(profile, cloudState.shared_bookmarks),
      });
      setMessage(result.ok ?
        `Opened ${result.launcherAppPath || 'profile app'}` :
        result.error || 'Launch failed');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
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

  async function saveProfileDraft() {
    if (!profileDraft) {
      return;
    }
    const name = profileDraft.name.trim();
    if (!name) {
      setMessage('Profile name is required');
      return;
    }
    const profile: ArgusProfile = {
      id: profileDraft.id || globalThis.crypto?.randomUUID?.() || `${Date.now()}`,
      name,
      status: profileDraft.status.trim() || 'Ready',
      color: profileDraft.color || profileColors[1],
      folder_id: profileDraft.folder_id.trim() || null,
      proxy_id: profileDraft.proxy_id || null,
      tags: tagsFromDraft(profileDraft.tags),
      start_url: profileDraft.start_url.trim() || null,
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
        webgl_vendor: profileDraft.fingerprint_webgl_vendor.trim(),
        webgl_renderer: profileDraft.fingerprint_webgl_renderer.trim(),
        screen: profileDraft.fingerprint_screen,
        cpu_cores: numberOrNull(profileDraft.fingerprint_cpu_cores),
        memory_gb: numberOrNull(profileDraft.fingerprint_memory_gb),
      },
      created_at: profileDraft.id ?
        cloudState.profiles.find((item) => item.id === profileDraft.id)?.created_at :
        new Date().toISOString(),
    };
    const profiles = profileDraft.id ?
      cloudState.profiles.map((item) => item.id === profile.id ? profile : item) :
      [...cloudState.profiles, profile];
    await saveCloudState({...cloudState, profiles});
    setSelectedId(profile.id);
    setProfileDraft(null);
    setMessage(`${profile.name} saved`);
  }

  async function deleteProfileDraft() {
    if (!profileDraft?.id) {
      setProfileDraft(null);
      return;
    }
    const profile = cloudState.profiles.find((item) => item.id === profileDraft.id);
    if (!profile) {
      setProfileDraft(null);
      return;
    }
    await deleteProfile(profile);
    setProfileDraft(null);
  }

  async function deleteProfile(profile: ArgusProfile) {
    if (!window.confirm(`Delete ${profile.name}?`)) {
      return;
    }
    const profiles = cloudState.profiles.filter((item) => item.id !== profile.id);
    await saveCloudState({...cloudState, profiles});
    setSelectedId(profiles[0]?.id || null);
    setMessage(`${profile.name} deleted`);
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

  function openNewProxy() {
    setActiveTab('proxies');
    setProxyDraft(newProxyDraft());
  }

  function openEditProxy(proxy: ArgusProxy) {
    setProxyDraft(draftFromProxy(proxy));
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
    const proxy: ArgusProxy = {
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
    setProxyDraft(null);
    setMessage(`${proxy.name} saved`);
  }

  async function deleteProxyDraft() {
    if (!proxyDraft?.id) {
      setProxyDraft(null);
      return;
    }
    const proxy = cloudState.proxies.find((item) => item.id === proxyDraft.id);
    if (!proxy) {
      setProxyDraft(null);
      return;
    }
    if (!window.confirm(`Delete ${proxy.name || proxy.host}?`)) {
      return;
    }
    const proxies = cloudState.proxies.filter((item) => item.id !== proxy.id);
    const profiles = cloudState.profiles.map((profile) =>
      profile.proxy_id === proxy.id ? {...profile, proxy_id: null} : profile);
    await saveCloudState({...cloudState, proxies, profiles});
    setProxyDraft(null);
    setMessage(`${proxy.name || proxy.host} deleted`);
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

  async function addExtension() {
    const path = window.prompt('Unpacked extension folder path');
    if (!path?.trim()) {
      return;
    }
    const nextExtension: SharedExtension = {
      path: path.trim(),
      name: path.trim().split('/').filter(Boolean).at(-1) || 'Extension',
    };
    await saveCloudState({
      ...cloudState,
      shared_extensions: [...cloudState.shared_extensions, nextExtension],
    });
  }

  async function removeExtension(path: string) {
    await saveCloudState({
      ...cloudState,
      shared_extensions: cloudState.shared_extensions.filter(
          (extension) => extension.path !== path),
    });
  }

  function renderProfilesTab() {
    return (
      <>
        <section className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Status</th>
                <th>Created</th>
                <th>Proxy</th>
                <th>Tags</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {cloudState.profiles.map((profile) => {
                const proxy = proxyFor(profile);
                return (
                  <tr key={profile.id} className={profile.id === selectedId ? 'selected' : ''} onClick={() => setSelectedId(profile.id)}>
                    <td>
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
                        {profileStatuses.map((status) => <option key={status}>{status}</option>)}
                        {!profileStatuses.includes(profile.status || '') && profile.status && <option>{profile.status}</option>}
                      </select>
                    </td>
                    <td>{profile.created_at?.slice(0, 10) || '-'}</td>
                    <td>{proxy ? `${proxy.host}:${proxy.port}` : 'Direct'}</td>
                    <td>{profile.tags?.join(', ') || '-'}</td>
                    <td>
                      <button className="launch" onClick={(event) => {
                        event.stopPropagation();
                        void launch(profile);
                      }}><Play size={16} /> Launch</button>
                      <button className="icon-button" aria-label={`Edit ${profile.name}`} onClick={(event) => {
                        event.stopPropagation();
                        openEditProfile(profile);
                      }}><Pencil size={16} /></button>
                      <button className="icon-button danger-icon" aria-label={`Delete ${profile.name}`} onClick={(event) => {
                        event.stopPropagation();
                        void deleteProfile(profile);
                      }}><Trash2 size={16} /></button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>

        <section className="split">
          <div className="panel">
            <h2>Profile switches</h2>
            <p>Per-profile command line switches. Shared extensions are not stored here.</p>
            <textarea
              value={selectedProfile?.command_line_switches || ''}
              disabled={!selectedProfile}
              onChange={(event) => selectedProfile && updateProfile(selectedProfile, {
                command_line_switches: event.target.value,
              })}
              placeholder="--disable-features=ExampleFeature&#10;--lang=en-US"
            />
          </div>
          <div className="panel">
            <h2>Anonymous home</h2>
            <p>Argys Browser launches with a launcher-provided home page. No sign-in route is opened in the browser process.</p>
          </div>
        </section>
      </>
    );
  }

  function renderProxiesTab() {
    return (
      <section className="card-grid">
        {cloudState.proxies.map((proxy) => (
          <article className="data-card" key={proxy.id}>
            <div>
              <h2>{proxy.name || proxy.host}</h2>
              <p>{proxy.type || 'http'} · {proxy.host}:{proxy.port}</p>
            </div>
            <div className="data-card-actions">
              <span>{proxy.username ? 'Auth' : 'Open'}</span>
              <button className="icon-button" aria-label={`Edit ${proxy.name || proxy.host}`} onClick={() => openEditProxy(proxy)}>
                <Pencil size={16} />
              </button>
            </div>
          </article>
        ))}
        {cloudState.proxies.length === 0 && <p className="empty-state">No proxies loaded.</p>}
      </section>
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

  function renderExtensionsTab() {
    return (
      <section className="panel">
        <div className="panel-title">
          <h2>Shared extensions</h2>
          <button onClick={addExtension}><Plus size={16} /> Add</button>
        </div>
        {cloudState.shared_extensions.map((extension) => (
          <div className="extension-row" key={extension.path}>
            <span>{extension.name || extension.path}</span>
            <small>{extension.path}</small>
            <button onClick={() => removeExtension(extension.path)}><Trash2 size={16} /></button>
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
      case 'profiles':
      default:
        return renderProfilesTab();
    }
  }

  function renderTopAction() {
    switch (activeTab) {
      case 'profiles':
        return <button onClick={openNewProfile}><Plus size={18} /> Profile</button>;
      case 'proxies':
        return <button onClick={openNewProxy}><Plus size={18} /> Proxy</button>;
      case 'bookmarks':
        return <button onClick={openNewBookmark}><Plus size={18} /> Bookmark</button>;
      case 'extensions':
        return <button onClick={addExtension}><Plus size={18} /> Extension</button>;
      case 'api':
      default:
        return null;
    }
  }

  if (appBooting) {
    return (
      <main className="login-shell">
        <LoadingState label="Starting Argys Anty" detail="Checking cloud session and loading workspace." />
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
          <div className="account-row">
            <span>{initials(signedInEmail)}</span>
            <strong>{signedInEmail}</strong>
          </div>
          <button onClick={signOut}>Sign out</button>
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

        {message && <footer className="status">{message}</footer>}
      </section>

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

            <div className="profile-form">
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
                <input
                  list="profile-statuses"
                  value={profileDraft.status}
                  onChange={(event) => setProfileDraft({...profileDraft, status: event.target.value})}
                />
              </label>
              <label className="field">
                <span>Proxy</span>
                <div className="proxy-picker">
                  <input
                    placeholder="Search proxy by name, host, port"
                    value={profileDraft.proxy_search}
                    onChange={(event) => setProfileDraft({...profileDraft, proxy_search: event.target.value})}
                  />
                  <select
                    value={profileDraft.proxy_id}
                    onChange={(event) => setProfileDraft({...profileDraft, proxy_id: event.target.value})}
                  >
                    <option value="">Direct connection</option>
                    {filteredProfileProxies().map((proxy) => (
                      <option value={proxy.id} key={proxy.id}>
                        {proxy.name || `${proxy.host}:${proxy.port}`} · {proxy.type || 'http'} · {proxy.host}:{proxy.port}
                      </option>
                    ))}
                  </select>
                </div>
              </label>
              <label className="field">
                <span>Folder</span>
                <input
                  placeholder="All profiles"
                  value={profileDraft.folder_id}
                  onChange={(event) => setProfileDraft({...profileDraft, folder_id: event.target.value})}
                />
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
              <section className="form-section wide">
                <div>
                  <h3>Fingerprint</h3>
                  <p>Profile-level browser identity settings stored with cloud data.</p>
                </div>
                <label className="field">
                  <span>Operating system</span>
                  <select
                    value={profileDraft.fingerprint_os}
                    onChange={(event) => setProfileDraft({...profileDraft, fingerprint_os: event.target.value})}
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
                  <span>WebGL vendor</span>
                  <input
                    placeholder="Auto"
                    value={profileDraft.fingerprint_webgl_vendor}
                    onChange={(event) => setProfileDraft({...profileDraft, fingerprint_webgl_vendor: event.target.value})}
                  />
                </label>
                <label className="field">
                  <span>WebGL renderer</span>
                  <input
                    placeholder="Auto"
                    value={profileDraft.fingerprint_webgl_renderer}
                    onChange={(event) => setProfileDraft({...profileDraft, fingerprint_webgl_renderer: event.target.value})}
                  />
                </label>
                <label className="field">
                  <span>Screen</span>
                  <input
                    list="screen-presets"
                    value={profileDraft.fingerprint_screen}
                    onChange={(event) => setProfileDraft({...profileDraft, fingerprint_screen: event.target.value})}
                  />
                </label>
                <label className="field compact">
                  <span>CPU cores</span>
                  <input
                    inputMode="numeric"
                    value={profileDraft.fingerprint_cpu_cores}
                    onChange={(event) => setProfileDraft({...profileDraft, fingerprint_cpu_cores: event.target.value.replace(/[^\d]/g, '')})}
                  />
                </label>
                <label className="field compact">
                  <span>Memory GB</span>
                  <input
                    inputMode="numeric"
                    value={profileDraft.fingerprint_memory_gb}
                    onChange={(event) => setProfileDraft({...profileDraft, fingerprint_memory_gb: event.target.value.replace(/[^\d]/g, '')})}
                  />
                </label>
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

            <datalist id="profile-statuses">
              {profileStatuses.map((status) => <option value={status} key={status} />)}
            </datalist>
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
              <button onClick={saveProfileDraft}>{profileDraft.id ? 'Save changes' : 'Create profile'}</button>
            </footer>
          </section>
        </div>
      )}

      {proxyDraft && (
        <div className="modal-backdrop" onMouseDown={() => setProxyDraft(null)}>
          <section className="profile-modal" onMouseDown={(event) => event.stopPropagation()}>
            <header>
              <div>
                <h2>{proxyDraft.id ? 'Edit proxy' : 'Add proxy'}</h2>
                <p>Proxy settings are stored in Argys Anty and assigned to profiles on launch.</p>
              </div>
              <button className="icon-button" aria-label="Close" onClick={() => setProxyDraft(null)}><X size={18} /></button>
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
              <button className="ghost" onClick={() => setProxyDraft(null)}>Cancel</button>
              <button onClick={saveProxyDraft}>{proxyDraft.id ? 'Save changes' : 'Add proxy'}</button>
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
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
