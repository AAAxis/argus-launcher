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
  ArgusAutomation, ArgusCookie, ArgusFolder, ArgusProfile, ArgusProxy, CloudState, SharedBookmark,
  SharedExtension,
} from '../types';

export type CloudData = ReturnType<typeof useCloudData>;

export function useCloudData(orgId: string | null, toast: Toast) {
  const [state, setState] = useState<CloudState>(defaultCloudState);
  const [loading, setLoading] = useState(false);

  // The same write as withDb, but handing the failure text back instead of
  // toasting it -- for callers that render the error themselves. A dialog
  // showing "Could not save" inline, next to the fields that caused it, must
  // not also raise a toast saying the same thing in the corner.
  const withDbError = useCallback(async (
      action: (activeOrgId: string) => Promise<unknown>): Promise<string | null> => {
    if (!orgId) {
      return 'No organization is selected yet.';
    }
    try {
      await action(orgId);
      return null;
    } catch (error) {
      return describeDbError(error, 'Could not save to the cloud.');
    }
  }, [orgId]);

  // Runs targeted db writes and reports failure the way the whole app already
  // expects: message set, false returned, caller bails without a false
  // success toast.
  const withDb = useCallback(async (
      action: (activeOrgId: string) => Promise<unknown>): Promise<boolean> => {
    const error = await withDbError(action);
    if (error) {
      toast.setMessage(error);
      return false;
    }
    return true;
    // toast is rebuilt every render; only withDbError decides what this does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [withDbError]);

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
    proxyFolders: (fn: (list: ArgusFolder[]) => ArgusFolder[]) =>
      setState((current) => ({...current, proxy_folders: fn(current.proxy_folders)})),
    cookieFolders: (fn: (list: ArgusFolder[]) => ArgusFolder[]) =>
      setState((current) => ({...current, cookie_folders: fn(current.cookie_folders)})),
    cookies: (fn: (list: ArgusCookie[]) => ArgusCookie[]) =>
      setState((current) => ({...current, cookies: fn(current.cookies)})),
    extensions: (fn: (list: SharedExtension[]) => SharedExtension[]) =>
      setState((current) => ({...current, shared_extensions: fn(current.shared_extensions)})),
    bookmarks: (fn: (list: SharedBookmark[]) => SharedBookmark[]) =>
      setState((current) => ({...current, shared_bookmarks: fn(current.shared_bookmarks)})),
    automations: (fn: (list: ArgusAutomation[]) => ArgusAutomation[]) =>
      setState((current) => ({...current, automations: fn(current.automations)})),
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
      // allSettled, not all. These nine reads are independent, and Promise.all
      // rejects the whole batch on the first failure -- which meant one table
      // the client could not read left `loaded` unassigned, setState never
      // called, and the entire workspace rendering as defaultCloudState. A
      // single missing column (folders.color, before its migration was applied)
      // therefore presented as "all my profiles, folders and proxies are gone",
      // while the rows sat untouched in Postgres. Read failures must degrade to
      // the tables they actually affect.
      const [profilesResult, proxiesResult, foldersResult, cookiesResult, extensionsResult,
        bookmarksResult, statusesResult, automationsResult,
        organizationResult] = await Promise.allSettled([
        db.profiles.list(targetOrgId),
        db.proxies.list(targetOrgId),
        db.folders.list(targetOrgId),
        db.cookieSets.list(targetOrgId),
        db.extensions.list(targetOrgId),
        db.bookmarks.list(targetOrgId),
        db.statuses.list(targetOrgId),
        db.automations.list(targetOrgId),
        db.orgs.getOrg(targetOrgId),
      ]);

      const failures: string[] = [];
      function take<T>(label: string, result: PromiseSettledResult<T>, fallback: T): T {
        if (result.status === 'fulfilled') {
          return result.value;
        }
        failures.push(`${label} (${describeDbError(result.reason, 'unknown error')})`);
        return fallback;
      }

      const profiles = take('profiles', profilesResult, []);
      const proxies = take('proxies', proxiesResult, []);
      // One read, three lists. Every library's folders live in the same table
      // and are told apart by `kind`; splitting here rather than at each call
      // site is what keeps a proxy folder out of the profiles folder row.
      //
      // Each filter names its own kind rather than excluding the others: the
      // profiles list used to be `!== 'proxy'`, which silently swallowed
      // cookie folders the moment a third kind existed.
      const allFolders = take('folders', foldersResult, []);
      const folders = allFolders.filter(
          (folder) => folder.kind !== 'proxy' && folder.kind !== 'cookie');
      const proxyFolders = allFolders.filter((folder) => folder.kind === 'proxy');
      const cookieFolders = allFolders.filter((folder) => folder.kind === 'cookie');
      const cookies = take('cookie sets', cookiesResult, []);
      const sharedExtensions = take('extensions', extensionsResult, []);
      const bookmarkRows = take('bookmarks', bookmarksResult, []);
      const customStatuses = take('statuses', statusesResult, []);
      const automations = take('automations', automationsResult, []);
      const organization = take('organization', organizationResult, null);
      const mergedBookmarks = mergeBookmarks(bookmarkRows, socialBookmarks);

      // A partial load is shown but never written back from. Every self-healing
      // pass below decides what to change by comparing tables against each
      // other, so running them on a half-read org is destructive rather than
      // merely wrong: an empty `proxies` makes repairProxyAssignments read every
      // profile's assignment as dangling and rewrite the lot to direct.
      //
      // The spreads keep whatever the failed tables already held. React applies
      // queued updaters in order, so the `reset()` WorkspaceProvider fires
      // before this load on an org switch has already landed in `current` --
      // one org's rows cannot survive into another's view.
      if (failures.length > 0) {
        setState((current) => ({
          ...current,
          ...(profilesResult.status === 'fulfilled' ? {profiles} : {}),
          ...(proxiesResult.status === 'fulfilled' ? {proxies} : {}),
          ...(foldersResult.status === 'fulfilled' ?
            {folders, proxy_folders: proxyFolders, cookie_folders: cookieFolders} : {}),
          ...(cookiesResult.status === 'fulfilled' ? {cookies} : {}),
          ...(extensionsResult.status === 'fulfilled' ? {shared_extensions: sharedExtensions} : {}),
          ...(bookmarksResult.status === 'fulfilled' ?
            {shared_bookmarks: mergedBookmarks.bookmarks} : {}),
          ...(statusesResult.status === 'fulfilled' ? {custom_statuses: customStatuses} : {}),
          ...(automationsResult.status === 'fulfilled' ? {automations} : {}),
          ...(organizationResult.status === 'fulfilled' ?
            {built_in_extensions: organization?.built_in_extensions} : {}),
        }));
        // Toasted even when quiet: a failing table stays failing, so silence
        // here is the same "everything vanished" mystery in a smaller frame.
        toast.setMessage(describeLoadFailure(failures));
        // Null means "not a complete picture of the org" -- the caller uses the
        // return value to seed a selection, which a partial load cannot do
        // honestly.
        return null;
      }

      const loaded: CloudState = {
        profiles,
        folders,
        proxy_folders: proxyFolders,
        cookie_folders: cookieFolders,
        proxies,
        cookies,
        shared_extensions: sharedExtensions,
        shared_bookmarks: mergedBookmarks.bookmarks,
        custom_statuses: customStatuses,
        automations,
        built_in_extensions: organization?.built_in_extensions,
      };

      // The three self-healing passes below used to rewrite the whole document
      // when any of them changed anything. Each now writes only the rows it
      // actually touched.
      const {state: repairedState, repaired} = repairProxyAssignments(loaded);
      const {state: migratedState, migrated} = migrateLegacyCookieImports(repairedState);

      // Both Trash sweeps run after migrateLegacyCookieImports, not before: a
      // set the migration just re-created would otherwise be eligible for the
      // same pass that created it.
      const cutoff = trashCutoffIso();
      const purgedIds = await db.profiles.purgeExpired(targetOrgId, cutoff);
      const purged = purgedIds.length;
      const purgedCookieIds = await db.cookieSets.purgeExpired(targetOrgId, cutoff);
      const purgedCookies = purgedCookieIds.length;
      const finalState: CloudState = purged === 0 && purgedCookies === 0 ?
        migratedState :
        {
          ...migratedState,
          profiles: migratedState.profiles
              .filter((profile) => !purgedIds.includes(profile.id))
              // The FK's ON DELETE SET NULL fixed cookie_set_id server-side;
              // nothing fixes the copy we are about to render. Without this a
              // profile keeps pointing at a set that no longer exists, so the
              // Cookies tab over-reports "used by" and the profile shows as
              // 'saved' with nothing to resolve until the next full load.
              .map((profile) => profile.cookie_id &&
                  purgedCookieIds.includes(profile.cookie_id) ?
                {...profile, cookie_id: null, cookie_mode: 'paste' as const} :
                profile),
          cookies: migratedState.cookies.filter(
              (cookie) => !purgedCookieIds.includes(cookie.id)),
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
      if (!quiet && (repaired > 0 || mergedBookmarks.changed || purged > 0 || migrated > 0 ||
          purgedCookies > 0)) {
        toast.setMessage(describeSelfHealing({
          repaired,
          bookmarksAdded: mergedBookmarks.changed,
          purged,
          migrated,
          purgedCookies,
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

  return {orgId, state, setState, loading, withDb, withDbError, patch, load, reset};
}

// What could not be read, and the reassurance that goes with it.
//
// The second half is not padding. The symptom of a failed read is a table that
// looks empty, which is indistinguishable from data having been deleted -- and
// the first person to hit this read it as exactly that. Naming the cause
// (Postgres says what it refused, e.g. "column folders.color does not exist")
// is also what makes a schema drift diagnosable from a screenshot.
function describeLoadFailure(failures: string[]): string {
  return `Could not load ${failures.join(', ')}. Everything else is shown as usual, and ` +
    'nothing has been deleted -- this is a read that failed, not a change to your data.';
}

// One sentence covering whichever of the self-healing passes did something on
// this load. Built from a list rather than nested ternaries so adding a pass
// does not mean rewriting the separators.
function describeSelfHealing(
    {repaired, bookmarksAdded, purged, migrated, purgedCookies}:
    {repaired: number; bookmarksAdded: boolean; purged: number; migrated: number;
      purgedCookies: number}) {
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
  if (purgedCookies) {
    parts.push(`Purged ${purgedCookies} trashed cookie-${purgedCookies === 1 ? 'set' : 'sets'}`);
  }
  if (migrated) {
    parts.push(`Added ${migrated} existing cookie ${migrated === 1 ? 'import' : 'imports'} to the library`);
  }
  return parts.join(' · ');
}
