// What the Cookies table's cells can write, and what they can offer.
//
// The cells themselves are in tables/cookieColumns.tsx and are pure functions
// of a row and a context. Every write goes through cookies.save, which is
// already a partial patch (and the tags one goes through normalizeTags there,
// the single enforcement point every write path into tags shares) -- so unlike
// proxyCellActions there are no write-path rules to guard here, only the
// wiring.
//
// Deliberately NOT memoised, for the reason profileCellActions documents. The
// option lists ARE, because they are pure derivations of their inputs.
import {useMemo} from 'react';
import {statusOptionRows} from '../components/ui/StatusChip';
import {useWorkspace} from '../workspace/WorkspaceProvider';
import {folderCellOptions} from './proxyCellActions';
import type {CookieCellActions, CookieCellOptions} from './cookieColumns';
import type {CloudState} from '../types';

export function useCookieCellOptions(
    state: CloudState, statuses: string[]): CookieCellOptions {
  const folders = useMemo(() =>
    folderCellOptions(state.cookie_folders), [state.cookie_folders]);
  // Chips rather than names, through the same helper the other two tables'
  // status pickers use.
  const statusRows = useMemo(() => statusOptionRows(statuses), [statuses]);
  return {folders, statuses: statusRows};
}

export function useCookieCellActions(): CookieCellActions {
  const {cookies} = useWorkspace();
  return {
    setTags: (cookie, tags) => void cookies.save(cookie.id, {tags}),
    setFolder: (cookie, folderId) =>
      void cookies.save(cookie.id, {folder_id: folderId || null}),
    setStatus: (cookie, status) => void cookies.save(cookie.id, {status}),
    setColor: (cookie, color) => void cookies.save(cookie.id, {color}),
  };
}
