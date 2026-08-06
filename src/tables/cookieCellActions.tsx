// What the Cookies table's cells can write, and what they can offer.
//
// The cells themselves are in tables/cookieColumns.tsx and are pure functions
// of a row and a context. Both writes go through cookies.save, which is
// already a partial patch (and the tags one goes through normalizeTags there,
// the single enforcement point every write path into tags shares) -- so unlike
// proxyCellActions there are no write-path rules to guard here, only the
// wiring.
//
// Deliberately NOT memoised, for the reason profileCellActions documents. The
// option list IS, because it is a pure derivation of the folder array.
import {useMemo} from 'react';
import {useWorkspace} from '../workspace/WorkspaceProvider';
import {folderCellOptions} from './proxyCellActions';
import type {CookieCellActions, CookieCellOptions} from './cookieColumns';
import type {CloudState} from '../types';

export function useCookieCellOptions(state: CloudState): CookieCellOptions {
  const folders = useMemo(() =>
    folderCellOptions(state.cookie_folders), [state.cookie_folders]);
  return {folders};
}

export function useCookieCellActions(): CookieCellActions {
  const {cookies} = useWorkspace();
  return {
    setTags: (cookie, tags) => void cookies.save(cookie.id, {tags}),
    setFolder: (cookie, folderId) =>
      void cookies.save(cookie.id, {folder_id: folderId || null}),
  };
}
