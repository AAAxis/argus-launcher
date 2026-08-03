// Dialogs that add things to the shared library, or report what a bulk action
// did: the cookie-set picker, the extension adder, and the CSV importer.
import {useEffect, useState} from 'react';
import {Upload} from 'lucide-react';
import {BusyButton} from '../ui/BusyButton';
import {Modal} from '../ui/Modal';
import {parseCsv} from '../../lib/csv';
import {parseWebstoreExtensionId} from '../../lib/extensions';
import {native} from '../../native';
import {useAsyncAction} from '../../useAsyncAction';
import {useWorkspace} from '../../workspace/WorkspaceProvider';
import type {ImportResult} from '../../workspace/useProfileActions';
import type {ArgusCookie} from '../../types';

export function CookiePickerModal({search, onSearch, selectedId, onSelect, onClose}: {
  search: string;
  onSearch: (value: string) => void;
  selectedId: string;
  onSelect: (cookie: ArgusCookie) => void;
  onClose: () => void;
}) {
  const {data, toast, library} = useWorkspace();
  const {run, isPending} = useAsyncAction();
  const query = search.trim().toLowerCase();
  const results = query ?
    data.state.cookies.filter((cookie) => cookie.name.toLowerCase().includes(query)) :
    data.state.cookies;

  async function upload() {
    if (!native?.selectCookieFile) {
      toast.setMessage('Native cookie file picker is not available. Restart Argus Launcher and try again.');
      return;
    }
    try {
      const selection = await native.selectCookieFile();
      if (!selection) {
        return;
      }
      const entry = await library.addCookieSet(selection);
      if (!entry) {
        return;
      }
      onSelect(entry);
      toast.setMessage(`Added "${entry.name}" to the cookie library`);
    } catch (error) {
      toast.setMessage(error instanceof Error ? error.message : String(error));
    }
  }

  return (
    <Modal
      className="small-modal cookie-picker-modal"
      onClose={onClose}
      title="Select cookies"
      subtitle="Pick a saved cookie-set, or upload a new JSON/Netscape file to the library."
      footer={
        <>
          <BusyButton
            className="ghost"
            busy={isPending('pick-cookie-file')}
            busyLabel="Uploading…"
            onClick={() => void run('pick-cookie-file', upload)}
          >
            Upload new
          </BusyButton>
          <button type="button" onClick={onClose}>Save</button>
        </>
      }
    >
      <input
        type="text"
        placeholder="Search cookie-sets…"
        value={search}
        onChange={(event) => onSearch(event.target.value)}
      />
      <div className="cookie-picker-list">
        {results.length === 0 && (
          <p className="empty-state">
            No saved cookie-sets{search.trim() ? ' match your search' : ' yet'}.
          </p>
        )}
        {results.map((cookie) => (
          <button
            type="button"
            key={cookie.id}
            className={selectedId === cookie.id ? 'cookie-picker-row active' : 'cookie-picker-row'}
            onClick={() => onSelect(cookie)}
          >
            <span>{cookie.name}</span>
            <small>{cookie.count ? `${cookie.count} cookies` : ''}</small>
          </button>
        ))}
      </div>
    </Modal>
  );
}

export function ExtensionAddModal({onClose}: {onClose: () => void}) {
  const {toast, library} = useWorkspace();
  const [link, setLink] = useState('');
  const [name, setName] = useState('');

  async function addFromLink() {
    const webstoreId = parseWebstoreExtensionId(link);
    if (!webstoreId) {
      toast.setMessage('That doesn\'t look like a Chrome Web Store link or extension id.');
      return;
    }
    if (await library.addExtensionFromWebStore(webstoreId, name)) {
      onClose();
    }
  }

  const submitOnEnter = (event: {key: string}) => {
    if (event.key === 'Enter' && link.trim()) {
      void addFromLink();
    }
  };

  return (
    <Modal
      className="small-modal extension-add-modal"
      onClose={onClose}
      title="Add extension"
      subtitle="Share a Chrome Web Store extension or upload an unpacked folder."
    >
      <section className="extension-add-section">
        <label className="field wide">
          <span>Chrome Web Store link or extension ID</span>
          <input
            autoFocus
            type="text"
            placeholder="https://chromewebstore.google.com/detail/..."
            value={link}
            onChange={(event) => setLink(event.target.value)}
            onKeyDown={submitOnEnter}
          />
        </label>
        <label className="field wide">
          <span>Name (optional)</span>
          <input
            type="text"
            placeholder="Defaults to the extension id"
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={submitOnEnter}
          />
        </label>
        <div className="extension-add-actions">
          <button disabled={!link.trim()} onClick={() => void addFromLink()}>
            Add from link
          </button>
          <button
            className="ghost"
            onClick={() => void library.addExtensionFromFolder().then((ok) => ok && onClose())}
          >
            Add from folder
          </button>
        </div>
      </section>
    </Modal>
  );
}

export function ImportModal({onClose}: {onClose: () => void}) {
  const {toast, profiles} = useWorkspace();
  const [file, setFile] = useState<{path: string; rows: Record<string, string>[]} | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const {run, isPending} = useAsyncAction();

  // Opening this dialog is always the Import button, and the first thing that
  // button used to do was raise the OS file picker -- so it still does. Cancel
  // the picker and the dialog stays put with its own Choose CSV button.
  useEffect(() => {
    void pickCsv();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function pickCsv() {
    if (!native?.selectImportCsv) {
      toast.setMessage('Native CSV picker is not available. Restart Argus Launcher and try again.');
      return;
    }
    const picked = await native.selectImportCsv();
    if (!picked) {
      return;
    }
    setResult(null);
    setFile({path: picked.path, rows: parseCsv(picked.content)});
  }

  async function runImport() {
    if (!file?.rows.length) {
      return;
    }
    const imported = await profiles.importFromCsv(file.rows);
    if (!imported) {
      return;
    }
    setResult(imported);
    setFile(null);
    toast.setMessage(`Imported ${imported.created} new, updated ${imported.updated} profiles`);
  }

  return (
    <Modal
      className="import-panel"
      onClose={onClose}
      title="Mass import profiles"
      subtitle={
        <>
          Import profiles in bulk from a Dolphin-style inventory CSV (the same format exported by
          the profiles-cookie-inventory tooling). Each row's proxy_name must carry the
          <code>type://host:port:username:password</code> connection string; proxies are matched
          and reused by host/port/username, and re-importing the same CSV updates existing profiles
          (matched by profile_id) instead of duplicating them.
        </>
      }
    >
      <div className="import-actions">
        <button className="ghost" onClick={() => void pickCsv()}>
          <Upload size={18} /> Choose CSV file
        </button>
        {file && (
          <span className="import-file-label">
            {file.path.split('/').pop()} — {file.rows.length} row{file.rows.length === 1 ? '' : 's'}
          </span>
        )}
      </div>
      {file && (
        <BusyButton
          busy={isPending('run-import')}
          busyLabel="Importing…"
          onClick={() => void run('run-import', runImport)}
        >
          Import {file.rows.length} profile{file.rows.length === 1 ? '' : 's'}
        </BusyButton>
      )}
      {result && <ImportSummary result={result} />}
    </Modal>
  );
}

function ImportSummary({result}: {result: ImportResult}) {
  const counts: Array<[string, number]> = [
    ['Profiles created', result.created],
    ['Profiles updated', result.updated],
    ['Proxies created', result.proxiesCreated],
    ['Proxies reused', result.proxiesReused],
    ['Folders created', result.foldersCreated],
  ];
  return (
    <div className="import-summary">
      {counts.map(([label, value]) => (
        <div className="summary-item" key={label}>
          <span>{label}</span>
          <strong>{value}</strong>
        </div>
      ))}
      {result.skipped.length > 0 && (
        <div className="summary-item wide">
          <span>Skipped ({result.skipped.length})</span>
          <div className="summary-lines">
            {result.skipped.map((item, index) => (
              <i key={index}>{item.name}: {item.reason}</i>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
