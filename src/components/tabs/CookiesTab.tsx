// The cookie-set library, laid out as the Profiles tab is: a filter toolbar, a
// selection toolbar that appears when rows are ticked, the folder rail, the
// table, and the pager. Deliberately the same order and the same class names --
// two tabs that do the same kind of work should not need to be learned twice.
import {useState} from 'react';
import {
  BookOpen, Copy, Cookie, FolderInput, FolderPlus, Pencil, SearchX, Trash2, UserPlus,
} from 'lucide-react';
import {MoveCookieSetsModal} from '../modals/MoveCookieSetsModal';
import {AssignedCell} from '../ui/AssignedCell';
import {BusyButton} from '../ui/BusyButton';
import {EmptyState} from '../ui/EmptyState';
import {FolderGlyph} from '../ui/FolderGlyph';
import {PaginationBar} from '../ui/PaginationBar';
import {TagCell} from '../ui/TagChip';
import {daysUntilPurge, TRASH_FOLDER_ID} from '../../lib/trash';
import {formatDateShort} from '../../lib/text';
import {paginate} from '../../lib/paginate';
import {profileColorStyle} from '../../lib/profileColors';
import {tagKey, tagLabel} from '../../lib/tags';
import {useAsyncAction} from '../../useAsyncAction';
import {useSelection} from '../../hooks/useSelection';
import {useWorkspace} from '../../workspace/WorkspaceProvider';
import type {ArgusCookie, ArgusFolder} from '../../types';

// Whether a set is attached to anything. Its own filter rather than a column
// sort because "which of these is nobody using" is the question that decides
// what can safely be thrown away.
type UsageFilter = '' | 'used' | 'unused';

export type CookiesTabProps = {
  // Controlled by the shell, like the profiles one: creating a folder from the
  // dialog selects it here.
  folderId: string;
  onFolderId: (folderId: string) => void;
  onOpenCookieSet: (cookie: ArgusCookie) => void;
  onAssignCookieSet: (cookie: ArgusCookie) => void;
  onNewCookieSet: () => void;
  onNewFolder: () => void;
  onEditFolder: (folder: ArgusFolder) => void;
  onShowAbout: () => void;
};

export function CookiesTab({
  folderId,
  onFolderId,
  onOpenCookieSet,
  onAssignCookieSet,
  onNewCookieSet,
  onNewFolder,
  onEditFolder,
  onShowAbout,
}: CookiesTabProps) {
  const {data, toast, library, cookies, cookieTagOptions} = useWorkspace();
  const state = data.state;
  const {run, isPending} = useAsyncAction();
  const selection = useSelection<ArgusCookie>();

  const [search, setSearch] = useState('');
  // Held as a tagKey, so "Instagram" and "instagram" are one dropdown entry.
  const [tagFilter, setTagFilter] = useState('');
  const [usageFilter, setUsageFilter] = useState<UsageFilter>('');
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [moveOpen, setMoveOpen] = useState(false);

  const inTrash = folderId === TRASH_FOLDER_ID;
  const filtered = Boolean(search.trim() || tagFilter || usageFilter);
  const usage = cookies.usageCounts();
  const visible = visibleCookieSets(
      state.cookies, {folderId, tagFilter, usageFilter, search}, usage);
  const {items, page: clampedPage, totalPages, total} = paginate(visible, page, pageSize);

  const activeFolder = inTrash ? null :
    state.cookie_folders.find((folder) => folder.id === folderId) || null;
  const movableCount = activeFolder ?
    state.cookies.filter((cookie) => !cookie.deleted_at && cookie.folder_id !== folderId).length :
    0;
  const allCount = state.cookies.filter((cookie) => !cookie.deleted_at).length;
  const trashCount = state.cookies.length - allCount;
  const workspaceEmpty = state.cookies.length === 0;

  async function moveSelectionToFolder(nextFolderId: string) {
    if (!selection.size) {
      return;
    }
    const target = nextFolderId || null;
    if (await cookies.assignToFolder([...selection.ids], target)) {
      const folder = state.cookie_folders.find((item) => item.id === target);
      toast.setMessage(`Moved ${selection.size} to ${folder ? folder.name : 'All cookie-sets'}`);
      selection.clear();
    }
  }

  // Named consequences rather than a bare "are you sure": the profiles about to
  // lose their session are the only thing worth reading before agreeing. A
  // plain confirm is what the folder delete and the permanent delete on the
  // Profiles tab already use -- the dedicated dialog over there exists for the
  // cascading-proxy offer, which has no counterpart here.
  async function trashSets(ids: string[], label: string) {
    const affected = ids.reduce((sum, id) => sum + (usage.get(id) || 0), 0);
    const consequence = affected === 0 ?
      '' :
      ` ${affected} ${affected === 1 ? 'profile' : 'profiles'} ` +
        `${affected === 1 ? 'uses' : 'use'} it and will lose their cookies until you assign ` +
        'another set.';
    if (!window.confirm(`Move ${label} to Trash?${consequence}`)) {
      return;
    }
    if (await cookies.softDelete(ids)) {
      toast.setMessage(affected === 0 ?
        `Moved ${label} to Trash` :
        `Moved ${label} to Trash · ${affected} ${affected === 1 ? 'profile' : 'profiles'} unassigned`);
      selection.clear();
    }
  }

  async function restoreSets(ids: string[], label: string) {
    if (await cookies.restore(ids)) {
      // Said out loud because it is the one thing Restore does not put back:
      // the row returns with its folder and tags, but not its profiles.
      toast.setMessage(`Restored ${label}. Assign it to a profile to use it again.`);
      selection.clear();
    }
  }

  async function purgeSets(ids: string[], label: string) {
    if (!window.confirm(`Permanently delete ${label}? This cannot be undone.`)) {
      return;
    }
    if (await cookies.purge(ids)) {
      toast.setMessage(`Deleted ${label}`);
      selection.clear();
    }
  }

  async function duplicateOne(cookie: ArgusCookie) {
    const copy = await cookies.duplicate(cookie);
    if (copy) {
      toast.setMessage(`Duplicated as "${copy.name}"`);
    }
  }

  async function deleteFolder(folder: ArgusFolder) {
    if (!window.confirm(
        `Delete folder ${folder.name}? Cookie-sets will move to All cookie-sets.`)) {
      return;
    }
    if (await library.removeFolder(folder.id)) {
      if (folderId === folder.id) {
        onFolderId('');
      }
      toast.setMessage(`${folder.name} folder deleted`);
    }
  }

  // Nothing in the library at all -- not a filter that matched nothing and not
  // an empty folder. Every control in the toolbar would be filtering a list of
  // zero, so the whole screen becomes the invitation to add the first set.
  if (workspaceEmpty) {
    return (
      <section className="table-wrap table-wrap-empty">
        <EmptyState
          hero
          icon={<Cookie size={30} strokeWidth={1.5} />}
          title="No cookie-sets yet"
          body={'A cookie-set is a saved export of a logged-in browser session. Add one and ' +
            'any profile can launch already signed in.'}
        >
          <button onClick={onNewCookieSet} type="button">
            <Cookie size={16} /> Add cookie-set
          </button>
          {/* The same pairing the empty Profiles tab uses: the action, and the
            * way to find out what the action is for. Someone who has never
            * exported cookies needs the second one first. */}
          <button className="ghost" onClick={onShowAbout} type="button">
            <BookOpen size={16} /> What are cookie-sets?
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
          placeholder="Search cookie-sets by name or tag"
        />
        {/* Only tags actually on a set: a dropdown listing every brand when the
          * library uses two of them is a list of ways to empty the table. */}
        <select value={tagFilter} onChange={(event) => setTagFilter(event.target.value)}>
          <option value="">All tags</option>
          {cookieTagOptions.map((option) => (
            <option key={tagKey(option.tag)} value={tagKey(option.tag)}>
              {tagLabel(option.tag)} ({option.count})
            </option>
          ))}
        </select>
        <select
          value={usageFilter}
          onChange={(event) => setUsageFilter(event.target.value as UsageFilter)}
        >
          <option value="">All cookie-sets</option>
          <option value="used">In use</option>
          <option value="unused">Unused</option>
        </select>
      </section>

      {selection.size > 0 && (
        <section className="selection-toolbar">
          <div className="selection-toolbar-actions">
            {inTrash ? (
              <>
                <button
                  className="ghost"
                  onClick={() => void restoreSets([...selection.ids], selectionLabel(selection.size))}
                >
                  Restore selected
                </button>
                <button
                  className="danger ghost"
                  onClick={() => void purgeSets([...selection.ids], selectionLabel(selection.size))}
                >
                  <Trash2 size={16} /> Delete forever
                </button>
              </>
            ) : (
              <>
                <select value="" onChange={(event) => void moveSelectionToFolder(event.target.value)}>
                  <option value="" disabled>Assign to folder…</option>
                  <option value="">All cookie-sets</option>
                  {state.cookie_folders.map((folder) => (
                    <option key={folder.id} value={folder.id}>{folder.name}</option>
                  ))}
                </select>
                {/* One set at a time, because a profile carries exactly one:
                  * assigning three sets to one profile has no meaning, and
                  * silently letting the last one win would be worse. */}
                <button
                  className="ghost"
                  disabled={selection.size !== 1}
                  onClick={() => {
                    const picked = selection.selectedFrom(state.cookies)[0];
                    if (picked) {
                      onAssignCookieSet(picked);
                    }
                  }}
                  title={selection.size === 1 ?
                    'Choose which profiles use this cookie-set' :
                    'Select exactly one cookie-set: a profile carries one at a time'}
                >
                  <UserPlus size={16} /> Assign to profiles
                </button>
                <select
                  value=""
                  onChange={(event) => {
                    const format = event.target.value as 'json' | 'netscape';
                    void run('export', () =>
                      cookies.exportSets(selection.selectedFrom(state.cookies), format));
                  }}
                >
                  <option value="" disabled>Export selected…</option>
                  <option value="json">As JSON</option>
                  <option value="netscape">As cookies.txt</option>
                </select>
                <button
                  className="danger ghost"
                  onClick={() => void trashSets([...selection.ids], selectionLabel(selection.size))}
                >
                  <Trash2 size={16} /> Delete selected
                </button>
              </>
            )}
          </div>
        </section>
      )}

      <section className="folder-row" aria-label="Folders">
        <button
          aria-pressed={!folderId}
          className={folderId ? 'folder-card' : 'folder-card active'}
          onClick={() => onFolderId('')}
          type="button"
        >
          <span className="folder-glyph"><Cookie size={17} strokeWidth={1.75} /></span>
          <span className="folder-card-name">All cookie-sets</span>
          <span className="folder-card-count">{allCount}</span>
        </button>

        {state.cookie_folders.map((folder) => {
          const count = state.cookies.filter((cookie) =>
            !cookie.deleted_at && cookie.folder_id === folder.id).length;
          const active = folder.id === folderId;
          return (
            // A div, not a button: the pencil and the trash are buttons of their
            // own, and nesting those inside the card's button is both invalid
            // and unclickable.
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
              <th>Cookies</th>
              <th>Used by</th>
              <th>Folder</th>
              <th>Tags</th>
              <th>Updated</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {items.map((cookie) => {
              const folder = cookies.folderFor(cookie);
              const usedBy = usage.get(cookie.id) || 0;
              return (
                // The row's own click opens the set -- a cookie-set has no
                // "selected row" concept the way a profile does, so the obvious
                // gesture is free to be the primary action. Not in Trash,
                // though: the inspector can assign, edit and re-delete, and
                // none of those mean anything for a set that has been thrown
                // away. Trash rows offer Restore and Delete forever, and
                // nothing else.
                <tr
                  key={cookie.id}
                  className={selection.has(cookie.id) ? 'row-checked' : ''}
                  onClick={cookie.deleted_at ? undefined : () => onOpenCookieSet(cookie)}
                >
                  <td className="checkbox-cell" onClick={(event) => event.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={selection.has(cookie.id)}
                      onChange={() => selection.toggle(cookie.id)}
                    />
                  </td>
                  <td className="name-cell">
                    <span className="avatar" style={profileColorStyle(folder?.color)}>
                      <Cookie size={15} strokeWidth={1.75} />
                    </span>
                    {cookie.name}
                  </td>
                  <td>{cookie.count ?? '-'}</td>
                  <td>
                    <AssignedCell
                      emptyLabel="Unused"
                      holders={usedBy === 0 ? [] : cookies.profilesUsing(cookie.id)}
                    />
                  </td>
                  <td>
                    {cookie.deleted_at ?
                      `${daysUntilPurge(cookie.deleted_at)}d left in Trash` :
                      <FolderLabel folder={folder} />}
                  </td>
                  <td><TagCell tags={cookie.tags} /></td>
                  <td>{formatDateShort(cookie.updated_at)}</td>
                  <td>
                    {cookie.deleted_at ? (
                      <>
                        <button className="ghost" onClick={(event) => {
                          event.stopPropagation();
                          void restoreSets([cookie.id], `"${cookie.name}"`);
                        }}>Restore</button>
                        <button
                          aria-label={`Permanently delete ${cookie.name}`}
                          className="icon-button danger-icon"
                          onClick={(event) => {
                            event.stopPropagation();
                            void purgeSets([cookie.id], `"${cookie.name}"`);
                          }}
                          title={`Permanently delete ${cookie.name}`}
                        >
                          <Trash2 size={16} />
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          className="launch"
                          onClick={(event) => {
                            event.stopPropagation();
                            onOpenCookieSet(cookie);
                          }}
                          type="button"
                        >
                          Open
                        </button>
                        <button
                          aria-label={`Assign ${cookie.name} to profiles`}
                          className="ghost icon-button row-action"
                          onClick={(event) => {
                            event.stopPropagation();
                            onAssignCookieSet(cookie);
                          }}
                          title={`Assign ${cookie.name} to profiles`}
                        >
                          <UserPlus size={16} />
                        </button>
                        <BusyButton
                          ariaLabel={`Duplicate ${cookie.name}`}
                          busy={isPending(`duplicate-${cookie.id}`)}
                          className="ghost icon-button row-action"
                          icon={<Copy size={16} />}
                          onClick={(event) => {
                            event.stopPropagation();
                            void run(`duplicate-${cookie.id}`, () => duplicateOne(cookie));
                          }}
                          title={`Duplicate ${cookie.name}`}
                        />
                        <button
                          aria-label={`Delete ${cookie.name}`}
                          className="ghost icon-button row-action row-action-danger"
                          onClick={(event) => {
                            event.stopPropagation();
                            void trashSets([cookie.id], `"${cookie.name}"`);
                          }}
                          title={`Delete ${cookie.name}`}
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
                {/* Eight columns. A short colSpan leaves a stray empty cell at
                  * the end of the row. */}
                <td colSpan={8}>
                  <EmptyState
                    icon={<SearchX size={22} />}
                    title={filtered ?
                      'Nothing matches those filters' :
                      inTrash ? 'Trash is empty' : 'This folder is empty'}
                    body={filtered ?
                      'Try a different search term, or clear the tag and usage filters.' :
                      inTrash ?
                        'Deleted cookie-sets wait here for 30 days before they are purged.' :
                        'Cookie-sets you add to this folder will show up here.'}
                  >
                    {!inTrash && !filtered && (
                      <>
                        <button onClick={onNewCookieSet} type="button">
                          <Cookie size={16} /> Add cookie-set
                        </button>
                        {activeFolder && movableCount > 0 && (
                          <button className="ghost" onClick={() => setMoveOpen(true)} type="button">
                            <FolderInput size={16} /> Move cookie-sets here
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

      {moveOpen && activeFolder && (
        <MoveCookieSetsModal folder={activeFolder} onClose={() => setMoveOpen(false)} />
      )}
    </>
  );

  function FolderLabel({folder}: {folder?: ArgusFolder | null}) {
    if (!folder) {
      return <>All cookie-sets</>;
    }
    return (
      <span className="folder-label">
        <FolderGlyph color={folder.color} icon={folder.icon} size={13} small /> {folder.name}
      </span>
    );
  }
}

function selectionLabel(size: number): string {
  return `${size} selected cookie-${size === 1 ? 'set' : 'sets'}`;
}

// Trash is a folder in the picker but a flag on the row, so it filters first
// and the rest narrow whatever it left. Same shape as visibleProfiles, and
// deliberately so.
function visibleCookieSets(
    allCookies: ArgusCookie[],
    {folderId, tagFilter, usageFilter, search}: {
      folderId: string;
      tagFilter: string;
      usageFilter: UsageFilter;
      search: string;
    },
    usage: Map<string, number>) {
  const inTrash = folderId === TRASH_FOLDER_ID;
  const byTrash = allCookies.filter((cookie) => Boolean(cookie.deleted_at) === inTrash);
  const inFolder = folderId && !inTrash ?
    byTrash.filter((cookie) => cookie.folder_id === folderId) :
    byTrash;
  const byUsage = usageFilter ?
    inFolder.filter((cookie) =>
      (usageFilter === 'used') === Boolean(usage.get(cookie.id))) :
    inFolder;
  // Compared on tagKey, so a set tagged "Instagram" and one tagged "instagram"
  // both answer to the one dropdown entry.
  const byTag = tagFilter ?
    byUsage.filter((cookie) => cookie.tags?.some((tag) => tagKey(tag) === tagFilter)) :
    byUsage;
  const query = search.trim().toLowerCase();
  if (!query) {
    return byTag;
  }
  return byTag.filter((cookie) =>
    cookie.name?.toLowerCase().includes(query) ||
    cookie.tags?.some((tag) => tag.toLowerCase().includes(query)));
}
