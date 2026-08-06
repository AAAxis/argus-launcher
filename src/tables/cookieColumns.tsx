// Every column the Cookies table can show.
//
// The same seven it has always shown, with Tags and Folder now edited where
// they are read, through the same CellControls the Profiles and Proxies tables
// use.
//
// Ids are the old useTableSort keys, unchanged.
import {Cookie} from 'lucide-react';
import {AssignedCell} from '../components/ui/AssignedCell';
import {Assignee} from '../components/ui/Assignee';
import {CellPicker, CellTags} from '../components/ui/CellControls';
import {FolderLabel} from '../components/ui/FolderLabel';
import {assigneeName} from '../lib/assignees';
import {profileColorStyle} from '../lib/profileColors';
import {daysUntilPurge} from '../lib/trash';
import {formatDateShort} from '../lib/text';
import type {CellOption} from '../components/ui/CellControls';
import type {TableColumn} from './columns';
import type {TagUsage} from '../lib/tags';
import type {ArgusCookie, ArgusFolder, ArgusProfile, CloudState} from '../types';

export type CookieColumnContext = {
  state: CloudState;
  folderFor: (cookie: ArgusCookie) => ArgusFolder | null | undefined;
  // How many profiles each set seeds, counted once for the whole table rather
  // than per row -- the same map the sort and the filter read.
  usage: Map<string, number>;
  profilesUsing: (cookieId: string) => ArgusProfile[];
  // Every tag in use across the workspace's cookie sets, for the Tags cell's
  // suggestion row -- deliberately the cookie list, not the profiles' one:
  // the two vocabularies are kept separate on purpose.
  tagOptions: TagUsage[];
  options: CookieCellOptions;
  actions: CookieCellActions;
};

export type CookieCellOptions = {
  folders: CellOption[];
};

// Both writes land in cookies.save, a partial patch -- the rules live in
// tables/cookieCellActions.tsx.
export type CookieCellActions = {
  setTags: (cookie: ArgusCookie, tags: string[]) => void;
  setFolder: (cookie: ArgusCookie, folderId: string) => void;
};

export type CookieColumn = TableColumn<ArgusCookie, CookieColumnContext>;

export const COOKIE_COLUMNS: CookieColumn[] = [
  {
    id: 'name',
    label: 'Name',
    locked: true,
    cellClassName: 'name-cell',
    sort: (cookie) => cookie.name,
    cell: (cookie, context) => (
      <>
        <span className="avatar" style={profileColorStyle(context.folderFor(cookie)?.color)}>
          <Cookie size={15} strokeWidth={1.75} />
        </span>
        {cookie.name}
      </>
    ),
  },
  {
    // A count, so it opens descending: "which set has the most in it" is the
    // question the column gets asked.
    id: 'count',
    label: 'Cookies',
    firstDirection: 'desc',
    description: 'How many cookies are in the set.',
    sort: (cookie) => cookie.count,
    cell: (cookie) => cookie.count ?? '-',
  },
  {
    // Also a count, and a set nobody uses has none at all rather than a zero,
    // which keeps the unused ones out of the way in both directions.
    id: 'used',
    label: 'Used by',
    firstDirection: 'desc',
    description: 'How many profiles this set seeds at launch.',
    sort: (cookie, context) => context.usage.get(cookie.id) || undefined,
    cell: (cookie, context) => (
      <AssignedCell
        emptyLabel="Unused"
        holders={context.usage.get(cookie.id) ? context.profilesUsing(cookie.id) : []}
      />
    ),
  },
  {
    id: 'folder',
    label: 'Folder',
    stopRowClick: true,
    sort: (cookie, context) => context.folderFor(cookie)?.name,
    // A trashed row says how long it has left instead, and stays plain text --
    // the same decision the Profiles folder cell makes: the Trash pseudo-folder
    // is not a folder, and a picker on a row whose remedy is Restore would
    // fight it.
    cell: (cookie, context) => cookie.deleted_at ?
      `${daysUntilPurge(cookie.deleted_at)}d left in Trash` :
      <CellPicker
        label={`File ${cookie.name} under a folder`}
        noneLabel="All cookie-sets"
        onPick={(folderId) => context.actions.setFolder(cookie, folderId)}
        options={context.options.folders}
        trigger={<FolderLabel fallback="All cookie-sets" folder={context.folderFor(cookie)} />}
        value={cookie.folder_id || ''}
      />,
  },
  {
    // Tags is a set, not a value, so it is a CellTags rather than a picker --
    // and it has no sort for the reason the Profiles tags column has none.
    id: 'tags',
    label: 'Tags',
    stopRowClick: true,
    cell: (cookie, context) => (
      <CellTags
        label={`Edit tags for ${cookie.name}`}
        onChange={(tags) => context.actions.setTags(cookie, tags)}
        options={context.tagOptions}
        tags={cookie.tags || []}
      />
    ),
  },
  {
    id: 'assignee',
    label: 'Assigned',
    teamOnly: true,
    description: 'The teammate on the hook for this set.',
    sort: (cookie, context) => assigneeName(cookie.assigned_to, context.state.members),
    cell: (cookie) => <Assignee userId={cookie.assigned_to} />,
  },
  {
    id: 'updated',
    label: 'Updated',
    firstDirection: 'desc',
    sort: (cookie) => cookie.updated_at,
    cell: (cookie) => formatDateShort(cookie.updated_at),
  },
];
