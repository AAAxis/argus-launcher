import type {ArgusProfile} from '../types';
import {optionalClient, raise, requireClient} from './client';
import {profilePatchToRow, profileToRow, rowToProfile} from './mappers';
import type {ProfileRow} from './rows';

const COLUMNS =
  'id,org_id,name,notes,folder_id,proxy_id,cookie_set_id,fingerprint,status,tags,start_urls,' +
  'command_line_switches,created_by,deleted_at,updated_at,created_at,color,proxy_mode,' +
  'cookie_mode,cookie_import_path,cookie_import_url,cookie_import_name,cookie_import_count,' +
  'email,password,automation_id';

// Trashed profiles come back too -- the Trash view reads the same list and
// filters on deleted_at, exactly as it did against the blob.
export async function list(orgId: string): Promise<ArgusProfile[]> {
  const client = optionalClient();
  if (!client) {
    return [];
  }
  const {data, error} = await client
      .from('profiles')
      .select(COLUMNS)
      .eq('org_id', orgId)
      .order('created_at', {ascending: true});
  raise(error, 'profiles.list');
  return ((data || []) as unknown as ProfileRow[]).map(rowToProfile);
}

// Deliberately NOT an upsert.
//
// trg_profile_limit is BEFORE INSERT, and Postgres fires BEFORE INSERT triggers
// for `insert ... on conflict do update` even when the conflict path is taken --
// verified against this database. So an upsert used to edit an existing profile
// raises profile_limit_reached whenever the org is at its cap, which would mean
// a free-tier org with 5 profiles could not edit any of them. Callers know
// whether the profile is new; they pick.
//
// The id is never regenerated in either path: it is also the on-disk directory
// name under E:\ArgysProfiles\<id>, so changing it orphans that profile's
// browser data.
export async function create(orgId: string, profile: ArgusProfile): Promise<void> {
  const client = requireClient();
  const {error} = await client.from('profiles').insert(profileToRow(orgId, profile));
  raise(error, 'profiles.create');
}

// Writes every editable column of an existing row. `id` and `org_id` are
// stripped from the payload: they are the lookup keys, not fields to rewrite.
export async function replace(orgId: string, profile: ArgusProfile): Promise<void> {
  const client = requireClient();
  const {id: _id, org_id: _orgId, ...row} = profileToRow(orgId, profile);
  const {error} = await client
      .from('profiles')
      .update(row)
      .eq('org_id', orgId)
      .eq('id', profile.id);
  raise(error, 'profiles.replace');
}

// Create-or-replace, decided by the caller rather than by the database, for the
// reason in the comment above.
export async function save(
    orgId: string, profile: ArgusProfile, exists: boolean): Promise<void> {
  return exists ? replace(orgId, profile) : create(orgId, profile);
}

// Only the keys present in `patch` are written, so a worker changing a status
// cannot clobber another worker's proxy assignment on the same row.
export async function update(
    orgId: string, id: string, patch: Partial<ArgusProfile>): Promise<void> {
  const client = requireClient();
  const {error} = await client
      .from('profiles')
      .update(profilePatchToRow(patch))
      .eq('org_id', orgId)
      .eq('id', id);
  raise(error, 'profiles.update');
}

export async function softDelete(orgId: string, ids: string[]): Promise<void> {
  if (ids.length === 0) {
    return;
  }
  const client = requireClient();
  const now = new Date().toISOString();
  const {error} = await client
      .from('profiles')
      .update({deleted_at: now, updated_at: now})
      .eq('org_id', orgId)
      .in('id', ids);
  raise(error, 'profiles.softDelete');
}

// Restoring crosses the profile limit too -- trg_profile_limit_restore fires on
// exactly this update, so it can raise profile_limit_reached.
export async function restore(orgId: string, ids: string[]): Promise<void> {
  if (ids.length === 0) {
    return;
  }
  const client = requireClient();
  const {error} = await client
      .from('profiles')
      .update({deleted_at: null, updated_at: new Date().toISOString()})
      .eq('org_id', orgId)
      .in('id', ids);
  raise(error, 'profiles.restore');
}

export async function purge(orgId: string, ids: string[]): Promise<void> {
  if (ids.length === 0) {
    return;
  }
  const client = requireClient();
  const {error} = await client
      .from('profiles')
      .delete()
      .eq('org_id', orgId)
      .in('id', ids);
  raise(error, 'profiles.purge');
}

// The 30-day Trash expiry, as one statement instead of a filter-and-rewrite of
// the whole array. Returns the ids it removed so the caller can report a count.
export async function purgeExpired(orgId: string, cutoffIso: string): Promise<string[]> {
  const client = optionalClient();
  if (!client) {
    return [];
  }
  const {data, error} = await client
      .from('profiles')
      .delete()
      .eq('org_id', orgId)
      .not('deleted_at', 'is', null)
      .lt('deleted_at', cutoffIso)
      .select('id');
  raise(error, 'profiles.purgeExpired');
  return ((data || []) as Array<{id: string}>).map((row) => row.id);
}
