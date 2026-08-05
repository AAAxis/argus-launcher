import {useState} from 'react';
import {
  BookOpen, Cookie, Download, FolderInput, FolderPlus, Pencil, Play, SearchX, ShieldCheck,
  Trash2, UserPlus, UsersRound,
} from 'lucide-react';
import {MoveProfilesModal} from '../modals/MoveProfilesModal';
import {PurgeProfilesModal} from '../modals/ConfirmModals';
import {BusyButton} from '../ui/BusyButton';
import {Checkbox} from '../ui/Checkbox';
import {EmptyState} from '../ui/EmptyState';
import {FolderGlyph} from '../ui/FolderGlyph';
import {PaginationBar} from '../ui/PaginationBar';
import {PlatformIcon} from '../ui/icons';
import {ProxyCheckCell, storedCheckState} from '../ui/ProxyCheckCell';
import {ProfileAvatar} from '../ui/ProfileAvatar';
import {SortableTh} from '../ui/SortableTh';
import {StatusPicker} from '../ui/StatusChip';
import {TagCell} from '../ui/TagChip';
import {daysUntilPurge, TRASH_FOLDER_ID} from '../../lib/trash';
import {formatDateShort} from '../../lib/text';
import {paginate} from '../../lib/paginate';
import {tagKey, tagLabel} from '../../lib/tags';
import {native} from '../../native';
import {useAsyncAction} from '../../useAsyncAction';
import {useSelection} from '../../hooks/useSelection';
import {useTableSort} from '../../hooks/useTableSort';
import {useWorkspace} from '../../workspace/WorkspaceProvider';
import type {PurgeRequest} from '../modals/ConfirmModals';
import type {ArgusFolder, ArgusProfile, ArgusProxy} from '../../types';

export type ProfilesTabProps = {
  // Controlled by the shell: creating a folder from the dialog selects it here.
  folderId: string;
  onFolderId: (folderId: string) => void;
  onEditProfile: (profile: ArgusProfile) => void;
  onNewProfile: () => void;
  onNewFolder: () => void;
  // Was onRenameFolder. The dialog edits the icon and colour as well now.
  onEditFolder: (folder: ArgusFolder) => void;
  // Set for one render after a folder is created from a tag suggestion: the
  // move dialog opens on the folder with that tag's profiles already ticked,
  // so filling it is one click. Cleared through onFillTagDone when it closes.
  fillTag: string;
  onFillTagDone: () => void;
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
  fillTag,
  onFillTagDone,
  onRequestDelete,
  onShowIntro,
}: ProfilesTabProps) {
  const {
    data, toast, library, profiles, proxies, checkingProxyIds, selectedProfileId,
    setSelectedProfileId, statusOptions, tagOptions,
  } = useWorkspace();
  const state = data.state;
  const {run, isPending} = useAsyncAction();
  const selection = useSelection<ArgusProfile>();

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  // Held as a tagKey, not the tag as typed, so "Instagram" and "instagram" are
  // one entry in the dropdown and one filter rather than two.
  const [tagFilter, setTagFilter] = useState('');
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [moveOpen, setMoveOpen] = useState(false);
  // The pending permanent delete, shared by the row button, the bulk button and
  // Empty Trash -- one dialog, three ways in.
  const [purge, setPurge] = useState<PurgeRequest | null>(null);

  // What each column sorts BY, which is not always what its cell renders:
  // Platform is the fingerprint's OS behind a brand mark, Folder is a name
  // resolved from an id, Proxy is the host:port behind "Direct". A profile with
  // no platform, no folder or no proxy returns undefined and sinks to the
  // bottom in both directions -- see useTableSort.
  const sorting = useTableSort<ArgusProfile>([
    {key: 'name', value: (profile) => profile.name},
    {key: 'platform', value: (profile) => profile.fingerprint?.os},
    {key: 'status', value: (profile) => profile.status || 'Ready'},
    {key: 'created', value: (profile) => profile.created_at, firstDirection: 'desc'},
    {key: 'folder', value: (profile) => profiles.folderFor(profile)?.name},
    {key: 'proxy', value: (profile) => {
      const assigned = profiles.proxyFor(profile);
      return assigned ? `${assigned.host}:${assigned.port}` : undefined;
    }},
  ], {onSortChange: () => setPage(0)});

  const inTrash = folderId === TRASH_FOLDER_ID;
  const filtered = Boolean(search.trim() || statusFilter || tagFilter);
  const visible = sorting.sort(
      visibleProfiles(state.profiles, {folderId, statusFilter, tagFilter, search}));
  const {items, page: clampedPage, totalPages, total} = paginate(visible, page, pageSize);

  // The real folder the view is pointed at, if any: "" is All profiles and
  // TRASH_FOLDER_ID is a flag on the row, and neither is somewhere a profile
  // can be moved to.
  const activeFolder = inTrash ? null :
    state.folders.find((folder) => folder.id === folderId) || null;
  const movableCount = activeFolder ?
    state.profiles.filter((profile) => !profile.deleted_at && profile.folder_id !== folderId).length :
    0;
  const allCount = state.profiles.filter((profile) => !profile.deleted_at).length;
  const trashCount = state.profiles.length - allCount;

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

  // The three permanent-delete paths all raise the same dialog rather than a
  // window.confirm. It is the irreversible action, so it gets the "I understand"
  // checkbox the reversible one already had -- and a native confirm cannot say
  // that the on-disk browser directory and logged-in sessions go too.
  function purgeSelection() {
    if (!selection.size) {
      return;
    }
    setPurge({
      ids: [...selection.ids],
      count: selection.size,
      label: `${selection.size} selected ${selection.size === 1 ? 'profile' : 'profiles'}`,
    });
  }

  // No ids: the delete is scoped by deleted_at server-side, which is what makes
  // it safe without a selection. See db/profiles.purgeAll.
  function emptyTrash() {
    if (!trashCount) {
      return;
    }
    setPurge({ids: [], count: trashCount, label: 'everything in Trash'});
  }

  // The proxies behind the selected profiles, deduplicated -- several profiles
  // sharing one proxy should check it once, not once each.
  function checkSelectionProxies() {
    const targets = new Map<string, ArgusProxy>();
    for (const profile of selection.selectedFrom(state.profiles)) {
      const proxy = profiles.proxyFor(profile);
      if (proxy) {
        targets.set(proxy.id, proxy);
      }
    }
    if (!targets.size) {
      toast.setMessage('None of the selected profiles has a proxy assigned.');
      return;
    }
    void proxies.checkMany([...targets.values()]);
  }

  async function restoreOne(profile: ArgusProfile) {
    if (await profiles.restore([profile.id])) {
      toast.setMessage(`${profile.name} restored`);
    }
  }

  // Deleting a folder never deletes what is in it: profiles.folder_id is nulled
  // (ON DELETE SET NULL server-side, mirrored locally by removeFolder), so they
  // reappear under All profiles rather than vanishing with the folder. The
  // confirmation says so, because "delete folder" reads like it should take
  // them with it.
  async function deleteFolder(folder: ArgusFolder) {
    const count = state.profiles.filter((profile) =>
      !profile.deleted_at && profile.folder_id === folder.id).length;
    const consequence = count ?
      `Its ${count} ${count === 1 ? 'profile' : 'profiles'} will move to All profiles.` :
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

  function purgeOne(profile: ArgusProfile) {
    setPurge({ids: [profile.id], count: 1, label: profile.name});
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
        {/* Only tags that are actually on a profile: a dropdown listing all
          * twenty brands when the workspace uses two of them is a list of
          * eighteen ways to empty the table. */}
        <select value={tagFilter} onChange={(event) => setTagFilter(event.target.value)}>
          <option value="">All tags</option>
          {tagOptions.map((option) => (
            <option key={tagKey(option.tag)} value={tagKey(option.tag)}>
              {tagLabel(option.tag)} ({option.count})
            </option>
          ))}
        </select>
        {/* In the toolbar rather than the selection bar, because the whole point
          * is that it needs no selection: emptying Trash after a failed import
          * meant ticking every row across every page first. */}
        {inTrash && trashCount > 0 && (
          <button className="danger ghost" onClick={emptyTrash}>
            <Trash2 size={16} /> Empty Trash ({trashCount})
          </button>
        )}
      </section>

      {/* The folder navigation, in full: All profiles, the folders themselves,
        * Trash, and the way to make another one. This replaced a dropdown --
        * finding out what folders existed took opening it, and the only route
        * to editing or deleting one was to select it first. */}
      <section className="folder-row" aria-label="Folders">
        <button
          aria-pressed={!folderId}
          className={folderId ? 'folder-card' : 'folder-card active'}
          onClick={() => onFolderId('')}
          type="button"
        >
          <span className="folder-glyph"><UsersRound size={17} strokeWidth={1.75} /></span>
          <span className="folder-card-name">All profiles</span>
          <span className="folder-card-count">{allCount}</span>
        </button>

        {state.folders.map((folder) => {
          const count = state.profiles.filter((profile) =>
            !profile.deleted_at && profile.folder_id === folder.id).length;
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

        <button
          aria-pressed={inTrash}
          className={inTrash ? 'folder-card active' : 'folder-card'}
          onClick={() => onFolderId(TRASH_FOLDER_ID)}
          type="button"
        >
          <span className="folder-glyph"><Trash2 size={17} strokeWidth={1.75} /></span>
          <span className="folder-card-name">Trash</span>
          <span className="folder-card-count">{trashCount}</span>
        </button>

        <button className="folder-card folder-card-new" onClick={onNewFolder} type="button">
          <span className="folder-glyph"><FolderPlus size={17} strokeWidth={1.75} /></span>
          <span className="folder-card-name">New folder</span>
        </button>
      </section>

      {/* Below the folder rail, not above it. Ticking a row used to insert this
        * between the filters and the folders, which pushed the folder cards --
        * and the whole table under them -- down by its height. */}
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
                <button className="ghost" onClick={checkSelectionProxies}>
                  <ShieldCheck size={16} /> Check proxies
                </button>
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
                  <Checkbox
                    label={`Select all ${visible.length} profiles on this page`}
                    checked={selection.allSelected(visible)}
                    indeterminate={visible.some((item) => selection.has(item.id))}
                    onChange={() => selection.toggleAll(visible)}
                  />
                )}
              </th>
              <SortableTh label="Name" {...sorting.thProps('name')} />
              <SortableTh label="Platform" {...sorting.thProps('platform')} />
              <SortableTh label="Status" {...sorting.thProps('status')} />
              {/* Only once there is somebody to tell apart. On a one-person
                * workspace every row would answer "you", which is a column of
                * noise -- the same judgement that hides the org switcher until
                * you belong to more than one org. */}
              {/* "Date added", not "Created": the same created_at, named for
                * what the reader is actually scanning this column for -- the day
                * the profile joined this workspace. The sort key stays `created`
                * because it names the field, not the header. */}
              <SortableTh label="Date added" {...sorting.thProps('created')} />
              <SortableTh label="Folder" {...sorting.thProps('folder')} />
              <SortableTh label="Proxy" {...sorting.thProps('proxy')} />
              {/* Tags is a set, not a value -- there is no order to sort a row
                * of chips by that means anything to the person reading it. */}
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
                    <Checkbox
                      label={`Select ${profile.name || profile.id}`}
                      checked={selection.has(profile.id)}
                      onChange={() => selection.toggle(profile.id)}
                    />
                  </td>
                  <td className="name-cell">
                    <ProfileAvatar profile={profile} />
                    {profile.name}
                  </td>
                  <td className="platform-cell">
                    <PlatformIcon os={profile.fingerprint?.os} />
                  </td>
                  {/* stopPropagation because the row itself is a selection
                    * target -- picking a status should not also select the
                    * profile underneath the picker. */}
                  <td onClick={(event) => event.stopPropagation()}>
                    <StatusPicker
                      status={profile.status || 'Ready'}
                      options={statusOptions}
                      onChange={(status) => void profiles.update(profile, {status})}
                    />
                  </td>
                  <td>{formatDateShort(profile.created_at)}</td>
                  <td>
                    {profile.deleted_at ?
                      `${daysUntilPurge(profile.deleted_at)}d left in Trash` :
                      <FolderLabel folder={folder} />}
                  </td>
                  {/* The connection and its health together. The cell used to be
                    * host:port alone, so the one thing you actually want from
                    * this column -- does this profile's proxy work -- meant
                    * opening the Proxies tab and finding the row by hand. */}
                  <td className="profile-proxy-cell">
                    {proxy ? (
                      <>
                        <span className="profile-proxy-host">{proxy.host}:{proxy.port}</span>
                        <ProxyCheckCell
                          state={checkingProxyIds.has(proxy.id) ?
                            {status: 'checking'} :
                            storedCheckState(proxy)}
                          age={proxy.check_error ? undefined : proxy.checked_at}
                        />
                      </>
                    ) : 'Direct'}
                  </td>
                  <td><TagCell tags={profile.tags} /></td>
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
                            purgeOne(profile);
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
                        {/* Only for a profile that has a proxy: a direct one has
                          * nothing to check, and a disabled button there would
                          * suggest the check was unavailable rather than
                          * inapplicable. */}
                        {proxy && (
                          <button
                            aria-label={`Check proxy for ${profile.name}`}
                            className="ghost icon-button row-action"
                            disabled={checkingProxyIds.has(proxy.id)}
                            onClick={(event) => {
                              event.stopPropagation();
                              void proxies.checkOnce(proxy);
                            }}
                            title={`Check ${proxy.host}:${proxy.port} now`}
                          >
                            <ShieldCheck size={16} />
                          </button>
                        )}
                        {/* Bordered rather than bare: beside a filled Launch
                          * button, a naked glyph read as decoration on the
                          * row instead of as something to press. */}
                        <button
                          aria-label={`Edit ${profile.name}`}
                          className="ghost icon-button row-action"
                          onClick={(event) => {
                            event.stopPropagation();
                            onEditProfile(profile);
                          }}
                          title={`Edit ${profile.name}`}
                        >
                          <Pencil size={16} />
                        </button>
                        <button
                          aria-label={`Delete ${profile.name}`}
                          className="ghost icon-button row-action row-action-danger"
                          onClick={(event) => {
                            event.stopPropagation();
                            onRequestDelete([profile.id], profile.name);
                          }}
                          title={`Delete ${profile.name}`}
                        >
                          <Trash2 size={16} />
                        </button>
                      </>
                    )}
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
                    title={filtered ?
                      'Nothing matches those filters' :
                      inTrash ? 'Trash is empty' : 'This folder is empty'}
                    body={filtered ?
                      'Try a different search term, or clear the status and tag filters.' :
                      inTrash ? 'Deleted profiles wait here for 30 days before they are purged.' :
                        'Profiles you add to this folder will show up here.'}
                  >
                    {!inTrash && !filtered && (
                      <>
                        <button onClick={onNewProfile} type="button">
                          <UserPlus size={16} /> Add profile
                        </button>
                        {/* A brand-new folder is far more often filled from
                          * profiles that already exist than from scratch, and
                          * the only route to that was selecting rows in a
                          * table you have to leave this folder to see. */}
                        {activeFolder && movableCount > 0 && (
                          <button className="ghost" onClick={() => setMoveOpen(true)} type="button">
                            <FolderInput size={16} /> Move profiles here
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

      {(moveOpen || fillTag) && activeFolder && (
        <MoveProfilesModal
          folder={activeFolder}
          seedTag={fillTag || undefined}
          onClose={() => {
            setMoveOpen(false);
            onFillTagDone();
          }}
        />
      )}

      {purge && (
        <PurgeProfilesModal
          request={purge}
          onClose={() => setPurge(null)}
          onPurged={() => {
            setPurge(null);
            selection.clear();
          }}
        />
      )}
    </>
  );

  // Reads `state` off the closure, which is why it lives in here rather than
  // beside visibleProfiles below.
  function FolderLabel({folder}: {folder?: ArgusFolder | null}) {
    if (!folder) {
      return <>All profiles</>;
    }
    return (
      <span className="folder-label">
        <FolderGlyph color={folder.color} icon={folder.icon} size={13} small /> {folder.name}
      </span>
    );
  }
}

// Trash is a folder in the picker but a flag on the row, so it filters first
// and the rest narrow whatever it left.
function visibleProfiles(
    allProfiles: ArgusProfile[],
    {folderId, statusFilter, tagFilter, search}: {
      folderId: string;
      statusFilter: string;
      tagFilter: string;
      search: string;
    }) {
  const inTrash = folderId === TRASH_FOLDER_ID;
  const byTrash = allProfiles.filter((profile) => Boolean(profile.deleted_at) === inTrash);
  const inFolder = folderId && !inTrash ?
    byTrash.filter((profile) => profile.folder_id === folderId) :
    byTrash;
  const byStatus = statusFilter ?
    inFolder.filter((profile) =>
      (profile.status || 'Ready').toLowerCase() === statusFilter.toLowerCase()) :
    inFolder;
  // Compared on tagKey, so a row tagged "Instagram" and a row tagged
  // "instagram" both answer to the one dropdown entry.
  const byTag = tagFilter ?
    byStatus.filter((profile) => profile.tags?.some((tag) => tagKey(tag) === tagFilter)) :
    byStatus;
  const query = search.trim().toLowerCase();
  if (!query) {
    return byTag;
  }
  return byTag.filter((profile) =>
    profile.name?.toLowerCase().includes(query) ||
    profile.tags?.some((tag) => tag.toLowerCase().includes(query)));
}
