// The shared per-org collections that are not profiles or proxies: folders,
// custom statuses, the cookie-set library, shared bookmarks and shared
// extensions. Small CRUD, grouped because each one is a handful of lines and
// they all follow the same write-then-patch shape.
import * as db from '../db';
import {describeDbError} from '../db/errors';
import {baseProfileStatuses} from '../data/statuses';
import {cloudCookieFromSelection} from '../lib/cookieUpload';
import {statusList} from '../lib/text';
import {native} from '../native';
import {supabase} from '../supabase';
import {newId} from './core';
import type {WorkspaceCore} from './core';
import type {CookieFileSelection} from '../native';
import type {
  ArgusCookie, ArgusFolder, BuiltInExtensionToggles, SharedBookmark, SharedExtension,
} from '../types';

export type LibraryActions = ReturnType<typeof useLibraryActions>;

export function useLibraryActions({data, toast}: WorkspaceCore) {
  const {state, setState, withDb, patch} = data;

  // ---- Folders ---------------------------------------------------------

  async function createFolder(name: string, icon?: string): Promise<ArgusFolder | null> {
    const folder: ArgusFolder = {id: newId(), name, icon, created_at: new Date().toISOString()};
    if (!await withDb((activeOrgId) => db.folders.create(activeOrgId, folder))) {
      return null;
    }
    patch.folders((list) => [...list, folder]);
    return folder;
  }

  async function saveFolder(
      folderId: string, patchFields: {name: string; icon?: string}): Promise<boolean> {
    const next = {name: patchFields.name, icon: patchFields.icon ?? null};
    if (!await withDb((activeOrgId) => db.folders.update(activeOrgId, folderId, next))) {
      return false;
    }
    patch.folders((list) => list.map((item) =>
      item.id === folderId ? {...item, name: next.name, icon: patchFields.icon} : item));
    return true;
  }

  // profiles.folder_id is nulled server-side by the FK's ON DELETE SET NULL,
  // so this is genuinely one statement; the local lists just mirror it.
  async function removeFolder(folderId: string): Promise<boolean> {
    if (!await withDb((activeOrgId) => db.folders.remove(activeOrgId, folderId))) {
      return false;
    }
    patch.folders((list) => list.filter((item) => item.id !== folderId));
    patch.profiles((list) => list.map((profile) =>
      profile.folder_id === folderId ? {...profile, folder_id: null} : profile));
    return true;
  }

  // ---- Statuses --------------------------------------------------------

  async function createStatus(name: string): Promise<boolean> {
    // A built-in status needs no row; statusList still dedupes the local list.
    const isNew = !baseProfileStatuses.includes(name) && !state.custom_statuses.includes(name);
    if (isNew && !await withDb((activeOrgId) => db.statuses.create(activeOrgId, name))) {
      return false;
    }
    const statuses = statusList(
        state.custom_statuses,
        baseProfileStatuses.includes(name) ? [] : [name]);
    setState((current) => ({...current, custom_statuses: statuses}));
    return true;
  }

  // ---- Cookie-set library ---------------------------------------------

  // Uploads a picked cookie file straight into the shared library, reusing the
  // same upload path as a per-profile import but keyed by a fresh cookie id.
  async function addCookieSet(selection: CookieFileSelection): Promise<ArgusCookie | null> {
    const id = newId();
    const uploaded = await cloudCookieFromSelection(id, selection);
    if (!uploaded.cookie_import_url) {
      throw new Error('Cookie upload did not return a usable URL.');
    }
    const entry: ArgusCookie = {
      id,
      name: uploaded.cookie_import_name || 'cookies.txt',
      url: uploaded.cookie_import_url,
      count: uploaded.cookie_import_count,
    };
    if (!await withDb((activeOrgId) => db.cookieSets.create(activeOrgId, entry))) {
      return null;
    }
    patch.cookies((list) => [...list, entry]);
    return entry;
  }

  // The FK nulls profiles.cookie_set_id server-side, but nothing puts those
  // profiles back into 'paste' mode -- that stays an explicit write, one per
  // profile that actually referenced this set.
  async function removeCookieSet(id: string): Promise<boolean> {
    const referencing = state.profiles.filter((profile) => profile.cookie_id === id);
    const ok = await withDb(async (activeOrgId) => {
      await db.cookieSets.remove(activeOrgId, id);
      for (const profile of referencing) {
        await db.profiles.update(activeOrgId, profile.id, {cookie_id: null, cookie_mode: 'paste'});
      }
    });
    if (!ok) {
      return false;
    }
    patch.cookies((list) => list.filter((item) => item.id !== id));
    patch.profiles((list) => list.map((profile) =>
      profile.cookie_id === id ?
        {...profile, cookie_id: null, cookie_mode: 'paste' as const} :
        profile));
    return true;
  }

  // ---- Bookmarks -------------------------------------------------------

  // Bookmarks are addressed by url, the way the edit dialog already thinks of
  // them: originalUrl identifies the row when the url itself is being changed.
  async function saveBookmark(
      bookmark: SharedBookmark, originalUrl?: string): Promise<boolean> {
    const existing = state.shared_bookmarks.find((item) =>
      item.url === (originalUrl || bookmark.url));
    const saved: SharedBookmark = {
      ...bookmark,
      position: existing?.position ?? state.shared_bookmarks.length,
    };
    const ok = await withDb(async (activeOrgId) => {
      if (existing) {
        await db.bookmarks.updateByUrl(activeOrgId, existing.url, saved);
      } else {
        await db.bookmarks.create(activeOrgId, saved);
      }
    });
    if (!ok) {
      return false;
    }
    patch.bookmarks((list) => [
      ...list.filter((item) => item.url !== (originalUrl || bookmark.url)),
      saved,
    ]);
    return true;
  }

  async function removeBookmark(url: string): Promise<boolean> {
    if (!await withDb((activeOrgId) => db.bookmarks.removeByUrl(activeOrgId, url))) {
      return false;
    }
    patch.bookmarks((list) => list.filter((bookmark) => bookmark.url !== url));
    return true;
  }

  // ---- Shared extensions ----------------------------------------------

  // Uploads the zipped folder to Supabase Storage so every team member can
  // materialize their own local copy later (see main.cjs's
  // materializeSharedExtension) -- cloud state only ever holds this public
  // URL, never the extension's files directly.
  async function addExtensionFromFolder(): Promise<boolean> {
    if (!native?.selectExtensionFolder || !native?.zipExtensionFolder) {
      toast.setMessage('Native folder picker is not available. Restart Argus Launcher and try again.');
      return false;
    }
    const folderPath = await native.selectExtensionFolder();
    if (!folderPath?.trim()) {
      return false;
    }
    if (!supabase) {
      toast.setMessage('Cloud sync is not configured, so this extension can only be shared with your team once it is.');
      return false;
    }
    toast.setMessage('Uploading extension for your team…');
    const zipped = await native.zipExtensionFolder(folderPath);
    if (!zipped.ok || !zipped.base64) {
      toast.setMessage(zipped.error || 'Failed to zip that extension folder.');
      return false;
    }
    const id = newId();
    const name = folderPath.trim().split('/').filter(Boolean).at(-1) || 'Extension';
    let uploaded: {url: string; inline: boolean};
    try {
      uploaded = await db.extensions.uploadPackage(id, zipped.base64);
    } catch (error) {
      toast.setMessage(describeDbError(error, 'Upload failed.'));
      return false;
    }
    const extension: SharedExtension = {id, name, source: 'local', storageUrl: uploaded.url};
    const ok = await withDb((activeOrgId) =>
      db.extensions.upsert(activeOrgId, extension,
          uploaded.inline ? null : `shared-extensions/${id}.zip`));
    if (!ok) {
      return false;
    }
    patch.extensions((list) => [...list, extension]);
    toast.setMessage(uploaded.inline ?
      `${name} shared inline. Check the ${db.STORAGE_BUCKET} storage bucket for large extensions.` :
      `${name} shared with your team`);
    return true;
  }

  // Web Store extensions need no upload at all -- every team member
  // downloads/unpacks the same published CRX directly from Google's own CDN
  // the first time they launch a profile that uses it.
  async function addExtensionFromWebStore(webstoreId: string, displayName: string): Promise<boolean> {
    if (state.shared_extensions.some((extension) => extension.webstoreId === webstoreId)) {
      toast.setMessage('That extension is already shared');
      return false;
    }
    const extension: SharedExtension = {
      id: webstoreId,
      name: displayName.trim() || webstoreId,
      source: 'webstore',
      webstoreId,
    };
    if (!await withDb((activeOrgId) => db.extensions.upsert(activeOrgId, extension))) {
      return false;
    }
    patch.extensions((list) => [...list, extension]);
    toast.setMessage('Extension shared with your team');
    return true;
  }

  async function removeExtension(id: string): Promise<boolean> {
    if (!await withDb((activeOrgId) => db.extensions.remove(activeOrgId, id))) {
      return false;
    }
    patch.extensions((list) => list.filter((extension) => extension.id !== id));
    return true;
  }

  // These toggles live on the organization, not on the individual user, so one
  // worker cannot silently change what their colleagues' profiles launch with.
  // The RLS UPDATE policy on organizations requires is_org_admin, which is why
  // the switches are disabled for plain members rather than failing on click.
  async function setBuiltInExtensionEnabled(
      key: keyof BuiltInExtensionToggles, enabled: boolean): Promise<boolean> {
    const next = {...state.built_in_extensions, [key]: enabled};
    if (!await withDb((activeOrgId) => db.orgs.updateBuiltInExtensions(activeOrgId, next))) {
      return false;
    }
    setState((current) => ({...current, built_in_extensions: next}));
    return true;
  }

  return {
    createFolder,
    saveFolder,
    removeFolder,
    createStatus,
    addCookieSet,
    removeCookieSet,
    saveBookmark,
    removeBookmark,
    addExtensionFromFolder,
    addExtensionFromWebStore,
    removeExtension,
    setBuiltInExtensionEnabled,
  };
}
