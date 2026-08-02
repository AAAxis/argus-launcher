import type {ArgusCookie} from '../types';
import {optionalClient, raise, requireClient, STORAGE_BUCKET} from './client';
import {rowToCookie} from './mappers';
import type {CookieSetRow} from './rows';

export async function list(orgId: string): Promise<ArgusCookie[]> {
  const client = optionalClient();
  if (!client) {
    return [];
  }
  const {data, error} = await client
      .from('cookie_sets')
      .select('id,org_id,name,cookies,updated_at,created_at,source_url,count')
      .eq('org_id', orgId)
      .order('created_at', {ascending: true});
  raise(error, 'cookieSets.list');
  return ((data || []) as unknown as CookieSetRow[]).map(rowToCookie);
}

// `cookies` stays '[]': the launcher has only ever stored a Storage URL for the
// payload (source_url), and electron/main.cjs fetches it at launch. Prompt 06
// is what starts putting cookie contents in the column. updated_at is written
// explicitly -- no trigger maintains it.
export async function create(orgId: string, cookie: ArgusCookie): Promise<void> {
  const client = requireClient();
  const {error} = await client.from('cookie_sets').insert({
    id: cookie.id,
    org_id: orgId,
    name: cookie.name,
    source_url: cookie.url || null,
    count: cookie.count ?? null,
    updated_at: new Date().toISOString(),
  });
  raise(error, 'cookieSets.create');
}

export async function update(
    orgId: string, id: string, patch: Partial<ArgusCookie>): Promise<void> {
  const client = requireClient();
  const row: Record<string, unknown> = {updated_at: new Date().toISOString()};
  if ('name' in patch) {
    row.name = patch.name ?? null;
  }
  if ('url' in patch) {
    row.source_url = patch.url || null;
  }
  if ('count' in patch) {
    row.count = patch.count ?? null;
  }
  const {error} = await client
      .from('cookie_sets')
      .update(row)
      .eq('org_id', orgId)
      .eq('id', id);
  raise(error, 'cookieSets.update');
}

// Profiles pointing at this set are reset to cookie_set_id = null by the FK's
// ON DELETE SET NULL; the caller still flips their cookie_mode back to 'paste'.
export async function remove(orgId: string, id: string): Promise<void> {
  const client = requireClient();
  const {error} = await client
      .from('cookie_sets')
      .delete()
      .eq('org_id', orgId)
      .eq('id', id);
  raise(error, 'cookieSets.remove');
}

// ---- storage ------------------------------------------------------------

// Uploads a cookie file to the public `global` bucket and returns its URL, or
// an inline data: URL when the bucket is unreachable. Object paths are
// unchanged from the blob era so electron/main.cjs consumes them identically.
export async function uploadCookieFile(
    keyId: string, fileName: string, base64: string): Promise<string> {
  const client = optionalClient();
  if (!client) {
    return `data:text/plain;base64,${base64}`;
  }
  const safeName = fileName.replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '') ||
    'cookies.txt';
  const objectPath = `profile-cookies/${keyId}/${Date.now()}-${safeName}`;
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const {error: uploadError} = await client.storage
      .from(STORAGE_BUCKET)
      .upload(objectPath, bytes, {contentType: 'text/plain', upsert: true});
  if (uploadError && isStorageNotWritable(uploadError)) {
    return `data:text/plain;base64,${base64}`;
  }
  if (uploadError) {
    throw new Error(`Cookie upload failed: ${uploadError.message}`);
  }
  const {data} = client.storage.from(STORAGE_BUCKET).getPublicUrl(objectPath);
  return data.publicUrl;
}

// A bucket that is missing or write-protected is a deployment problem, not a
// user error: fall back to an inline data: URL so the cookie still reaches the
// browser on this machine instead of failing the whole operation.
export function isStorageNotWritable(error: unknown): boolean {
  if (!error) {
    return false;
  }
  const candidate = error as {message?: string; statusCode?: string | number};
  const message = (candidate.message || '').toLowerCase();
  return message.includes('bucket not found') ||
    message.includes('row-level security') ||
    message.includes('permission') ||
    message.includes('unauthorized') ||
    String(candidate.statusCode || '') === '404';
}
