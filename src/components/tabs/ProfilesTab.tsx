import {useState} from 'react';
import {
  BookOpen, Cookie, Download, FolderPlus, Pencil, Play, SearchX, Trash2, UserPlus, UsersRound,
} from 'lucide-react';
import {BusyButton} from '../ui/BusyButton';
import {PaginationBar} from '../ui/PaginationBar';
import {PlatformIcon} from '../ui/icons';
import {daysUntilPurge, TRASH_FOLDER_ID} from '../../lib/trash';
import {initials} from '../../lib/text';
import {paginate} from '../../lib/paginate';
import {profileColorStyle} from '../../lib/profileColors';
import {folderIcon} from '../../data/folderIcons';
import {statusSelectClass} from '../../data/statuses';
import {native} from '../../native';
import {useAsyncAction} from '../../useAsyncAction';
import {useSelection} from '../../hooks/useSelection';
import {useWorkspace} from '../../workspace/WorkspaceProvider';
import type {ReactNode} from 'react';
import type {ArgusFolder, ArgusProfile} from '../../types';

export type ProfilesTabProps = {
  // Controlled by the shell: creating a folder from the dialog selects it here.
  folderId: string;
  onFolderId: (folderId: string) => void;
  onEditProfile: (profile: ArgusProfile) => void;
  onNewProfile: () => void;
  onNewFolder: () => void;
  // Was onRenameFolder. The dialog edits the icon as well now.
  onEditFolder: (folder: ArgusFolder) => void;
  // Both delete paths funnel through the shared confirmation dialog, which the
  // app shell owns because the profile editor can raise it too.
  onRequestDelete: (profileIds: string[], label: string, onDeleted?: () => void) => void;
  onShowIntro: () => void;
};

export function ProfilesTab({
  folderId,
  onFolderId,
  onEditProfile,
  onNewProfile,
  onNewFolder,
  onEditFolder,
  onRequestDelete,
  onShowIntro,
}: ProfilesTabProps) {
  const {data, toast, profiles, selectedProfileId, setSelectedProfileId, statusOptions} = useWorkspace();
  const state = data.state;
  const {run, isPending} = useAsyncAction();
  const selection = useSelection<ArgusProfile>();

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);

  const inTrash = folderId === TRASH_FOLDER_ID;
  const filtered = Boolean(search.trim() || statusFilter);
  const visible = visibleProfiles(state.profiles, {folderId, statusFilter, search});
  const {items, page: clampedPage, totalPages, total} = paginate(visible, page, pageSize);

  // Nothing in the workspace at all -- not a filter that matched nothing, and
  // not an empty folder. There is no table worth drawing headers for, and every
  // control in the toolbar filters a list of zero, so the whole screen becomes
  // the invitation to make the first profile.
  const workspaceEmpty = state.profiles.length === 0;

  async function importCookiesForSelection() {
    if (!selection.size) {
      return;
    }
    if (!native?.selectCookieFolder || !native?.matchCookieFiles) {
      toast.setMessage('Native cookie import is not available. Restart Argus Launcher and try again.');
      return;
    }
    const folderPath = await native.selectCookieFolder();
    if (!folderPath) {
      return;
    }
    try {
      const {matched, total: count} = await profiles.matchCookies(folderPath, [...selection.ids]);
      toast.setMessage(`Matched cookies for ${matched} of ${count} selected profiles`);
    } catch (error) {
      toast.setMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async function moveSelectionToFolder(nextFolderId: string) {
    if (!selection.size) {
      return;
    }
    const target = nextFolderId || null;
    if (!await profiles.assignToFolder([...selection.ids], target)) {
      return;
    }
    const folderName = target ?
      state.folders.find((folder) => folder.id === target)?.name :
      'All profiles';
    toast.setMessage(`${selection.size} ${selection.size === 1 ? 'profile' : 'profiles'} moved to ${folderName || 'All profiles'}`);
  }

  async function restoreSelection() {
    const count = selection.size;
    if (!count || !await profiles.restore([...selection.ids])) {
      return;
    }
    selection.clear();
    toast.setMessage(`${count} ${count === 1 ? 'profile' : 'profiles'} restored`);
  }

  async function purgeSelection() {
    const count = selection.size;
    if (!count) {
      return;
    }
    if (!window.confirm(`Permanently delete ${count} selected ${count === 1 ? 'profile' : 'profiles'}? This cannot be undone.`)) {
      return;
    }
    if (!await profiles.purge([...selection.ids])) {
      return;
    }
    selection.clear();
    toast.setMessage(`${count} ${count === 1 ? 'profile' : 'profiles'} permanently deleted`);
  }

  async function restoreOne(profile: ArgusProfile) {
    if (await profiles.restore([profile.id])) {
      toast.setMessage(`${profile.name} restored`);
    }
  }

  async function purgeOne(profile: ArgusProfile) {
    if (!window.confirm(`Permanently delete ${profile.name}? This cannot be undone.`)) {
      return;
    }
    if (await profiles.purge([profile.id])) {
      toast.setMessage(`${profile.name} permanently deleted`);
    }
  }

  if (workspaceEmpty) {
    return (
      <section className="table-wrap table-wrap-empty">
        <EmptyState
          hero
          icon={<UsersRound size={30} strokeWidth={1.5} />}
          title="No profiles yet"
          body={'A profile is a separate browser with its own cookies, fingerprint and proxy. ' +
            'Make one and it appears here, ready to launch.'}
        >
          <button onClick={onNewProfile} type="button">
            <UserPlus size={16} /> Add profile
          </button>
          <button className="ghost" onClick={onShowIntro} type="button">
            <BookOpen size={16} /> How profiles work
          </button>
        </EmptyState>
      </section>
    );
  }

  return (
    <>
      <section className="table-toolbar">
        {/* A native <option> cannot carry a glyph, so the selected folder's icon
          * sits beside the picker instead of inside it. */}
        <span className="folder-select">
          <ActiveFolderIcon />
          <select value={folderId} onChange={(event) => onFolderId(event.target.value)}>
            <option value="">All profiles</option>
            {state.folders.map((folder) => (
              <option key={folder.id} value={folder.id}>{folder.name}</option>
            ))}
            <option value={TRASH_FOLDER_ID}>Trash</option>
          </select>
        </span>
        {folderId && !inTrash && (
          <button
            className="icon-button"
            aria-label={`Edit ${state.folders.find((folder) => folder.id === folderId)?.name || 'folder'}`}
            onClick={() => {
              const folder = state.folders.find((item) => item.id === folderId);
              if (folder) {
                onEditFolder(folder);
              }
            }}
          >
            <Pencil size={14} />
          </button>
        )}
        <button className="ghost" onClick={onNewFolder}><FolderPlus size={16} /> Add folder</button>
        <input
          type="text"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search profiles by name or tag"
        />
        <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
          <option value="">All statuses</option>
          {statusOptions.map((status) => <option key={status} value={status}>{status}</option>)}
        </select>
      </section>

      {selection.size > 0 && (
        <section className="selection-toolbar">
          <div className="selection-toolbar-actions">
            {inTrash ? (
              <>
                <button className="ghost" onClick={restoreSelection}>Restore selected</button>
                <button className="danger ghost" onClick={purgeSelection}>
                  <Trash2 size={16} /> Delete forever
                </button>
              </>
            ) : (
              <>
                <select value="" onChange={(event) => void moveSelectionToFolder(event.target.value)}>
                  <option value="" disabled>Assign to folder…</option>
                  <option value="">All profiles</option>
                  {state.folders.map((folder) => (
                    <option key={folder.id} value={folder.id}>{folder.name}</option>
                  ))}
                </select>
                <BusyButton
                  className="ghost"
                  busy={isPending('import-cookies')}
                  icon={<Cookie size={16} />}
                  busyLabel="Importing…"
                  onClick={() => void run('import-cookies', importCookiesForSelection)}
                >
                  Import cookies
                </BusyButton>
                <button
                  className="ghost"
                  onClick={() => void profiles.exportToCsv(selection.selectedFrom(state.profiles))}
                >
                  <Download size={16} /> Export selected
                </button>
                <button
                  className="danger ghost"
                  onClick={() => onRequestDelete(
                      [...selection.ids],
                      `${selection.size} selected ${selection.size === 1 ? 'profile' : 'profiles'}`,
                      selection.clear)}
                >
                  <Trash2 size={16} /> Delete selected
                </button>
              </>
            )}
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
                    checked={selection.allSelected(visible)}
                    onChange={() => selection.toggleAll(visible)}
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
            {items.map((profile) => {
              const proxy = profiles.proxyFor(profile);
              const folder = profiles.folderFor(profile);
              const rowClass = [
                profile.id === selectedProfileId ? 'selected' : '',
                selection.has(profile.id) ? 'row-checked' : '',
              ].filter(Boolean).join(' ');
              return (
                <tr key={profile.id} className={rowClass} onClick={() => setSelectedProfileId(profile.id)}>
                  <td className="checkbox-cell" onClick={(event) => event.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={selection.has(profile.id)}
                      onChange={() => selection.toggle(profile.id)}
                    />
                  </td>
                  <td className="name-cell">
                    <span className="avatar" style={profileColorStyle(profile.color)}>
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
                      onChange={(event) => void profiles.update(profile, {status: event.target.value})}
                    >
                      {statusOptions.map((status) => <option key={status}>{status}</option>)}
                    </select>
                  </td>
                  <td>{profile.created_at?.slice(0, 10) || '-'}</td>
                  <td>
                    {profile.deleted_at ?
                      `${daysUntilPurge(profile.deleted_at)}d left in Trash` :
                      <FolderLabel folder={folder} />}
                  </td>
                  <td>{proxy ? `${proxy.host}:${proxy.port}` : 'Direct'}</td>
                  <td>{profile.tags?.join(', ') || '-'}</td>
                  <td>
                    {profile.deleted_at ? (
                      <>
                        <button className="ghost" onClick={(event) => {
                          event.stopPropagation();
                          void restoreOne(profile);
                        }}>Restore</button>
                        <button
                          className="icon-button danger-icon"
                          aria-label={`Permanently delete ${profile.name}`}
                          onClick={(event) => {
                            event.stopPropagation();
                            void purgeOne(profile);
                          }}
                        >
                          <Trash2 size={16} />
                        </button>
                      </>
                    ) : (
                      <>
                        <BusyButton
                          className="launch"
                          busy={isPending(`launch-${profile.id}`)}
                          icon={<Play size={16} />}
                          onClick={() => void run(`launch-${profile.id}`, () => profiles.launch(profile))}
                        >
                          Launch
                        </BusyButton>
                        <button className="icon-button" aria-label={`Edit ${profile.name}`} onClick={(event) => {
                          event.stopPropagation();
                          onEditProfile(profile);
                        }}><Pencil size={16} /></button>
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
            {items.length === 0 && (
              <tr className="empty-row-tr">
                {/* Nine columns, not the eight this used to claim -- a short
                  * colSpan leaves a stray empty cell at the end of the row. */}
                <td colSpan={9}>
                  <EmptyState
                    icon={<SearchX size={22} />}
                    title={filtered ?
                      'Nothing matches those filters' :
                      inTrash ? 'Trash is empty' : 'This folder is empty'}
                    body={filtered ?
                      'Try a different search term, or clear the status filter.' :
                      inTrash ? 'Deleted profiles wait here for 30 days before they are purged.' :
                        'Profiles you add to this folder will show up here.'}
                  >
                    {!inTrash && !filtered && (
                      <button onClick={onNewProfile} type="button">
                        <UserPlus size={16} /> Add profile
                      </button>
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
    </>
  );

  // Both of these read `state` and `folderId` off the closure, which is why
  // they live in here rather than beside visibleProfiles below.
  function ActiveFolderIcon() {
    if (inTrash) {
      return <Trash2 className="folder-select-icon" size={15} />;
    }
    const folder = state.folders.find((item) => item.id === folderId);
    const Icon = folderIcon(folder?.icon);
    return <Icon className="folder-select-icon" size={15} strokeWidth={1.75} />;
  }

  function FolderLabel({folder}: {folder?: ArgusFolder | null}) {
    if (!folder) {
      return <>All profiles</>;
    }
    const Icon = folderIcon(folder.icon);
    return (
      <span className="folder-label">
        <Icon size={14} strokeWidth={1.75} /> {folder.name}
      </span>
    );
  }
}

// The one shape both empty states take. `hero` is the workspace-is-empty
// version -- same parts, more room and a heavier glyph, because it is the whole
// screen rather than a row inside a table that still has its headers.
function EmptyState({icon, title, body, hero, children}: {
  icon: ReactNode;
  title: string;
  body: string;
  hero?: boolean;
  children?: ReactNode;
}) {
  return (
    <div className={hero ? 'table-empty hero' : 'table-empty'}>
      <span className="table-empty-icon">{icon}</span>
      <h2>{title}</h2>
      <p>{body}</p>
      {children && <div className="table-empty-actions">{children}</div>}
    </div>
  );
}

// Trash is a folder in the picker but a flag on the row, so it filters first
// and the other two narrow whatever it left.
function visibleProfiles(
    allProfiles: ArgusProfile[],
    {folderId, statusFilter, search}: {folderId: string; statusFilter: string; search: string}) {
  const inTrash = folderId === TRASH_FOLDER_ID;
  const byTrash = allProfiles.filter((profile) => Boolean(profile.deleted_at) === inTrash);
  const inFolder = folderId && !inTrash ?
    byTrash.filter((profile) => profile.folder_id === folderId) :
    byTrash;
  const byStatus = statusFilter ?
    inFolder.filter((profile) =>
      (profile.status || 'Ready').toLowerCase() === statusFilter.toLowerCase()) :
    inFolder;
  const query = search.trim().toLowerCase();
  if (!query) {
    return byStatus;
  }
  return byStatus.filter((profile) =>
    profile.name?.toLowerCase().includes(query) ||
    profile.tags?.some((tag) => tag.toLowerCase().includes(query)));
}
