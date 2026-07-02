import React, {useEffect, useMemo, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {Plus, Play, RefreshCw, Shield, Trash2} from 'lucide-react';
import {native} from './native';
import {supabase} from './supabase';
import type {ArgusProfile, ArgusProxy, CloudState, SharedExtension} from './types';
import './styles.css';

const defaultState: CloudState = {
  profiles: [],
  proxies: [],
  shared_extensions: [],
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
  return `${navigator.platform.includes('Mac') ? '/Users/dima/Library/Application Support/Argus Browser/Profiles' : 'ArgusProfiles'}/${profileId}`;
}

function App() {
  const [email, setEmail] = useState('holylabsltd@gmail.com');
  const [password, setPassword] = useState('');
  const [signedInEmail, setSignedInEmail] = useState('');
  const [message, setMessage] = useState('');
  const [cloudState, setCloudState] = useState<CloudState>(defaultState);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [browserPath, setBrowserPath] = useState('');

  const selectedProfile = useMemo(
      () => cloudState.profiles.find((profile) => profile.id === selectedId) || null,
      [cloudState.profiles, selectedId],
  );

  useEffect(() => {
    void native?.getBrowserPath().then(setBrowserPath);
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
        .select('profiles,proxies,shared_extensions')
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
    const result = await native.launchProfile({
      id: profile.id,
      name: profile.name,
      userDataDir: profileDataDir(profile.id),
      proxy: proxyFor(profile),
      extensionPaths: cloudState.shared_extensions.map((extension) => extension.path),
      commandLineSwitches: profile.command_line_switches || '',
      startUrl: profile.start_url || 'chrome://argus-newtab',
    });
    setMessage(result.ok ? `Started browser pid ${result.pid}` : 'Launch failed');
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

  if (!signedInEmail) {
    return (
      <main className="login-shell">
        <section className="login-panel">
          <Shield size={34} />
          <h1>Sign in to Argus Launcher</h1>
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
        <div className="brand">Argus Launcher</div>
        <nav>
          <button className="active">Profiles</button>
          <button>Proxies</button>
          <button>Bookmarks</button>
          <button>Extensions</button>
          <button>API</button>
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
            <h1>All profiles</h1>
            <p>Launcher owns cloud data. Browser starts as a separate anonymous process.</p>
          </div>
          <div className="actions">
            <button className="ghost" onClick={loadCloudState}><RefreshCw size={18} /> Refresh</button>
            <button><Plus size={18} /> Profile</button>
          </div>
        </header>

        <div className="browser-path">
          <label>Argus Browser app</label>
          <input value={browserPath} onChange={(event) => setBrowserPath(event.target.value)} />
          <button onClick={() => native?.setBrowserPath(browserPath)}>Save</button>
        </div>

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
          </div>
        </section>

        {message && <footer className="status">{message}</footer>}
      </section>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
