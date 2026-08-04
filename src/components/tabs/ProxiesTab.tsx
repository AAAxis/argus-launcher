import {useState} from 'react';
import {
  Download, FolderInput, FolderPlus, Pencil, Plus, SearchX, Trash2, Upload, Waypoints, X,
} from 'lucide-react';
import {MoveProxiesModal} from '../modals/MoveProxiesModal';
import {AssignedCell} from '../ui/AssignedCell';
import {EmptyState} from '../ui/EmptyState';
import {FolderGlyph} from '../ui/FolderGlyph';
import {FlagIcon} from '../ui/icons';
import {PaginationBar} from '../ui/PaginationBar';
import {
  isProxyAssigned, profilesUsingProxy, proxyCountryLabel, proxySearchText,
} from '../../lib/proxies';
import {paginate} from '../../lib/paginate';
import {profileColorStyle} from '../../lib/profileColors';
import {initials} from '../../lib/text';
import {SITE_URL} from '../../lib/auth';
import {PROXY_PROVIDERS, providerPath} from '../../data/proxyProviders';
import {native} from '../../native';
import {useSelection} from '../../hooks/useSelection';
import {useWorkspace} from '../../workspace/WorkspaceProvider';
import type {ArgusFolder, ArgusProfile, ArgusProxy} from '../../types';

export type ProxiesTabProps = {
  // Controlled by the shell, exactly like the Profiles tab's: creating a folder
  // from the dialog selects it here.
  folderId: string;
  onFolderId: (folderId: string) => void;
  onAddProxy: () => void;
  onImportProxies: () => void;
  onEditProxy: (proxy: ArgusProxy) => void;
  onNewFolder: () => void;
  onEditFolder: (folder: ArgusFolder) => void;
  // Set for one render after a folder is created from a country suggestion: the
  // move dialog opens on that folder with the country's proxies already ticked.
  // Cleared through onFillCountryDone when it closes.
  fillCountry: string;
  onFillCountryDone: () => void;
  onRequestDelete: (proxyIds: string[], label: string, onDeleted?: () => void) => void;
};

export function ProxiesTab({
  folderId,
  onFolderId,
  onAddProxy,
  onImportProxies,
  onEditProxy,
  onNewFolder,
  onEditFolder,
  fillCountry,
  onFillCountryDone,
  onRequestDelete,
}: ProxiesTabProps) {
  const {data, toast, library, proxies, checkingProxyId} = useWorkspace();
  const state = data.state;
  const selection = useSelection<ArgusProxy>();

  const [search, setSearch] = useState('');
  const [assignedFilter, setAssignedFilter] = useState<'' | 'assigned' | 'unassigned'>('');
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [moveOpen, setMoveOpen] = useState(false);

  const assigned = (proxy: ArgusProxy) => isProxyAssigned(proxy, state.profiles);
  const filtered = Boolean(search.trim() || assignedFilter);
  const visible = visibleProxies(state.proxies, {folderId, search, assignedFilter, assigned});
  const {items, page: clampedPage, totalPages, total} = paginate(visible, page, pageSize);

  const activeFolder = state.proxy_folders.find((folder) => folder.id === folderId) || null;
  const movableCount = activeFolder ?
    state.proxies.filter((proxy) => proxy.folder_id !== folderId).length :
    0;

  async function moveSelectionToFolder(nextFolderId: string) {
    if (!selection.size) {
      return;
    }
    const target = nextFolderId || null;
    if (!await proxies.assignToFolder([...selection.ids], target)) {
      return;
    }
    const folderName = target ?
      state.proxy_folders.find((folder) => folder.id === target)?.name :
      'All proxies';
    toast.setMessage(`${selection.size} ${selection.size === 1 ? 'proxy' : 'proxies'} moved to ${folderName || 'All proxies'}`);
  }

  // Deleting a folder never deletes what is in it: proxies.folder_id is nulled
  // (ON DELETE SET NULL server-side, mirrored locally by removeFolder), so they
  // reappear under All proxies rather than vanishing with the folder. The
  // confirmation says so, because "delete folder" reads like it should take
  // them with it -- and here it would read like cancelling the subscription.
  async function deleteFolder(folder: ArgusFolder) {
    const count = state.proxies.filter((proxy) => proxy.folder_id === folder.id).length;
    const consequence = count ?
      `Its ${count} ${count === 1 ? 'proxy' : 'proxies'} will move to All proxies.` :
      'It is empty.';
    if (!window.confirm(`Delete folder ${folder.name}? ${consequence}`)) {
      return;
    }
    if (!await library.removeFolder(folder.id)) {
      return;
    }
    // The view was pointed at a folder that no longer exists.
    if (folderId === folder.id) {
      onFolderId('');
    }
    toast.setMessage(`${folder.name} folder deleted`);
  }

  // Owning no proxies at all is a different situation from having filtered them
  // all away, and it gets the whole tab. The toolbar, the folder row and the
  // pager are dropped rather than disabled: a search box, an empty folder row
  // and a page selector over zero rows are the loudest thing on a screen whose
  // real job is to explain what a proxy is for and where to get one.
  if (state.proxies.length === 0) {
    return <ProxiesEmptyState onAddProxy={onAddProxy} onImportProxies={onImportProxies} />;
  }

  return (
    <>
      <section className="table-toolbar">
        <input
          type="text"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search proxies by name, host, or country"
        />
        <select
          value={assignedFilter}
          onChange={(event) => setAssignedFilter(event.target.value as '' | 'assigned' | 'unassigned')}
        >
          <option value="">All proxies</option>
          <option value="assigned">Assigned to a profile</option>
          <option value="unassigned">Not assigned</option>
        </select>
        {visible.length > 0 && (
          <button className="ghost" onClick={() => void proxies.exportToCsv(visible)}>
            <Download size={16} /> Export all
          </button>
        )}
      </section>

      {selection.size > 0 && (
        <section className="selection-toolbar">
          <div className="selection-toolbar-actions">
            <select value="" onChange={(event) => void moveSelectionToFolder(event.target.value)}>
              <option value="" disabled>Assign to folder…</option>
              <option value="">All proxies</option>
              {state.proxy_folders.map((folder) => (
                <option key={folder.id} value={folder.id}>{folder.name}</option>
              ))}
            </select>
            <button
              className="ghost"
              onClick={() => void proxies.exportToCsv(selection.selectedFrom(state.proxies))}
            >
              <Download size={16} /> Export selected
            </button>
            <button
              className="danger ghost"
              onClick={() => onRequestDelete(
                  [...selection.ids],
                  `${selection.size} selected ${selection.size === 1 ? 'proxy' : 'proxies'}`,
                  selection.clear)}
            >
              <Trash2 size={16} /> Delete selected
            </button>
          </div>
        </section>
      )}

      {/* The same folder navigation the Profiles tab has, minus Trash: a proxy
        * is deleted outright, there is no soft-delete to hold it. */}
      <section className="folder-row" aria-label="Folders">
        <button
          aria-pressed={!folderId}
          className={folderId ? 'folder-card' : 'folder-card active'}
          onClick={() => onFolderId('')}
          type="button"
        >
          <span className="folder-glyph"><Waypoints size={17} strokeWidth={1.75} /></span>
          <span className="folder-card-name">All proxies</span>
          <span className="folder-card-count">{state.proxies.length}</span>
        </button>

        {state.proxy_folders.map((folder) => {
          const count = state.proxies.filter((proxy) => proxy.folder_id === folder.id).length;
          const active = folder.id === folderId;
          return (
            // A div, not a button: the pencil and the trash are buttons of
            // their own, and nesting those inside the card's own button is
            // both invalid and unclickable.
            <div className={active ? 'folder-card active' : 'folder-card'} key={folder.id}>
              <button
                aria-pressed={active}
                className="folder-card-main"
                onClick={() => onFolderId(folder.id)}
                type="button"
              >
                <FolderGlyph color={folder.color} icon={folder.icon} />
                <span className="folder-card-name">{folder.name}</span>
              </button>
              <span className="folder-card-count">{count}</span>
              <span className="folder-card-actions">
                <button
                  aria-label={`Edit ${folder.name}`}
                  onClick={() => onEditFolder(folder)}
                  title={`Edit ${folder.name}`}
                  type="button"
                >
                  <Pencil size={13} />
                </button>
                <button
                  aria-label={`Delete ${folder.name}`}
                  className="danger-icon"
                  onClick={() => void deleteFolder(folder)}
                  title={`Delete ${folder.name}`}
                  type="button"
                >
                  <Trash2 size={13} />
                </button>
              </span>
            </div>
          );
        })}

        <button className="folder-card folder-card-new" onClick={onNewFolder} type="button">
          <span className="folder-glyph"><FolderPlus size={17} strokeWidth={1.75} /></span>
          <span className="folder-card-name">New folder</span>
        </button>
      </section>

      <section className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>
                {visible.length > 0 && (
                  <input
                    type="checkbox"
                    aria-label="Select all"
                    checked={selection.allSelected(visible)}
                    onChange={() => selection.toggleAll(visible)}
                  />
                )}
              </th>
              <th>Name</th>
              <th>Type</th>
              <th>Host</th>
              <th>Country</th>
              <th>Last check</th>
              <th>Folder</th>
              <th>Assigned to</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {items.map((proxy) => {
              const folder = state.proxy_folders.find((item) => item.id === proxy.folder_id);
              const label = proxy.name || proxy.host;
              return (
                <tr key={proxy.id} className={selection.has(proxy.id) ? 'row-checked' : ''}>
                  <td className="checkbox-cell">
                    <input
                      type="checkbox"
                      checked={selection.has(proxy.id)}
                      onChange={() => selection.toggle(proxy.id)}
                    />
                  </td>
                  <td className="name-cell">
                    <span className="proxy-flag" title={proxyCountryLabel(proxy) || 'Country not checked'}>
                      <FlagIcon countryCode={proxy.country_code} />
                    </span>
                    {label}
                  </td>
                  <td>{(proxy.type || 'http').toUpperCase()}</td>
                  <td className="proxy-host-cell">{proxy.host}:{proxy.port}</td>
                  <td>{proxyCountryLabel(proxy) || '-'}</td>
                  <td className={proxy.check_error ? 'proxy-check-cell failed' : 'proxy-check-cell'}>
                    {checkingProxyId === proxy.id ? 'Checking…' : describeLastCheck(proxy)}
                  </td>
                  <td>
                    {folder ? (
                      <span className="folder-label">
                        <FolderGlyph color={folder.color} icon={folder.icon} size={13} small />
                        {folder.name}
                      </span>
                    ) : 'All proxies'}
                  </td>
                  <td><AssignedCell holders={profilesUsingProxy(proxy, state.profiles)} /></td>
                  <td>
                    <button
                      aria-label={`Edit ${label}`}
                      className="ghost icon-button row-action"
                      onClick={() => onEditProxy(proxy)}
                      title={`Edit ${label}`}
                    >
                      <Pencil size={16} />
                    </button>
                    <button
                      aria-label={`Delete ${label}`}
                      className="ghost icon-button row-action row-action-danger"
                      onClick={() => onRequestDelete([proxy.id], label)}
                      title={`Delete ${label}`}
                    >
                      <Trash2 size={16} />
                    </button>
                  </td>
                </tr>
              );
            })}
            {items.length === 0 && (
              <tr className="empty-row-tr">
                {/* Nine columns. A short colSpan leaves a stray empty cell at
                  * the end of the row. */}
                <td colSpan={9}>
                  <EmptyState
                    icon={<SearchX size={22} />}
                    title={filtered ? 'Nothing matches those filters' : 'This folder is empty'}
                    body={filtered ?
                      'Try a different search term, or set the assignment filter back to All proxies.' :
                      'Proxies you move into this folder will show up here.'}
                  >
                    {!filtered && (
                      <>
                        <button onClick={onAddProxy} type="button">
                          <Plus size={16} /> Add proxy
                        </button>
                        {/* A brand-new folder is far more often filled from
                          * proxies that already exist than from scratch, and
                          * the only route to that was selecting rows in a
                          * table you have to leave this folder to see. */}
                        {activeFolder && movableCount > 0 && (
                          <button className="ghost" onClick={() => setMoveOpen(true)} type="button">
                            <FolderInput size={16} /> Move proxies here
                          </button>
                        )}
                      </>
                    )}
                  </EmptyState>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      <PaginationBar
        page={clampedPage}
        totalPages={totalPages}
        total={total}
        pageSize={pageSize}
        onPage={setPage}
        onPageSize={(size) => { setPageSize(size); setPage(0); }}
        extra={selection.size > 0 && (
          <span className="pagination-selected">{selection.size} selected</span>
        )}
      />

      {(moveOpen || fillCountry) && activeFolder && (
        <MoveProxiesModal
          folder={activeFolder}
          seedCountry={fillCountry || undefined}
          onClose={() => {
            setMoveOpen(false);
            onFillCountryDone();
          }}
        />
      )}
    </>
  );
}

// Dismissal is a per-device UI preference, not workspace data, so it lives in
// localStorage the same way the theme choice does -- read once on mount, written
// on change. A user who has their own provider should not have to re-close this
// on every visit.
const PROVIDERS_DISMISSED_KEY = 'argus.proxy-providers-dismissed';

function readProvidersDismissed() {
  try {
    return window.localStorage.getItem(PROVIDERS_DISMISSED_KEY) === '1';
  } catch {
    return false;
  }
}

function ProxiesEmptyState({onAddProxy, onImportProxies}: {
  onAddProxy: () => void;
  onImportProxies: () => void;
}) {
  const [dismissed, setDismissed] = useState(readProvidersDismissed);

  function setProvidersDismissed(next: boolean) {
    setDismissed(next);
    try {
      if (next) {
        window.localStorage.setItem(PROVIDERS_DISMISSED_KEY, '1');
      } else {
        window.localStorage.removeItem(PROVIDERS_DISMISSED_KEY);
      }
    } catch {
      // Private-mode or a wiped profile dir: the preference is not worth
      // failing the render over, it just will not survive a restart.
    }
  }

  return (
    <section className="tab-empty">
      <span className="tab-empty-mark">
        <Waypoints size={26} strokeWidth={1.5} />
      </span>
      <h2>No proxies yet</h2>
      <p>
        A profile needs a proxy before it can launch. Add one you already own,
        import the list your provider sent you, or pick up traffic from a
        provider below.
      </p>
      <div className="tab-empty-actions">
        <button onClick={onAddProxy}><Plus size={18} /> Add proxy</button>
        <button className="ghost" onClick={onImportProxies}>
          <Upload size={18} /> Import from file
        </button>
      </div>

      {dismissed ? (
        <button className="link-button" onClick={() => setProvidersDismissed(false)}>
          Show proxy providers
        </button>
      ) : (
        <ProviderStrip onDismiss={() => setProvidersDismissed(true)} />
      )}
    </section>
  );
}

// Every link goes to our own /go redirect rather than the provider directly:
// the main process only opens hosts we own, and it keeps the destination
// editable on the site. See providerPath in data/proxyProviders.
function ProviderStrip({onDismiss}: {onDismiss: () => void}) {
  return (
    <section className="provider-strip">
      <div className="provider-strip-head">
        <h3>Where to buy</h3>
        <button className="icon-button" aria-label="Hide proxy providers" onClick={onDismiss}>
          <X size={16} />
        </button>
      </div>
      <div className="provider-grid">
        {PROXY_PROVIDERS.map((provider) => {
          const Icon = provider.icon;
          return (
            <article className="provider-card" key={provider.slug}>
              {/* A wordmark says the name itself, so it replaces the heading
                * rather than sitting beside it. A provider we have no artwork
                * for keeps the Lucide glyph and the written name. */}
              <div className="provider-card-head">
                {provider.logo ? (
                  <img
                    alt={provider.name}
                    className={provider.adapt ?
                      `provider-logo ${provider.adapt}` :
                      'provider-logo'}
                    src={provider.logo}
                  />
                ) : (
                  <>
                    <Icon size={20} />
                    <h4>{provider.name}</h4>
                  </>
                )}
              </div>
              <p className="provider-kinds">{provider.kinds}</p>
              <p>{provider.blurb}</p>
              <button
                className="ghost"
                onClick={() => void native?.openExternal?.(`${SITE_URL}${providerPath(provider.slug)}`)}
              >
                Visit
              </button>
            </article>
          );
        })}
      </div>
    </section>
  );
}

// Short enough for a table cell. The card had room for country, IP and ping on
// one line; the country and the flag now have columns of their own, so what is
// left to say here is how it went and how long ago.
function describeLastCheck(proxy: ArgusProxy) {
  if (!proxy.checked_at) {
    return 'Not checked';
  }
  if (proxy.check_error) {
    return `Failed · ${proxy.check_error}`;
  }
  return `${proxy.ping_ms || 0} ms · ${sinceLabel(proxy.checked_at)}`;
}

// Coarse on purpose: a check is a background sweep, and "3h ago" is the only
// resolution anyone acts on. Anything older than a week is a date.
function sinceLabel(iso: string) {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) {
    return 'unknown';
  }
  const minutes = Math.floor((Date.now() - then) / 60000);
  if (minutes < 1) {
    return 'just now';
  }
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  const days = Math.floor(hours / 24);
  return days <= 7 ? `${days}d ago` : iso.slice(0, 10);
}

// Folder first, then the assignment filter, then the search narrows whatever
// those left -- the same order the Profiles tab filters in.
function visibleProxies(
    allProxies: ArgusProxy[],
    {folderId, search, assignedFilter, assigned}: {
      folderId: string;
      search: string;
      assignedFilter: '' | 'assigned' | 'unassigned';
      assigned: (proxy: ArgusProxy) => boolean;
    }) {
  const inFolder = folderId ?
    allProxies.filter((proxy) => proxy.folder_id === folderId) :
    allProxies;
  const byAssignment = assignedFilter ?
    inFolder.filter((proxy) => assigned(proxy) === (assignedFilter === 'assigned')) :
    inFolder;
  const query = search.trim().toLowerCase();
  if (!query) {
    return byAssignment;
  }
  // Port and username are matched too. Vendor lists name every proxy after its
  // host, so the port is often the only thing telling two of them apart.
  return byAssignment.filter((proxy) => proxySearchText(proxy).includes(query));
}
