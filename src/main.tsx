import React, {useEffect, useMemo, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {Plus, Play, RefreshCw, Shield, Trash2} from 'lucide-react';
import {native} from './native';
import {supabase} from './supabase';
import type {ArgusProfile, ArgusProxy, CloudState, SharedBookmark, SharedExtension} from './types';
import './styles.css';

type TabId = 'profiles' | 'proxies' | 'bookmarks' | 'extensions' | 'api';

const tabs: Array<{id: TabId; label: string}> = [
  {id: 'profiles', label: 'Profiles'},
  {id: 'proxies', label: 'Proxies'},
  {id: 'bookmarks', label: 'Bookmarks'},
  {id: 'extensions', label: 'Extensions'},
  {id: 'api', label: 'API'},
];

const defaultState: CloudState = {
  profiles: [],
  proxies: [],
  shared_extensions: [],
  shared_bookmarks: [],
};

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

function App() {
  const [email, setEmail] = useState('holylabsltd@gmail.com');
  const [password, setPassword] = useState('');
  const [signedInEmail, setSignedInEmail] = useState('');
  const [message, setMessage] = useState('');
  const [cloudState, setCloudState] = useState<CloudState>(defaultState);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>('profiles');

  const selectedProfile = useMemo(
      () => cloudState.profiles.find((profile) => profile.id === selectedId) || null,
      [cloudState.profiles, selectedId],
  );

  useEffect(() => {
    void supabase?.auth.getUser().then(({data}) => {
      if (data.user?.email) {
        setSignedInEmail(data.user.email);
        void loadCloudState();
      }
    });
  }, []);

  async function loadCloudState() {
    if (!supabase) {
      setMessage('Supabase env is missing in .env');
      return;
    }
    const {data: userData} = await supabase.auth.getUser();
    const userId = userData.user?.id;
    if (!userId) {
      return;
    }
    const {data, error} = await supabase
        .from('argus_cloud_state')
        .select('profiles,proxies,shared_extensions,shared_bookmarks')
        .eq('user_id', userId)
        .maybeSingle();
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
    const {error} = await supabase
        .from('argus_cloud_state')
        .upsert({
          user_id: userId,
          profiles: nextState.profiles,
          proxies: nextState.proxies,
          shared_extensions: nextState.shared_extensions,
          shared_bookmarks: nextState.shared_bookmarks,
          updated_at: new Date().toISOString(),
        }, {onConflict: 'user_id'});
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
    setPassword('');
    await loadCloudState();
  }

  async function signOut() {
    await supabase?.auth.signOut();
    setSignedInEmail('');
    setCloudState(defaultState);
    setSelectedId(null);
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
                      <select value={profile.status || 'Ready'} onChange={(event) => updateProfile(profile, {status: event.target.value})}>
                        <option>Ready</option>
                        <option>Active</option>
                        <option>Warmup</option>
                        <option>Ban</option>
                        <option>Review</option>
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
            <span>{proxy.username ? 'Auth' : 'Open'}</span>
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
          <a className="data-card link-card" href={normalizeBookmarkUrl(bookmark.url)} key={`${bookmark.title}-${bookmark.url}`}>
            <div>
              <h2>{bookmark.title || bookmark.url}</h2>
              <p>{normalizeBookmarkUrl(bookmark.url)}</p>
            </div>
          </a>
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
      <section className="panel api-panel">
        <h2>Local API</h2>
        <p>Argys Anty owns the cloud account and automation surface. Browser sessions stay anonymous.</p>
        <code>GET /v1/profiles</code>
        <code>POST /v1/profiles/{'{id}'}/launch</code>
        <code>GET /v1/shared/bookmarks</code>
        <code>GET /v1/shared/extensions</code>
      </section>
    );
  }

  function renderActiveTab() {
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
          <span>{initials(signedInEmail)}</span>
          <strong>{signedInEmail}</strong>
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
            <button className="ghost" onClick={loadCloudState}><RefreshCw size={18} /> Refresh</button>
            <button><Plus size={18} /> Profile</button>
          </div>
        </header>

        {renderActiveTab()}

        {message && <footer className="status">{message}</footer>}
      </section>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
