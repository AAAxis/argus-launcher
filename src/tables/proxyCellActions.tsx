// What the Proxies table's cells can write, and what they can offer.
//
// The cells themselves are in tables/proxyColumns.tsx and are pure functions of
// a row and a context -- they hold no hooks and reach for no store. This is
// where the context's two halves are built, and it is the only place the rules
// that a cell must not be able to get wrong are written down:
//
//  - assigned_to goes through the set_assignee RPC, never a proxy patch.
//  - every connection edit goes through proxies.setConnection, which clears the
//    six last_* check columns in the same statement -- never through
//    proxies.update, whose whole-row upsert would race the background sweep.
//
// Deliberately NOT memoised, for the reason profileCellActions documents: every
// handler closes over `state`, which changes on every write, and a stable
// identity here would be a stale closure. The option lists ARE memoised,
// because they are pure derivations of arrays that only change when the data
// does.
import {useMemo} from 'react';
import {FolderGlyph} from '../components/ui/FolderGlyph';
import {useOrg} from '../org';
import {useWorkspace} from '../workspace/WorkspaceProvider';
import type {CellOption} from '../components/ui/CellControls';
import type {ProxyCellActions, ProxyCellOptions} from './proxyColumns';
import type {ArgusFolder, CloudState} from '../types';

// Static: the two protocols the native checker and the launch payload speak.
// There is no shared list to import -- the proxy editor's <select> spells its
// two options inline -- so this is where the pickers get theirs.
export const PROXY_TYPE_OPTIONS: CellOption[] = [
  {value: 'socks5', label: 'SOCKS5'},
  {value: 'http', label: 'HTTP'},
];

// Folder rows for a CellPicker, drawn the way FolderSelect draws them: the
// folder's own glyph in its own colour, then the name. Shared by the Proxies
// and Cookies tables (cookieCellActions imports it), which is why it lives
// here rather than being copied.
export function folderCellOptions(folders: ArgusFolder[]): CellOption[] {
  return folders.map((folder) => ({
    value: folder.id,
    label: folder.name,
    render: (
      <>
        <FolderGlyph color={folder.color} icon={folder.icon} size={13} small />
        <span className="filter-pop-name">{folder.name}</span>
      </>
    ),
  }));
}

export function useProxyCellOptions(state: CloudState): ProxyCellOptions {
  const folders = useMemo(() =>
    folderCellOptions(state.proxy_folders), [state.proxy_folders]);

  // Yourself first and named "You", the same word the Assignee chip uses --
  // the same mapping useProfileCellOptions builds from the same roster.
  const members = useMemo<CellOption[]>(() => state.members.map((member) => ({
    value: member.user_id,
    label: member.display_name || member.email.split('@')[0] || member.email,
    searchText: `${member.display_name || ''} ${member.email}`.toLowerCase(),
  })), [state.members]);

  return {types: PROXY_TYPE_OPTIONS, folders, members};
}

export function useProxyCellActions(): ProxyCellActions {
  const {proxies, shared, reload} = useWorkspace();
  const org = useOrg();

  return {
    setName: (proxy, name) => void proxies.rename(proxy, name),

    setType: (proxy, type) => void proxies.setConnection(proxy, {type}),

    // The whole endpoint in one write. Usually just host and port, but a paste
    // of a full vendor line (socks5://user:pass@host:port) carries the type and
    // credentials too, and landing them in one setConnection call means one
    // check-clearing statement rather than four.
    setEndpoint: (proxy, endpoint) => void proxies.setConnection(proxy, {
      host: endpoint.host,
      port: endpoint.port,
      ...(endpoint.type ? {type: endpoint.type} : {}),
      ...(endpoint.username !== undefined ? {username: endpoint.username || null} : {}),
      ...(endpoint.password !== undefined ? {password: endpoint.password || null} : {}),
    }),

    setUsername: (proxy, username) =>
      void proxies.setConnection(proxy, {username: username || null}),

    setPassword: (proxy, password) =>
      void proxies.setConnection(proxy, {password: password || null}),

    setFolder: (proxy, folderId) =>
      void proxies.assignToFolder([proxy.id], folderId || null),

    // Not proxies.update. The proxy row mapper carries assigned_to, but the
    // rule is the same one profiles enforce: assignment moves through the
    // set_assignee RPC so a stale session's ordinary save cannot silently
    // reassign the row.
    setAssignee: (proxy, userId) => {
      if (!org.orgId) {
        return;
      }
      void shared.setAssignee(org.orgId, 'proxy', proxy.id, userId || null, reload);
    },

    recheckProxy: (proxy) => void proxies.checkOnce(proxy),
  };
}
