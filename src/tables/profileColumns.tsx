// Every column the Profiles table can show.
//
// The nine that were hard-coded in the tab, plus the proxy check split out of
// the proxy cell, plus nine more that are off until somebody asks for them. The
// added ones are all things the profile already carries and the table had no
// room to volunteer: the account it is logged into, the fingerprint it presents,
// and what happens when you press Launch.
//
// Ids are load-bearing -- they are what a saved layout stores and what an agent
// sends to POST /v1/tables/columns. The nine original ones are deliberately
// spelled the way the old useTableSort keys were spelled (`created`, not
// `dateAdded`), so nothing about sorting changed meaning when it moved here.
import {Assignee} from '../components/ui/Assignee';
import {CopyButton} from '../components/ui/CopyButton';
import {FolderLabel} from '../components/ui/FolderLabel';
import {PlatformIcon} from '../components/ui/icons';
import {ProfileAvatar} from '../components/ui/ProfileAvatar';
import {ProxyCheckCell, storedCheckState} from '../components/ui/ProxyCheckCell';
import {StatusPicker} from '../components/ui/StatusChip';
import {TagCell} from '../components/ui/TagChip';
import {assigneeName} from '../lib/assignees';
import {daysUntilPurge} from '../lib/trash';
import {formatDateShort} from '../lib/text';
import type {TableColumn} from './columns';
import type {ArgusFolder, ArgusProfile, ArgusProxy, CloudState} from '../types';

// What the cells need that a profile does not carry: the two lookups the tab
// already had (a proxy is matched by host, a folder by id), the live check
// sweep, and the one mutation a cell performs.
export type ProfileColumnContext = {
  state: CloudState;
  proxyFor: (profile: ArgusProfile) => ArgusProxy | null | undefined;
  folderFor: (profile: ArgusProfile) => ArgusFolder | null | undefined;
  checkingProxyIds: ReadonlySet<string>;
  statusOptions: string[];
  onStatus: (profile: ArgusProfile, status: string) => void;
};

export type ProfileColumn = TableColumn<ArgusProfile, ProfileColumnContext>;

// An em dash, not an empty cell. A blank in a table of fourteen columns reads
// as a rendering fault; a dash reads as "this profile has none".
function none() {
  return <span className="cell-muted">—</span>;
}

function text(value: string | null | undefined) {
  return value ? <span className="cell-text" title={value}>{value}</span> : none();
}

// fail < unchecked < ok, so ascending opens on the broken ones -- the only
// reason anyone clicks this header. A profile with no proxy has no value at
// all and sinks in both directions, which is useTableSort's missingRank rule.
const CHECK_RANK: Record<string, number> = {fail: 0, checking: 1, unchecked: 2, ok: 3};

export const PROFILE_COLUMNS: ProfileColumn[] = [
  {
    id: 'name',
    label: 'Name',
    group: 'Identity',
    locked: true,
    cellClassName: 'name-cell',
    sort: (profile) => profile.name,
    cell: (profile) => <><ProfileAvatar profile={profile} />{profile.name}</>,
  },
  {
    id: 'platform',
    label: 'Platform',
    group: 'Identity',
    cellClassName: 'platform-cell',
    description: 'The operating system this profile presents.',
    sort: (profile) => profile.fingerprint?.os,
    cell: (profile) => <PlatformIcon os={profile.fingerprint?.os} />,
  },
  {
    id: 'status',
    label: 'Status',
    group: 'Workspace',
    // The picker is a control inside a row that is itself a selection target.
    stopRowClick: true,
    sort: (profile) => profile.status || 'Ready',
    cell: (profile, context) => (
      <StatusPicker
        status={profile.status || 'Ready'}
        options={context.statusOptions}
        onChange={(status) => context.onStatus(profile, status)}
      />
    ),
  },
  {
    id: 'assignee',
    label: 'Assigned',
    group: 'Workspace',
    teamOnly: true,
    description: 'The teammate on the hook for this profile.',
    // Sorts by the name shown, not the uuid stored: an id sort groups a
    // person's rows together in an order nobody can read.
    sort: (profile, context) => assigneeName(profile.assigned_to, context.state.members),
    cell: (profile) => <Assignee userId={profile.assigned_to} />,
  },
  {
    // "Date added", not "Created": the same created_at, named for what the
    // reader is scanning the column for. The id stays `created` because it
    // names the field, not the header.
    id: 'created',
    label: 'Date added',
    group: 'Workspace',
    firstDirection: 'desc',
    sort: (profile) => profile.created_at,
    cell: (profile) => formatDateShort(profile.created_at) || none(),
  },
  {
    id: 'folder',
    label: 'Folder',
    group: 'Workspace',
    sort: (profile, context) => context.folderFor(profile)?.name,
    cell: (profile, context) => profile.deleted_at ?
      `${daysUntilPurge(profile.deleted_at)}d left in Trash` :
      <FolderLabel fallback="All profiles" folder={context.folderFor(profile)} />,
  },
  {
    // The connection, and -- next door -- its health. These were one cell for a
    // while, which put the answer to "does this profile's proxy work" in the
    // same column as "which proxy is it", sortable only by the second. Two
    // columns because they are two questions, and separable because some
    // workspaces care about neither and some care only about the check.
    id: 'proxy',
    label: 'Proxy',
    group: 'Connection',
    cellClassName: 'profile-proxy-cell',
    description: 'The proxy this profile launches through, as host:port.',
    sort: (profile, context) => {
      const assigned = context.proxyFor(profile);
      return assigned ? `${assigned.host}:${assigned.port}` : undefined;
    },
    cell: (profile, context) => {
      const proxy = context.proxyFor(profile);
      return proxy ?
        <span className="profile-proxy-host">{proxy.host}:{proxy.port}</span> :
        'Direct';
    },
  },
  {
    id: 'proxyStatus',
    label: 'Proxy check',
    group: 'Connection',
    cellClassName: 'profile-proxy-status-cell',
    description: 'The result of the last check on this profile\'s proxy.',
    sort: (profile, context) => {
      const proxy = context.proxyFor(profile);
      return proxy ? CHECK_RANK[storedCheckState(proxy).status] : undefined;
    },
    cell: (profile, context) => {
      const proxy = context.proxyFor(profile);
      // Nothing at all for a direct connection. An "unchecked" chip there would
      // be a lie about a connection that has nothing to check.
      if (!proxy) {
        return none();
      }
      return (
        <ProxyCheckCell
          state={context.checkingProxyIds.has(proxy.id) ?
            {status: 'checking'} :
            storedCheckState(proxy)}
          age={proxy.check_error ? undefined : proxy.checked_at}
        />
      );
    },
  },
  {
    // Tags is a set, not a value -- there is no order to sort a row of chips by
    // that means anything to the person reading it.
    id: 'tags',
    label: 'Tags',
    group: 'Workspace',
    cell: (profile) => <TagCell tags={profile.tags} />,
  },
  {
    id: 'email',
    label: 'Login email',
    group: 'Identity',
    hiddenByDefault: true,
    cellClassName: 'cell-wide',
    description: 'The account this profile is logged into. The password is never shown in the table.',
    sort: (profile) => profile.email,
    cell: (profile) => text(profile.email),
  },
  {
    id: 'profileId',
    label: 'Profile ID',
    group: 'Identity',
    hiddenByDefault: true,
    cellClassName: 'profile-id-cell',
    // Not sortable: a uuid order is an order, but not one anybody reads.
    description: 'The uuid the API and MCP tools address this profile by.',
    stopRowClick: true,
    cell: (profile) => (
      <>
        <span className="profile-id" title={profile.id}>{profile.id.slice(0, 8)}</span>
        <CopyButton className="ghost icon-button row-action" value={profile.id} label="" copiedLabel="" />
      </>
    ),
  },
  {
    id: 'fpBrowser',
    label: 'Browser',
    group: 'Fingerprint',
    hiddenByDefault: true,
    cellClassName: 'cell-soft',
    description: 'The Chrome version this profile reports.',
    sort: (profile) => profile.fingerprint?.browser_version,
    cell: (profile) => text(profile.fingerprint?.browser_version),
  },
  {
    id: 'fpTimezone',
    label: 'Timezone',
    group: 'Fingerprint',
    hiddenByDefault: true,
    cellClassName: 'cell-soft',
    description: 'The timezone this profile presents.',
    sort: (profile) => profile.fingerprint?.timezone,
    cell: (profile) => text(profile.fingerprint?.timezone),
  },
  {
    id: 'fpLanguage',
    label: 'Language',
    group: 'Fingerprint',
    hiddenByDefault: true,
    cellClassName: 'cell-soft',
    description: 'The Accept-Language this profile presents.',
    sort: (profile) => profile.fingerprint?.language,
    cell: (profile) => text(profile.fingerprint?.language),
  },
  {
    id: 'fpScreen',
    label: 'Screen',
    group: 'Fingerprint',
    hiddenByDefault: true,
    cellClassName: 'cell-soft',
    description: 'The screen resolution this profile presents.',
    sort: (profile) => profile.fingerprint?.screen,
    cell: (profile) => text(profile.fingerprint?.screen),
  },
  {
    id: 'startUrl',
    label: 'Start URL',
    group: 'Launch',
    hiddenByDefault: true,
    cellClassName: 'cell-wide',
    description: 'The page this profile opens on launch.',
    sort: (profile) => profile.start_url,
    cell: (profile) => text(profile.start_url),
  },
  {
    id: 'automation',
    label: 'Automation',
    group: 'Launch',
    hiddenByDefault: true,
    description: 'The workflow that runs when this profile launches.',
    sort: (profile, context) => automationName(profile, context),
    cell: (profile, context) => text(automationName(profile, context)),
  },
  {
    id: 'cookieSet',
    label: 'Cookie set',
    group: 'Launch',
    hiddenByDefault: true,
    cellClassName: 'cell-wide',
    description: 'The cookies this profile is seeded with at launch.',
    sort: (profile, context) => cookieSetName(profile, context),
    cell: (profile, context) => text(cookieSetName(profile, context)),
  },
];

function automationName(profile: ArgusProfile, {state}: ProfileColumnContext) {
  return profile.automation_id ?
    state.automations.find((item) => item.id === profile.automation_id)?.name :
    undefined;
}

// Two ways a profile can carry cookies: a set from the shared library, or a
// file pasted into the profile itself. The column answers "what is this
// launched with", so it reports either.
function cookieSetName(profile: ArgusProfile, {state}: ProfileColumnContext) {
  if (profile.cookie_mode === 'saved') {
    return state.cookies.find((item) => item.id === profile.cookie_id)?.name;
  }
  return profile.cookie_import_name || undefined;
}
