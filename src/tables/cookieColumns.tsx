// Every column the Cookies table can show.
//
// The same seven it has always shown. Nothing new: the ask was about Profiles,
// and the value here is that a workspace which never tags its sets or never
// shares them can drop the columns that say so on every row.
//
// Ids are the old useTableSort keys, unchanged.
import {Cookie} from 'lucide-react';
import {AssignedCell} from '../components/ui/AssignedCell';
import {Assignee} from '../components/ui/Assignee';
import {FolderLabel} from '../components/ui/FolderLabel';
import {TagCell} from '../components/ui/TagChip';
import {assigneeName} from '../lib/assignees';
import {profileColorStyle} from '../lib/profileColors';
import {daysUntilPurge} from '../lib/trash';
import {formatDateShort} from '../lib/text';
import type {TableColumn} from './columns';
import type {ArgusCookie, ArgusFolder, ArgusProfile, CloudState} from '../types';

export type CookieColumnContext = {
  state: CloudState;
  folderFor: (cookie: ArgusCookie) => ArgusFolder | null | undefined;
  // How many profiles each set seeds, counted once for the whole table rather
  // than per row -- the same map the sort and the filter read.
  usage: Map<string, number>;
  profilesUsing: (cookieId: string) => ArgusProfile[];
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
    sort: (cookie, context) => context.folderFor(cookie)?.name,
    cell: (cookie, context) => cookie.deleted_at ?
      `${daysUntilPurge(cookie.deleted_at)}d left in Trash` :
      <FolderLabel fallback="All cookie-sets" folder={context.folderFor(cookie)} />,
  },
  {
    id: 'tags',
    label: 'Tags',
    cell: (cookie) => <TagCell tags={cookie.tags} />,
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
