// Every column the Proxies table can show.
//
// The same eight it has always shown -- nothing new here. The value is that a
// workspace running one kind of proxy in one country can drop Type and Country
// rather than scrolling past two columns that say the same thing on every row.
//
// Ids are the old useTableSort keys, unchanged, so a sort means what it did.
import {AssignedCell} from '../components/ui/AssignedCell';
import {Assignee} from '../components/ui/Assignee';
import {FolderLabel} from '../components/ui/FolderLabel';
import {FlagIcon} from '../components/ui/icons';
import {ProxyCheckCell, storedCheckState} from '../components/ui/ProxyCheckCell';
import {assigneeName} from '../lib/assignees';
import {profilesUsingProxy, proxyCountryLabel} from '../lib/proxies';
import type {TableColumn} from './columns';
import type {ArgusProfile, ArgusProxy, CloudState} from '../types';

export type ProxyColumnContext = {
  state: CloudState;
  checkingProxyIds: ReadonlySet<string>;
};

export type ProxyColumn = TableColumn<ArgusProxy, ProxyColumnContext>;

function folderFor(proxy: ArgusProxy, {state}: ProxyColumnContext) {
  return state.proxy_folders.find((item) => item.id === proxy.folder_id);
}

function holders(proxy: ArgusProxy, {state}: ProxyColumnContext): ArgusProfile[] {
  return profilesUsingProxy(proxy, state.profiles);
}

export const PROXY_COLUMNS: ProxyColumn[] = [
  {
    id: 'name',
    label: 'Name',
    locked: true,
    cellClassName: 'name-cell',
    // Falls back to the host the same way the cell does, so sorting by Name
    // never strands the unnamed rows.
    sort: (proxy) => proxy.name || proxy.host,
    cell: (proxy) => (
      <>
        <span className="proxy-flag" title={proxyCountryLabel(proxy) || 'Country not checked'}>
          <FlagIcon countryCode={proxy.country_code} />
        </span>
        {proxy.name || proxy.host}
      </>
    ),
  },
  {
    id: 'type',
    label: 'Type',
    description: 'http or socks5.',
    sort: (proxy) => (proxy.type || 'http').toUpperCase(),
    cell: (proxy) => (proxy.type || 'http').toUpperCase(),
  },
  {
    id: 'host',
    label: 'Host',
    cellClassName: 'proxy-host-cell',
    description: 'The connection, as host:port.',
    sort: (proxy) => `${proxy.host}:${proxy.port}`,
    cell: (proxy) => `${proxy.host}:${proxy.port}`,
  },
  {
    id: 'country',
    label: 'Country',
    description: 'Where the last check saw this proxy exit.',
    sort: (proxy) => proxy.country || proxy.country_code,
    cell: (proxy) => proxyCountryLabel(proxy) || '-',
  },
  {
    // Sorts on the timestamp behind "3h ago". A proxy that has never been
    // checked has no timestamp, so it sinks in both directions rather than
    // heading a descending sort -- which is the whole point of asking for it.
    id: 'checked',
    label: 'Last check',
    cellClassName: 'proxy-check-cell',
    firstDirection: 'desc',
    sort: (proxy) => proxy.checked_at,
    cell: (proxy, context) => (
      <ProxyCheckCell
        state={context.checkingProxyIds.has(proxy.id) ?
          {status: 'checking'} :
          storedCheckState(proxy)}
        age={proxy.check_error ? undefined : proxy.checked_at}
      />
    ),
  },
  {
    id: 'folder',
    label: 'Folder',
    sort: (proxy, context) => folderFor(proxy, context)?.name,
    cell: (proxy, context) =>
      <FolderLabel fallback="All proxies" folder={folderFor(proxy, context)} />,
  },
  {
    // "Used by", not "Assigned to": it lists the PROFILES holding this proxy,
    // the identical thing the Cookies tab calls "Used by", and the old label
    // collided with the Assigned column beside it, which names a person.
    id: 'assigned',
    label: 'Used by',
    firstDirection: 'desc',
    description: 'How many profiles launch through this proxy.',
    sort: (proxy, context) => holders(proxy, context).length || undefined,
    cell: (proxy, context) => <AssignedCell holders={holders(proxy, context)} />,
  },
  {
    id: 'assignee',
    label: 'Assigned',
    teamOnly: true,
    description: 'The teammate on the hook for this proxy.',
    sort: (proxy, context) => assigneeName(proxy.assigned_to, context.state.members),
    cell: (proxy) => <Assignee userId={proxy.assigned_to} />,
  },
];
