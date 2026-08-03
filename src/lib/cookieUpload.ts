import * as db from '../db';
import type {CookieFileSelection} from '../native';
import type {ArgusProfile} from '../types';

export type CookieImportFields = Pick<ArgusProfile,
  'cookie_import_path' | 'cookie_import_url' | 'cookie_import_name' | 'cookie_import_count'>;

// Uploads a picked cookie file to Storage and returns the cookie_import_*
// fields that point at it. Keyed by whatever id the caller owns -- a profile id
// for a per-profile import, a fresh cookie-set id for the shared library.
export async function cloudCookieFromSelection(
    ownerId: string, selection: CookieFileSelection): Promise<CookieImportFields> {
  const cookieName = selection.name ||
    selection.path.split(/[\\/]/).filter(Boolean).at(-1) ||
    'cookies.txt';
  if (!selection.base64) {
    throw new Error('Cookie file upload payload is missing. Select the cookie file again.');
  }
  const url = await db.cookieSets.uploadCookieFile(ownerId, cookieName, selection.base64);
  return {
    cookie_import_path: null,
    cookie_import_name: cookieName,
    cookie_import_count: selection.count || null,
    cookie_import_url: url,
  };
}
