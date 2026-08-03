import {useState} from 'react';
import {
  Activity, AtSign, Cookie, Fingerprint, Folder, Globe, KeyRound, Network, Palette, Plus,
  Tag, Terminal, Trash2, UserRound,
} from 'lucide-react';
import {BusyButton} from '../ui/BusyButton';
import {ColorPicker} from '../ui/ColorPicker';
import {Field} from '../ui/Field';
import {Modal} from '../ui/Modal';
import {PlatformPicker} from '../ui/PlatformPicker';
import {TagInput} from '../ui/TagInput';
import {FingerprintDatalists, FingerprintFields} from './FingerprintFields';
import {ProfileSummary} from './ProfileSummary';
import {randomFingerprintPatch} from '../../lib/fingerprintPresets';
import {proxyOptionLabel, parseProxyLink} from '../../lib/proxies';
import {profileFromDraft, tagsFromDraft, withFingerprintOs} from '../../drafts';
import {useAsyncAction} from '../../useAsyncAction';
import {useWorkspace} from '../../workspace/WorkspaceProvider';
import type {ProfileDraft, ProxyDraft} from '../../drafts';

export type ProfileModalProps = {
  draft: ProfileDraft;
  onChange: (draft: ProfileDraft) => void;
  onClose: () => void;
  onNewStatus: () => void;
  onPickCookies: () => void;
  // Opens the proxy dialog seeded from the profile's "create new proxy" field,
  // so the new proxy comes back assigned to this draft.
  onCreateProxy: (seed: ProxyDraft) => void;
  onRequestDelete: (profileIds: string[], label: string) => void;
};

export function ProfileModal({
  draft,
  onChange,
  onClose,
  onNewStatus,
  onPickCookies,
  onCreateProxy,
  onRequestDelete,
}: ProfileModalProps) {
  const {data, toast, profiles, statusOptions} = useWorkspace();
  const state = data.state;
  const {run, isPending} = useAsyncAction();
  const [fingerprintOpen, setFingerprintOpen] = useState(false);
  // While the proxy combobox has focus it shows what the user is typing; when
  // it does not, it shows the assigned proxy's label.
  const [proxyPickerFocused, setProxyPickerFocused] = useState(false);

  const set = (patch: Partial<ProfileDraft>) => onChange({...draft, ...patch});
  const rotate = () => set(randomFingerprintPatch(draft.fingerprint_os));

  function proxyFieldValue() {
    if (proxyPickerFocused || draft.proxy_search) {
      return draft.proxy_search;
    }
    const proxy = state.proxies.find((item) => item.id === draft.proxy_id);
    return proxy ? proxyOptionLabel(proxy) : 'Proxy required';
  }

  function matchProxy(value: string) {
    return state.proxies.find((proxy) =>
      proxyOptionLabel(proxy) === value ||
      proxy.id === value ||
      `${proxy.host}:${proxy.port}` === value);
  }

  function filteredProxies() {
    const query = draft.proxy_search.trim().toLowerCase();
    if (!query) {
      return state.proxies;
    }
    return state.proxies.filter((proxy) =>
      [proxy.name, proxy.host, proxy.type, String(proxy.port), proxy.username]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
          .includes(query));
  }

  function createProxyFromLink() {
    const value = draft.proxy_link.trim();
    if (!value) {
      onCreateProxy({name: '', type: 'socks5', host: '', port: '', username: '', password: ''});
      return;
    }
    const parsed = parseProxyLink(value);
    if (!parsed) {
      toast.setMessage('Proxy link is invalid. Use http://user:pass@host:port, socks5://user:pass@host:port, or http:host:port:user:pass');
      return;
    }
    onCreateProxy({
      name: '',
      type: parsed.type || 'http',
      host: parsed.host,
      port: String(parsed.port),
      username: parsed.username || '',
      password: parsed.password || '',
    });
  }

  function cookieLabel(cookieId: string) {
    const cookie = state.cookies.find((item) => item.id === cookieId);
    if (!cookie) {
      return cookieId;
    }
    return cookie.count ? `${cookie.name} (${cookie.count} cookies)` : cookie.name;
  }

  async function save() {
    const name = draft.name.trim();
    if (!name) {
      toast.setMessage('Profile name is required');
      return;
    }
    if (draft.proxy_mode === 'assigned' &&
        (!draft.proxy_id || !state.proxies.some((proxy) => proxy.id === draft.proxy_id))) {
      toast.setMessage('Proxy is required, or pick Direct / Free Proxy instead.');
      return;
    }
    const createdAt = draft.id ?
      state.profiles.find((item) => item.id === draft.id)?.created_at :
      new Date().toISOString();
    const profile = profileFromDraft(draft, createdAt);
    // On failure withDb has already surfaced the real error; don't overwrite it
    // with a false "saved" toast, and keep the dialog open so edits aren't lost.
    if (!await profiles.save(profile)) {
      return;
    }
    onClose();
    toast.setMessage(`${profile.name} saved`);
  }

  return (
    <>
      <Modal
        className=""
        onClose={onClose}
        title={draft.id ? 'Edit profile' : 'Create profile'}
        subtitle="Cloud-backed profile settings used when Argys Browser launches anonymously."
        footer={
          <>
            {draft.id && (
              <button
                className="danger ghost"
                onClick={() => onRequestDelete([draft.id as string], draft.name)}
              >
                <Trash2 size={16} /> Delete
              </button>
            )}
            <BusyButton
              busy={isPending('save-profile')}
              busyLabel="Saving…"
              onClick={() => void run('save-profile', save)}
            >
              {draft.id ? 'Save changes' : 'Create profile'}
            </BusyButton>
          </>
        }
      >
        <div className="profile-editor-layout">
          <div className="profile-form profile-editor-main">
            <Field label="Name" icon={<UserRound size={14} />} wide>
              <input
                type="text"
                autoFocus
                value={draft.name}
                onChange={(event) => set({name: event.target.value})}
              />
            </Field>
            <Field label="Status" icon={<Activity size={14} />}>
              <div className="select-action">
                <select
                  value={statusOptions.includes(draft.status) ? draft.status : 'Ready'}
                  onChange={(event) => set({status: event.target.value})}
                >
                  {statusOptions.map((status) => <option value={status} key={status}>{status}</option>)}
                </select>
                <button className="ghost" type="button" onClick={onNewStatus}>
                  <Plus size={16} /> Status
                </button>
              </div>
            </Field>

            {/* The platform is the one fingerprint field that lives out here
              * rather than behind "Edit fingerprint". It decides what every
              * other field in that dialog is allowed to be -- picking it
              * re-rolls the GPU, CPU, screen and media-device set -- so leaving
              * it two dialogs deep meant every profile silently shipped as
              * Windows 11. See the note in AGENTS.md. */}
            <Field label="Platform" icon={<Fingerprint size={14} />} wide group>
              <PlatformPicker
                value={draft.fingerprint_os}
                onChange={(os) => onChange(withFingerprintOs(draft, os))}
              />
            </Field>

            <label className="field wide">
              <span>Proxy mode</span>
              <div className="segmented">
                {(['assigned', 'direct', 'free_proxy'] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    className={draft.proxy_mode === mode ? 'active' : ''}
                    onClick={() => set({proxy_mode: mode})}
                  >
                    {mode === 'assigned' ? 'Assigned proxy' : mode === 'direct' ? 'Direct' : 'Free Proxy'}
                  </button>
                ))}
              </div>
              {draft.proxy_mode === 'direct' && (
                <p className="field-hint">No proxy, no fallback extension. Traffic goes out directly.</p>
              )}
              {draft.proxy_mode === 'free_proxy' && (
                <p className="field-hint">Uses the bundled FoxyWall Proxy extension instead of an assigned proxy.</p>
              )}
            </label>

            {draft.proxy_mode === 'assigned' && (
              <Field label="Proxy" icon={<Network size={14} />}>
                <div className="proxy-picker">
                  <input
                    type="text"
                    list="profile-proxy-options"
                    placeholder="Search and select proxy"
                    value={proxyFieldValue()}
                    onFocus={() => {
                      setProxyPickerFocused(true);
                      set({proxy_search: ''});
                    }}
                    onChange={(event) => {
                      const value = event.target.value;
                      if (!value.trim() || value === 'Direct connection') {
                        set({proxy_search: ''});
                        return;
                      }
                      set({proxy_id: matchProxy(value)?.id || '', proxy_search: value});
                    }}
                    onBlur={() => {
                      setProxyPickerFocused(false);
                      const value = draft.proxy_search.trim();
                      if (!value || value === 'Direct connection') {
                        set({proxy_search: ''});
                        return;
                      }
                      const matched = matchProxy(value);
                      if (matched) {
                        set({proxy_id: matched.id, proxy_search: ''});
                      }
                    }}
                  />
                  <datalist id="profile-proxy-options">
                    {filteredProxies().map((proxy) => (
                      <option value={proxyOptionLabel(proxy)} key={proxy.id} />
                    ))}
                  </datalist>
                  <div className="inline-action">
                    <input
                      type="text"
                      placeholder="http://user:pass@host:port or socks5://..."
                      value={draft.proxy_link}
                      onChange={(event) => set({proxy_link: event.target.value})}
                    />
                    <button type="button" onClick={createProxyFromLink}>Create new proxy</button>
                  </div>
                </div>
              </Field>
            )}

            <Field label="Folder" icon={<Folder size={14} />}>
              <select
                value={draft.folder_id}
                onChange={(event) => set({folder_id: event.target.value})}
              >
                <option value="">All profiles</option>
                {state.folders.map((folder) => (
                  <option value={folder.id} key={folder.id}>{folder.name}</option>
                ))}
              </select>
            </Field>
            <Field label="Colour" icon={<Palette size={14} />} group>
              <ColorPicker value={draft.color} onChange={(color) => set({color})} />
            </Field>
            <Field
              label="Tags"
              icon={<Tag size={14} />}
              hint="Enter or comma adds a tag. Tags are searchable from the profiles list."
              wide
            >
              <TagInput
                placeholder="warmup, facebook-cookies"
                value={tagsFromDraft(draft.tags)}
                onChange={(tags) => set({tags: tags.join(', ')})}
              />
            </Field>
            <Field label="Start page" icon={<Globe size={14} />} wide>
              <input
                type="text"
                placeholder="Leave empty for shared bookmarks home"
                value={draft.start_url}
                onChange={(event) => set({start_url: event.target.value})}
              />
            </Field>
            <Field
              label="Account email"
              icon={<AtSign size={14} />}
              hint="The login this profile is signed into. Stored with your cloud data, in plaintext."
            >
              <input
                type="email"
                placeholder="you@example.com"
                value={draft.email}
                onChange={(event) => set({email: event.target.value})}
              />
            </Field>
            <Field label="Account password" icon={<KeyRound size={14} />}>
              <input
                type="password"
                autoComplete="new-password"
                value={draft.password}
                onChange={(event) => set({password: event.target.value})}
              />
            </Field>

            <section className="form-section wide compact-section">
              <div>
                <h3><Cookie size={15} /> Cookie import</h3>
                <p>Upload a JSON or Netscape cookies.txt file to cloud sync and import it when this profile launches.</p>
              </div>
              <div className="file-row wide">
                <button className="ghost" type="button" onClick={onPickCookies}>
                  Select cookies…
                </button>
                {draft.cookie_mode === 'saved' && draft.cookie_id ? (
                  <>
                    <span>{cookieLabel(draft.cookie_id)}</span>
                    <button
                      className="icon-button danger-icon"
                      type="button"
                      aria-label="Clear selected cookie-set"
                      onClick={() => set({cookie_mode: 'paste', cookie_id: ''})}
                    >
                      <Trash2 size={16} />
                    </button>
                  </>
                ) : draft.cookie_import_path || draft.cookie_import_url ? (
                  <>
                    <span>
                      {draft.cookie_import_count || 0} cookies · {draft.cookie_import_name ||
                        (draft.cookie_import_url ? 'Cloud cookie file' : draft.cookie_import_path)}
                    </span>
                    <button
                      className="icon-button danger-icon"
                      type="button"
                      aria-label="Clear cookie import"
                      onClick={() => set({
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
                <h3><Fingerprint size={15} /> Fingerprint</h3>
                <p>{draft.fingerprint_os} · {draft.fingerprint_browser_version} · {draft.fingerprint_webrtc}</p>
              </div>
              <button className="ghost" type="button" onClick={() => setFingerprintOpen(true)}>
                Edit fingerprint
              </button>
            </section>

            <Field label="Command line switches" icon={<Terminal size={14} />} wide>
              <textarea
                placeholder="--disable-features=ExampleFeature&#10;--lang=en-US"
                value={draft.command_line_switches}
                onChange={(event) => set({command_line_switches: event.target.value})}
              />
            </Field>
          </div>

          <ProfileSummary draft={draft} onRotate={rotate} />
        </div>

        <FingerprintDatalists />
      </Modal>

      {fingerprintOpen && (
        <Modal
          nested
          className="fingerprint-modal"
          onClose={() => setFingerprintOpen(false)}
          title="Edit fingerprint"
          subtitle="Profile-level browser identity settings stored with cloud data."
          footer={
            <>
              <button className="ghost" onClick={rotate}>Rotate fingerprint</button>
              <button onClick={() => setFingerprintOpen(false)}>Done</button>
            </>
          }
        >
          <div className="profile-form">
            <FingerprintFields draft={draft} onChange={onChange} onRotate={rotate} />
          </div>
        </Modal>
      )}
    </>
  );
}
