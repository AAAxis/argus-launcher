import {optionalClient, raise, requireClient} from './client';
import {rowToStatus} from './mappers';
import type {CustomStatusRow} from './rows';

// The app models custom profile statuses as a plain string[]; the table stores
// one row per label. `color` exists in the schema but the UI has never used it.
export async function list(orgId: string): Promise<string[]> {
  const client = optionalClient();
  if (!client) {
    return [];
  }
  const {data, error} = await client
      .from('custom_statuses')
      .select('id,org_id,label,color')
      .eq('org_id', orgId);
  raise(error, 'statuses.list');
  return ((data || []) as unknown as CustomStatusRow[]).map(rowToStatus).filter(Boolean);
}

export async function create(orgId: string, label: string): Promise<void> {
  const client = requireClient();
  const {error} = await client.from('custom_statuses').insert({org_id: orgId, label});
  raise(error, 'statuses.create');
}

export async function remove(orgId: string, label: string): Promise<void> {
  const client = requireClient();
  const {error} = await client
      .from('custom_statuses')
      .delete()
      .eq('org_id', orgId)
      .eq('label', label);
  raise(error, 'statuses.remove');
}
