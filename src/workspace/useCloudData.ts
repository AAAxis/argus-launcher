// The org's data and the primitives every mutation is built from: one loader,
// one write wrapper, and per-table local patches.
//
// cloudState stays the render cache the whole UI reads from. A mutation writes
// its rows through withDb and then applies the same change locally, rather than
// re-reading everything -- the reads are per-table selects, not one blob, so a
// full reload after every edit would be several round trips for one changed
// column.
import {useCallback, useState} from 'react';
import * as db from '../db';
import {describeDbError} from '../db/errors';
import {defaultCloudState} from '../data/statuses';
import {mergeBookmarks, socialBookmarks} from '../lib/bookmarks';
import {migrateLegacyCookieImports} from '../lib/cookies';
import {repairProxyAssignments} from '../lib/proxies';
import {trashCutoffIso} from '../lib/trash';
import type {Toast} from '../hooks/useToast';
import type {
  ArgusCookie, ArgusFolder, ArgusProfile, ArgusProxy, CloudState, SharedBookmark, SharedExtension,
} from '../types';

export type CloudData = ReturnType<typeof useCloudData>;

export function useCloudData(orgId: string | null, toast: Toast) {
  const [state, setState] = useState<CloudState>(defaultCloudState);
  const [loading, setLoading] = useState(false);

  // Runs targeted db writes and reports failure the way the whole app already
  // expects: message set, false returned, caller bails without a false
  // success toast.
  const withDb = useCallback(async (
      action: (activeOrgId: string) => Promise<unknown>): Promise<boolean> => {
    if (!orgId) {
      toast.setMessage('No organization is selected yet.');
      return false;
    }
    try {
      await action(orgId);
      return true;
    } catch (error) {
      toast.setMessage(describeDbError(error, 'Could not save to the cloud.'));
      return false;
    }
    // toast is rebuilt every render; only orgId decides what this closure does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId]);

  // The updater form matters: several call sites write more than one row in a
  // loop, and reading the closure-captured state between iterations would lose
  // the earlier ones.
  const patch = {
    profiles: (fn: (list: ArgusProfile[]) => ArgusProfile[]) =>
      setState((current) => ({...current, profiles: fn(current.profiles)})),
    proxies: (fn: (list: ArgusProxy[]) => ArgusProxy[]) =>
      setState((current) => ({...current, proxies: fn(current.proxies)})),
    folders: (fn: (list: ArgusFolder[]) => ArgusFolder[]) =>
      setState((current) => ({...current, folders: fn(current.folders)})),
    cookies: (fn: (list: ArgusCookie[]) => ArgusCookie[]) =>
      setState((current) => ({...current, cookies: fn(current.cookies)})),
    extensions: (fn: (list: SharedExtension[]) => SharedExtension[]) =>
      setState((current) => ({...current, shared_extensions: fn(current.shared_extensions)})),
    bookmarks: (fn: (list: SharedBookmark[]) => SharedBookmark[]) =>
      setState((current) => ({...current, shared_bookmarks: fn(current.shared_bookmarks)})),
  };

  // One parallel read per table instead of five sequential selects against one
  // jsonb row. `quiet` suppresses the repair toast so a window-focus refresh
  // does not nag the user; the caller decides what else quiet means to it.
  const load = useCallback(async (
      targetOrgId: string,
      options?: {quiet?: boolean},
  ): Promise<CloudState | null> => {
    const quiet = Boolean(options?.quiet);
    if (!quiet) {
      setLoading(true);
    }
    try {
      const [profiles, proxies, folders, cookies, sharedExtensions, bookmarkRows,
        customStatuses, organization] = await Promise.all([
        db.profiles.list(targetOrgId),
        db.proxies.list(targetOrgId),
        db.folders.list(targetOrgId),
        db.cookieSets.list(targetOrgId),
        db.extensions.list(targetOrgId),
        db.bookmarks.list(targetOrgId),
        db.statuses.list(targetOrgId),
        db.orgs.getOrg(targetOrgId),
      ]);
      const mergedBookmarks = mergeBookmarks(bookmarkRows, socialBookmarks);
      const loaded: CloudState = {
        profiles,
        folders,
        proxies,
        cookies,
        shared_extensions: sharedExtensions,
        shared_bookmarks: mergedBookmarks.bookmarks,
        custom_statuses: customStatuses,
        built_in_extensions: organization?.built_in_extensions,
      };

      // The three self-healing passes below used to rewrite the whole document
      // when any of them changed anything. Each now writes only the rows it
      // actually touched.
      const {state: repairedState, repaired} = repairProxyAssignments(loaded);
      const {state: migratedState, migrated} = migrateLegacyCookieImports(repairedState);

      const purgedIds = await db.profiles.purgeExpired(targetOrgId, trashCutoffIso());
      const purged = purgedIds.length;
      const finalState: CloudState = purged === 0 ?
        migratedState :
        {
          ...migratedState,
          profiles: migratedState.profiles.filter((profile) => !purgedIds.includes(profile.id)),
        };

      if (mergedBookmarks.changed) {
        for (let index = 0; index < mergedBookmarks.bookmarks.length; index++) {
          const bookmark = mergedBookmarks.bookmarks[index];
          if (!bookmarkRows.some((existing) => existing.url === bookmark.url)) {
            await db.bookmarks.create(targetOrgId, {...bookmark, position: index});
          }
        }
      }
      if (repaired > 0) {
        for (const profile of repairedState.profiles) {
          const before = profiles.find((item) => item.id === profile.id);
          if (before && (before.proxy_id !== profile.proxy_id ||
              before.proxy_mode !== profile.proxy_mode)) {
            await db.profiles.update(targetOrgId, profile.id,
                {proxy_id: profile.proxy_id, proxy_mode: profile.proxy_mode});
          }
        }
      }
      if (migrated > 0) {
        for (const cookie of migratedState.cookies) {
          if (!cookies.some((existing) => existing.id === cookie.id)) {
            await db.cookieSets.create(targetOrgId, cookie);
          }
        }
        for (const profile of migratedState.profiles) {
          const before = repairedState.profiles.find((item) => item.id === profile.id);
          if (before && (before.cookie_id !== profile.cookie_id ||
              before.cookie_mode !== profile.cookie_mode)) {
            await db.profiles.update(targetOrgId, profile.id,
                {cookie_id: profile.cookie_id, cookie_mode: profile.cookie_mode});
          }
        }
      }

      setState(finalState);
      if (!quiet && (repaired > 0 || mergedBookmarks.changed || purged > 0 || migrated > 0)) {
        toast.setMessage(describeSelfHealing({
          repaired,
          bookmarksAdded: mergedBookmarks.changed,
          purged,
          migrated,
        }));
      }
      return finalState;
    } catch (error) {
      toast.setMessage(describeDbError(error, 'Could not load your data.'));
      return null;
    } finally {
      if (!quiet) {
        setLoading(false);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const reset = useCallback(() => setState(defaultCloudState), []);

  return {orgId, state, setState, loading, withDb, patch, load, reset};
}

// One sentence covering whichever of the four self-healing passes did something
// on this load. Built from a list rather than nested ternaries so adding a pass
// does not mean rewriting the separators.
function describeSelfHealing(
    {repaired, bookmarksAdded, purged, migrated}:
    {repaired: number; bookmarksAdded: boolean; purged: number; migrated: number}) {
  const parts: string[] = [];
  if (repaired) {
    parts.push(`Repaired ${repaired} proxy assignments`);
  }
  if (bookmarksAdded) {
    parts.push('Added social bookmarks');
  }
  if (purged) {
    parts.push(`Purged ${purged} trashed ${purged === 1 ? 'profile' : 'profiles'}`);
  }
  if (migrated) {
    parts.push(`Added ${migrated} existing cookie ${migrated === 1 ? 'import' : 'imports'} to the library`);
  }
  return parts.join(' · ');
}
