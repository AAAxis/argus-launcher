// The small record editors: proxy, bookmark, folder and custom status. Each is
// a handful of fields over the shared Modal shell.
import {useState} from 'react';
import {AlertCircle, Folder as FolderIcon, LayoutGrid, PlugZap, Trash2} from 'lucide-react';
import {Modal} from '../ui/Modal';
import {BusyButton} from '../ui/BusyButton';
import {Field} from '../ui/Field';
import {IconPicker} from '../ui/IconPicker';
import {FlagIcon} from '../ui/icons';
import {normalizeBookmarkUrl} from '../../lib/bookmarks';
import {useWorkspace} from '../../workspace/WorkspaceProvider';
import type {BookmarkDraft, FolderDraft, ProxyDraft, StatusDraft} from '../../drafts';
import type {ProxyCheckResult} from '../../native';
import type {SharedBookmark} from '../../types';

export function ProxyModal({draft, source, onChange, onClose, onSaved, onRequestDelete}: {
  draft: ProxyDraft;
  // 'profile' when the dialog was opened from the profile editor's "create new
  // proxy" field, which changes the wording and assigns the result back.
  source: 'profile' | null;
  onChange: (draft: ProxyDraft) => void;
  onClose: () => void;
  onSaved: (proxyId: string, fromProfile: boolean) => void;
  onRequestDelete: (proxyIds: string[], label: string) => void;
}) {
  const {data, toast, proxies} = useWorkspace();
  const [testResult, setTestResult] = useState<ProxyCheckResult | null>(null);
  const [testing, setTesting] = useState(false);

  // A result describes the connection details it was run against, so any edit
  // to those invalidates it -- otherwise a green "United States · 84ms" would
  // sit above a host the user has since retyped. Name is not a connection
  // detail, so renaming leaves the result standing.
  const set = (patch: Partial<ProxyDraft>) => {
    const connectionChanged = ['type', 'host', 'port', 'username', 'password']
        .some((key) => key in patch);
    if (connectionChanged) {
      setTestResult(null);
    }
    onChange({...draft, ...patch});
  };

  // Host plus a port in range is all either action needs; save() and
  // testConnection() share it so they can never disagree about what is valid.
  function connection() {
    const host = draft.host.trim();
    const port = Number(draft.port);
    if (!host || !Number.isInteger(port) || port < 1 || port > 65535) {
      toast.setMessage('Proxy host and valid port are required');
      return null;
    }
    return {host, port, type: draft.type, username: draft.username.trim(), password: draft.password};
  }

  async function test() {
    const config = connection();
    if (!config) {
      return;
    }
    setTesting(true);
    setTestResult(null);
    try {
      const result = await proxies.testConnection(config);
      setTestResult(result);
      // A pass against an existing row whose connection details are untouched
      // describes that row, so record it: the card behind the dialog updates
      // now instead of waiting for the next background sweep. When the details
      // were edited the result belongs to something not yet saved, and save()
      // deliberately clears the stored check for exactly that reason.
      const stored = draft.id ? data.state.proxies.find((item) => item.id === draft.id) : undefined;
      const describesStored = stored &&
        stored.type === config.type &&
        stored.host === config.host &&
        stored.port === config.port &&
        (stored.username || '') === config.username &&
        (stored.password || '') === config.password;
      if (result.ok && stored && describesStored) {
        await proxies.recordCheck({
          ...stored,
          country: result.country,
          country_code: result.countryCode,
          egress_ip: result.ip,
          ping_ms: result.pingMs,
          checked_at: new Date().toISOString(),
          check_error: undefined,
        });
      }
    } finally {
      setTesting(false);
    }
  }

  async function save() {
    const config = connection();
    if (!config) {
      return;
    }
    const saved = await proxies.save({
      id: draft.id,
      name: draft.name.trim(),
      ...config,
    });
    if (!saved) {
      return;
    }
    const fromProfile = !draft.id && source === 'profile';
    onSaved(saved.id, fromProfile);
    toast.setMessage(fromProfile ? `${saved.name} proxy created and assigned` : `${saved.name} saved`);
  }

  return (
    <Modal
      className="small-modal proxy-modal"
      onClose={onClose}
      title={draft.id ? 'Edit proxy' : source === 'profile' ? 'Name your proxy' : 'Add proxy'}
      subtitle={source === 'profile' ?
        'Create a proxy and assign it to this profile.' :
        'Proxy settings are stored in Argus Launcher and assigned to profiles on launch.'}
      footer={
        <>
          {draft.id && (
            <button
              className="danger ghost"
              onClick={() => onRequestDelete([draft.id as string], draft.name || draft.host)}
            >
              <Trash2 size={16} /> Delete
            </button>
          )}
          <BusyButton
            busy={testing}
            busyLabel="Testing…"
            className="ghost"
            icon={<PlugZap size={16} />}
            onClick={() => void test()}
          >
            Test connection
          </BusyButton>
          <button onClick={() => void save()}>
            {draft.id ? 'Save changes' : source === 'profile' ? 'Create and assign' : 'Add proxy'}
          </button>
        </>
      }
    >
      <div className="profile-form">
        <label className="field">
          <span>Type</span>
          <select
            value={draft.type}
            onChange={(event) => set({type: event.target.value as ProxyDraft['type']})}
          >
            <option value="socks5">SOCKS5</option>
            <option value="http">HTTP</option>
          </select>
        </label>
        <label className="field">
          <span>Name</span>
          <input
            autoFocus
            type="text"
            placeholder="US socks proxy"
            value={draft.name}
            onChange={(event) => set({name: event.target.value})}
          />
        </label>
        <label className="field">
          <span>Host</span>
          <input
            type="text"
            placeholder="1.2.3.4"
            value={draft.host}
            onChange={(event) => set({host: event.target.value})}
          />
        </label>
        <label className="field">
          <span>Port</span>
          <input
            type="text"
            inputMode="numeric"
            placeholder="1080"
            value={draft.port}
            onChange={(event) => set({port: event.target.value.replace(/[^\d]/g, '')})}
          />
        </label>
        <label className="field">
          <span>Username</span>
          <input
            type="text"
            placeholder="Optional"
            value={draft.username}
            onChange={(event) => set({username: event.target.value})}
          />
        </label>
        <label className="field">
          <span>Password</span>
          <input
            placeholder="Optional"
            type="password"
            value={draft.password}
            onChange={(event) => set({password: event.target.value})}
          />
        </label>
        {testResult && <ProxyTestResult result={testResult} />}
      </div>
    </Modal>
  );
}

// The outcome of "Test connection", inline under the fields rather than in a
// toast: the user is usually still editing the credentials that produced it,
// and a failure they have to re-read is worth more than one that times out.
function ProxyTestResult({result}: {result: ProxyCheckResult}) {
  if (!result.ok) {
    return (
      <p className="proxy-test-result failed">
        <AlertCircle size={16} />
        <span>{result.error || 'Proxy check failed'}</span>
      </p>
    );
  }
  const where = result.country || result.countryCode || 'Unknown location';
  return (
    <p className="proxy-test-result ok">
      <span className="proxy-flag"><FlagIcon countryCode={result.countryCode} /></span>
      <span>Connected · {where} · {result.ip || 'No IP'} · {result.pingMs || 0}ms</span>
    </p>
  );
}

export function BookmarkModal({draft, onChange, onClose}: {
  draft: BookmarkDraft;
  onChange: (draft: BookmarkDraft) => void;
  onClose: () => void;
}) {
  const {toast, library} = useWorkspace();
  const set = (patch: Partial<BookmarkDraft>) => onChange({...draft, ...patch});

  async function save() {
    const url = normalizeBookmarkUrl(draft.url);
    if (!url) {
      toast.setMessage('Bookmark URL is required');
      return;
    }
    const bookmark: SharedBookmark = {
      title: draft.title.trim() || url,
      url,
      icon: draft.icon.trim() || undefined,
    };
    if (!await library.saveBookmark(bookmark, draft.originalUrl)) {
      return;
    }
    onClose();
    toast.setMessage(`${bookmark.title} saved`);
  }

  async function remove() {
    if (!draft.originalUrl) {
      onClose();
      return;
    }
    if (!await library.removeBookmark(draft.originalUrl)) {
      return;
    }
    onClose();
    toast.setMessage('Bookmark deleted');
  }

  return (
    <Modal
      onClose={onClose}
      title={draft.originalUrl ? 'Edit bookmark' : 'Add bookmark'}
      subtitle="Shared bookmarks are injected into each anonymous browser home page."
      footer={
        <>
          {draft.originalUrl && (
            <button className="danger ghost" onClick={() => void remove()}>
              <Trash2 size={16} /> Delete
            </button>
          )}
          <button onClick={() => void save()}>
            {draft.originalUrl ? 'Save changes' : 'Add bookmark'}
          </button>
        </>
      }
    >
      <div className="profile-form">
        <label className="field wide">
          <span>Name</span>
          <input
            type="text"
            autoFocus
            placeholder="Facebook"
            value={draft.title}
            onChange={(event) => set({title: event.target.value})}
          />
        </label>
        <label className="field wide">
          <span>URL</span>
          <input
            type="text"
            placeholder="https://www.facebook.com/"
            value={draft.url}
            onChange={(event) => set({url: event.target.value})}
          />
        </label>
        <label className="field wide">
          <span>Icon URL</span>
          <input
            type="text"
            placeholder="Optional favicon URL"
            value={draft.icon}
            onChange={(event) => set({icon: event.target.value})}
          />
        </label>
      </div>
    </Modal>
  );
}

export function FolderModal({draft, onChange, onClose, onCreated}: {
  draft: FolderDraft;
  onChange: (draft: FolderDraft) => void;
  onClose: () => void;
  onCreated: (folderId: string) => void;
}) {
  const {data, toast, library} = useWorkspace();

  async function save() {
    const name = draft.name.trim();
    if (!name) {
      toast.setMessage('Folder name is required');
      return;
    }
    if (draft.id) {
      if (!await library.saveFolder(draft.id, {name, icon: draft.icon})) {
        return;
      }
      onClose();
      toast.setMessage(`${name} folder saved`);
      return;
    }
    const folder = await library.createFolder(name, draft.icon);
    if (!folder) {
      return;
    }
    onCreated(folder.id);
    onClose();
    toast.setMessage(`${folder.name} folder created`);
  }

  async function remove() {
    const folder = data.state.folders.find((item) => item.id === draft.id);
    onClose();
    if (!folder) {
      return;
    }
    if (!window.confirm(`Delete folder ${folder.name}? Profiles will move to All profiles.`)) {
      return;
    }
    if (await library.removeFolder(folder.id)) {
      toast.setMessage(`${folder.name} folder deleted`);
    }
  }

  return (
    <Modal
      className="small-modal"
      onClose={onClose}
      title={draft.id ? 'Edit folder' : 'Create folder'}
      subtitle="Folders organize launcher profiles only. Browser sessions stay separate."
      footer={
        <>
          {draft.id && (
            <button className="danger ghost" onClick={() => void remove()}>
              <Trash2 size={16} /> Delete
            </button>
          )}
          <button onClick={() => void save()}>
            {draft.id ? 'Save changes' : 'Create folder'}
          </button>
        </>
      }
    >
      <div className="profile-form">
        <Field label="Name" icon={<FolderIcon size={14} />} wide>
          <input
            type="text"
            autoFocus
            placeholder="Warmup"
            value={draft.name}
            onChange={(event) => onChange({...draft, name: event.target.value})}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                void save();
              }
            }}
          />
        </Field>
        <Field
          label="Icon"
          icon={<LayoutGrid size={14} />}
          hint="Shown next to the folder in the profiles list."
          wide
          group
        >
          <IconPicker value={draft.icon} onChange={(icon) => onChange({...draft, icon})} />
        </Field>
      </div>
    </Modal>
  );
}

export function StatusModal({draft, onChange, onClose}: {
  draft: StatusDraft;
  onChange: (draft: StatusDraft) => void;
  onClose: () => void;
}) {
  const {toast, library} = useWorkspace();

  async function save() {
    const name = draft.name.trim();
    if (!name) {
      toast.setMessage('Status name is required');
      return;
    }
    if (!await library.createStatus(name)) {
      return;
    }
    onClose();
    toast.setMessage(`${name} status created`);
  }

  return (
    <Modal
      className="small-modal"
      onClose={onClose}
      title="Create status"
      subtitle="Custom statuses become available in every profile dropdown."
      footer={<button onClick={() => void save()}>Create status</button>}
    >
      <div className="profile-form">
        <label className="field wide">
          <span>Name</span>
          <input
            type="text"
            autoFocus
            placeholder="Paused"
            value={draft.name}
            onChange={(event) => onChange({name: event.target.value})}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                void save();
              }
            }}
          />
        </label>
      </div>
    </Modal>
  );
}
