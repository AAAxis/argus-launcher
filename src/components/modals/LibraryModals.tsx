// Dialogs that add things to the shared library, or report what a bulk action
// did: the cookie-set picker, the extension adder, and the CSV importer.
import {useEffect, useState} from 'react';
import {Download, Upload} from 'lucide-react';
import {BusyButton} from '../ui/BusyButton';
import {Modal} from '../ui/Modal';
import {
  importColumns, profileImportExampleCsv, proxyImportExampleList,
} from '../../data/importTemplate';
import {parseBookmarkFile} from '../../lib/bookmarkImport';
import {parseCsv} from '../../lib/csv';
import {parseWebstoreExtensionId} from '../../lib/extensions';
import {parseProxyList} from '../../lib/proxies';
import {MAX_PROFILE_TAGS} from '../../lib/tags';
import {native} from '../../native';
import {useAsyncAction} from '../../useAsyncAction';
import {useWorkspace} from '../../workspace/WorkspaceProvider';
import type {ParsedBookmark} from '../../lib/bookmarkImport';
import type {ParsedProxyLine} from '../../lib/proxies';
import type {ImportResult} from '../../workspace/useProfileActions';
import type {ArgusCookie} from '../../types';

export function CookiePickerModal({search, onSearch, selectedId, onSelect, onClose}: {
  search: string;
  onSearch: (value: string) => void;
  selectedId: string;
  onSelect: (cookie: ArgusCookie) => void;
  onClose: () => void;
}) {
  const {data, toast, cookies} = useWorkspace();
  const {run, isPending} = useAsyncAction();
  const query = search.trim().toLowerCase();
  // Trashed sets are not offerable: assigning one would put a profile back on
  // cookies the user has already thrown away, and the launch path refuses to
  // resolve it anyway.
  const live = data.state.cookies.filter((cookie) => !cookie.deleted_at);
  const results = query ?
    live.filter((cookie) => cookie.name.toLowerCase().includes(query)) :
    live;

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
      const entry = await cookies.addCookieSet(selection);
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
        {results.map((cookie) => {
          const folder = data.state.cookie_folders.find((item) => item.id === cookie.folder_id);
          return (
            <button
              type="button"
              key={cookie.id}
              className={selectedId === cookie.id ? 'cookie-picker-row active' : 'cookie-picker-row'}
              onClick={() => onSelect(cookie)}
            >
              <span>{cookie.name}</span>
              {/* The folder, because two sets called "cookies.txt" are only
                * telling apart by where they were filed. */}
              <small>
                {[folder?.name, cookie.count ? `${cookie.count} cookies` : '']
                    .filter(Boolean).join(' · ')}
              </small>
            </button>
          );
        })}
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
          Import profiles in bulk from a Dolphin-style inventory CSV. Re-importing the same file
          updates the profiles it already created (matched by <code>profile_id</code>) rather than
          duplicating them.
        </>
      }
    >
      <div className="import-actions">
        <button className="ghost" onClick={() => void pickCsv()}>
          <Upload size={18} /> Choose CSV file
        </button>
        <button
          className="ghost"
          onClick={() => void saveExample('argus-profiles-example.csv',
              profileImportExampleCsv(), 'text/csv', toast.setMessage)}
        >
          <Download size={18} /> Download example
        </button>
        {file && (
          <span className="import-file-label">
            {file.path.split('/').pop()} — {file.rows.length} row{file.rows.length === 1 ? '' : 's'}
          </span>
        )}
      </div>
      <dl className="import-columns">
        {importColumns.map((column) => (
          <div key={column.name}>
            <dt>
              <code>{column.name}</code>
              {column.required && <em>required</em>}
            </dt>
            <dd>{column.note}</dd>
          </div>
        ))}
      </dl>
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

// The file the "Download example" buttons write is not a starting point the
// user then has to correct: each one round-trips through its own importer
// unchanged, which is the only way to make "here is the format" verifiable
// rather than a claim.
//
// Shared by both importers because the saving is the same either way: the
// native picker when the app is packaged, and an anchor when this is running
// in a browser tab during development.
async function saveExample(
    fileName: string, content: string, mime: string, say: (message: string) => void) {
  const kind = fileName.endsWith('.csv') ? 'CSV' : 'list';
  if (native?.saveTextFile) {
    const savedPath = await native.saveTextFile(fileName, content);
    if (savedPath) {
      say(`Saved example ${kind} to ${savedPath.split('/').pop()}`);
    }
    return;
  }
  const url = URL.createObjectURL(new Blob([content], {type: mime}));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
  say(`Downloaded example ${kind}`);
}

// Bulk-adds proxies from a vendor list file. Deliberately separate from
// ImportModal above: that one imports profiles from a structured CSV with
// named columns, this one takes a bare list of connection strings, which needs
// a different preview (per-line status) and a different failure mode (a bad
// line, not a bad column).
export function ProxyImportModal({onClose}: {onClose: () => void}) {
  const {data, toast, proxies} = useWorkspace();
  const [file, setFile] = useState<{path: string; lines: ParsedProxyLine[]} | null>(null);
  // Vendor lists are bare host:port:user:pass with no scheme, so the type is a
  // property of the file, not of any line in it -- one selector for the lot.
  const [type, setType] = useState<'http' | 'socks5'>('socks5');
  const {run, isPending} = useAsyncAction();

  // Same bargain as the profile importer: the button that opens this dialog
  // raises the picker straight away, and cancelling leaves the dialog up with
  // its own Choose file button.
  useEffect(() => {
    void pickFile();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function pickFile() {
    if (!native?.selectProxyFile) {
      toast.setMessage('Native file picker is not available. Restart Argus Launcher and try again.');
      return;
    }
    const picked = await native.selectProxyFile();
    if (!picked) {
      return;
    }
    setFile({path: picked.path, lines: parseProxyList(picked.content, data.state.proxies)});
  }

  const importable = file?.lines.filter((entry) => entry.proxy && !entry.duplicate) || [];
  const duplicates = file?.lines.filter((entry) => entry.duplicate).length || 0;
  const invalid = file?.lines.filter((entry) => !entry.proxy) || [];

  async function runImport() {
    if (!importable.length) {
      return;
    }
    const result = await proxies.importList(importable.map((entry) => ({
      ...entry.proxy as NonNullable<ParsedProxyLine['proxy']>,
      type: entry.explicitType ? entry.proxy?.type : type,
    })));
    setFile(null);
    // The country column stays empty for a moment on purpose: the rows land
    // unchecked and useBackgroundProxyChecks fills in country, IP and ping a
    // few at a time, rather than firing one curl per proxy at import.
    toast.setMessage(result.failed.length ?
      `Imported ${result.created} ${result.created === 1 ? 'proxy' : 'proxies'} · ${result.failed.length} failed · checking countries in the background` :
      `Imported ${result.created} ${result.created === 1 ? 'proxy' : 'proxies'} · checking countries in the background`);
    if (!result.failed.length) {
      onClose();
    }
  }

  return (
    <Modal
      className="import-panel proxy-import-panel"
      onClose={onClose}
      title="Import proxies from a file"
      subtitle={
        <>
          One proxy per line, in the form <code>host:port:username:password</code> — the format
          every vendor hands out. Lines starting with <code>#</code> are ignored, each proxy is
          named after its host and port, and the country is filled in automatically once the
          background check has run.
        </>
      }
    >
      <div className="import-actions">
        <button className="ghost" onClick={() => void pickFile()}>
          <Upload size={18} /> Choose proxy file
        </button>
        <button
          className="ghost"
          onClick={() => void saveExample('argus-proxies-example.txt',
              proxyImportExampleList(), 'text/plain', toast.setMessage)}
        >
          <Download size={18} /> Download example
        </button>
        <label className="field inline-field">
          <span>Type</span>
          <select value={type} onChange={(event) => setType(event.target.value as 'http' | 'socks5')}>
            <option value="socks5">SOCKS5</option>
            <option value="http">HTTP</option>
          </select>
        </label>
        {file && (
          <span className="import-file-label">
            {file.path.split('/').pop()} — {file.lines.length} line{file.lines.length === 1 ? '' : 's'}
          </span>
        )}
      </div>

      {file && (
        <>
          <div className="import-summary">
            <div className="summary-item"><span>Ready to import</span><strong>{importable.length}</strong></div>
            <div className="summary-item"><span>Already in your list</span><strong>{duplicates}</strong></div>
            <div className="summary-item"><span>Unreadable lines</span><strong>{invalid.length}</strong></div>
          </div>
          <div className="proxy-import-preview">
            {file.lines.map((entry) => (
              <div className="proxy-import-row" key={entry.line}>
                <span className="proxy-import-line">{entry.line}</span>
                <span className="proxy-import-target">
                  {entry.proxy ? `${entry.proxy.host}:${entry.proxy.port}` : entry.raw}
                </span>
                <span className={entry.proxy && !entry.duplicate ?
                  'proxy-badge assigned' :
                  'proxy-badge unassigned'}
                >
                  {!entry.proxy ? entry.error : entry.duplicate ? 'Already added' : 'New'}
                </span>
              </div>
            ))}
          </div>
          <BusyButton
            busy={isPending('run-proxy-import')}
            busyLabel="Importing…"
            disabled={!importable.length}
            onClick={() => void run('run-proxy-import', runImport)}
          >
            Import {importable.length} {importable.length === 1 ? 'proxy' : 'proxies'}
          </BusyButton>
        </>
      )}
    </Modal>
  );
}

// Bulk-adds bookmarks from a browser's exported HTML file. Same shape as
// ProxyImportModal above -- pick a file, see what is in it, confirm -- because
// the failure the user needs to see is the same: which rows are new, and which
// are already here.
export function BookmarkImportModal({onClose}: {onClose: () => void}) {
  const {data, toast, library} = useWorkspace();
  const [file, setFile] = useState<{path: string; entries: ParsedBookmark[]} | null>(null);
  const {run, isPending} = useAsyncAction();

  // Same bargain as the other importers: the button that opens this dialog
  // raises the picker straight away, and cancelling leaves the dialog up with
  // its own Choose file button.
  useEffect(() => {
    void pickFile();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function pickFile() {
    if (!native?.selectBookmarkFile) {
      toast.setMessage('Native file picker is not available. Restart Argus Launcher and try again.');
      return;
    }
    const picked = await native.selectBookmarkFile();
    if (!picked) {
      return;
    }
    setFile({
      path: picked.path,
      entries: parseBookmarkFile(picked.content, data.state.shared_bookmarks),
    });
  }

  const importable = file?.entries.filter((entry) => !entry.duplicate) || [];
  const duplicates = file?.entries.filter((entry) => entry.duplicate).length || 0;

  async function runImport() {
    if (!importable.length) {
      return;
    }
    const created = await library.importBookmarks(importable.map((entry) => ({
      title: entry.title,
      url: entry.url,
      icon: entry.icon,
    })));
    if (!created) {
      return;
    }
    toast.setMessage(`Imported ${created} bookmark${created === 1 ? '' : 's'}`);
    onClose();
  }

  return (
    <Modal
      className="import-panel proxy-import-panel"
      onClose={onClose}
      title="Import bookmarks"
      subtitle={
        <>
          In Chrome, open <code>chrome://bookmarks</code> → ⋮ → <b>Export bookmarks</b>, then
          choose that file here. Edge, Firefox, Safari and Brave all export the same format.
          Folders are flattened — shared bookmarks are one list — and anything already in your
          workspace is skipped.
        </>
      }
    >
      <div className="import-actions">
        <button className="ghost" onClick={() => void pickFile()}>
          <Upload size={18} /> Choose bookmarks file
        </button>
        {file && (
          <span className="import-file-label">
            {file.path.split('/').pop()} — {file.entries.length}{' '}
            bookmark{file.entries.length === 1 ? '' : 's'}
          </span>
        )}
      </div>

      {file && (
        <>
          <div className="import-summary">
            <div className="summary-item"><span>Ready to import</span><strong>{importable.length}</strong></div>
            <div className="summary-item"><span>Already in your list</span><strong>{duplicates}</strong></div>
          </div>
          <div className="proxy-import-preview">
            {file.entries.map((entry, index) => (
              <div className="proxy-import-row" key={`${entry.url}-${index}`}>
                <span className="proxy-import-line">{entry.folder || '—'}</span>
                <span className="proxy-import-target" title={entry.url}>{entry.title}</span>
                <span className={entry.duplicate ? 'proxy-badge unassigned' : 'proxy-badge assigned'}>
                  {entry.duplicate ? 'Already added' : 'New'}
                </span>
              </div>
            ))}
          </div>
          <BusyButton
            busy={isPending('run-bookmark-import')}
            busyLabel="Importing…"
            disabled={!importable.length}
            onClick={() => void run('run-bookmark-import', runImport)}
          >
            Import {importable.length} bookmark{importable.length === 1 ? '' : 's'}
          </BusyButton>
        </>
      )}
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
  // Only when it happened. A permanent "Tags trimmed 0" row would read as a
  // warning the importer is always half-raising.
  if (result.tagsTrimmed) {
    counts.push([`Rows trimmed to ${MAX_PROFILE_TAGS} tags`, result.tagsTrimmed]);
  }
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
