import type {SharedExtension} from '../types';
import {optionalClient, raise, requireClient, STORAGE_BUCKET} from './client';
import {isStorageNotWritable} from './cookieSets';
import {extensionToRow, rowToExtension} from './mappers';
import type {SharedExtensionRow} from './rows';

export async function list(orgId: string): Promise<SharedExtension[]> {
  const client = optionalClient();
  if (!client) {
    return [];
  }
  const {data, error} = await client
      .from('shared_extensions')
      .select('id,org_id,name,source,storage_path,created_at,webstore_id,storage_url,enabled')
      .eq('org_id', orgId)
      .order('created_at', {ascending: true});
  raise(error, 'extensions.list');
  return ((data || []) as unknown as SharedExtensionRow[]).map(rowToExtension);
}

// The primary key is (org_id, id), not (id) -- a Web Store extension's row id
// is the Web Store id itself, so two orgs sharing one extension share its id.
// Both keys are therefore required on conflict, and on delete below: a
// single-key delete would be a cross-tenant attempt, which RLS turns into a
// silent no-op rather than an error.
export async function upsert(
    orgId: string, extension: SharedExtension, storagePath?: string | null): Promise<void> {
  const client = requireClient();
  const {error} = await client
      .from('shared_extensions')
      .upsert(extensionToRow(orgId, extension, storagePath), {onConflict: 'org_id,id'});
  raise(error, 'extensions.upsert');
}

export async function remove(orgId: string, id: string): Promise<void> {
  const client = requireClient();
  const {error} = await client
      .from('shared_extensions')
      .delete()
      .eq('org_id', orgId)
      .eq('id', id);
  raise(error, 'extensions.remove');
}

// Uploads a zipped extension folder and returns its public URL, or an inline
// data: URL when the bucket is unreachable. The caller reports which happened,
// because an inline package bloats every row that references it.
export type UploadResult = {url: string; inline: boolean};

export async function uploadPackage(id: string, base64: string): Promise<UploadResult> {
  const client = optionalClient();
  if (!client) {
    return {url: `data:application/zip;base64,${base64}`, inline: true};
  }
  const objectPath = `shared-extensions/${id}.zip`;
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const {error: uploadError} = await client.storage
      .from(STORAGE_BUCKET)
      .upload(objectPath, bytes, {contentType: 'application/zip', upsert: true});
  if (uploadError && isStorageNotWritable(uploadError)) {
    return {url: `data:application/zip;base64,${base64}`, inline: true};
  }
  if (uploadError) {
    throw new Error(`Upload failed: ${uploadError.message}`);
  }
  const {data} = client.storage.from(STORAGE_BUCKET).getPublicUrl(objectPath);
  return {url: data.publicUrl, inline: false};
}
