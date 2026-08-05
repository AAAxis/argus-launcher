// The workspace's model endpoints, for the AI steps.
//
// Ordinary org-scoped CRUD, with one wrinkle: `is_default` is backed by a
// partial unique index (one true per org), so promoting a provider is two
// statements and they have to run in the right order -- see setDefault.
import type {ArgusAiProvider} from '../types';
import {optionalClient, raise, requireClient} from './client';
import {aiProviderToRow, rowToAiProvider} from './mappers';
import type {AiProviderRow} from './rows';

// api_key is selected. It has to be: the renderer is what hands providers to
// the main process, which is the only place that can make an outbound HTTPS
// call, and a key nobody can read is a provider nothing can run against. See
// the migration for why every member may read it and only owners may write.
const COLUMNS =
  'id,org_id,name,kind,base_url,model,api_key,is_default,created_by,created_at,updated_at';

export async function list(orgId: string): Promise<ArgusAiProvider[]> {
  const client = optionalClient();
  if (!client) {
    return [];
  }
  const {data, error} = await client
      .from('ai_providers')
      .select(COLUMNS)
      .eq('org_id', orgId)
      .order('created_at', {ascending: true});
  raise(error, 'aiProviders.list');
  return ((data || []) as unknown as AiProviderRow[]).map(rowToAiProvider);
}

// Split rather than upserted, like automations and profiles. There is no
// BEFORE INSERT trigger on this table today, but the split costs nothing and
// the two callers already know which one they are.
export async function create(orgId: string, provider: ArgusAiProvider): Promise<void> {
  const client = requireClient();
  const {error} = await client.from('ai_providers').insert(aiProviderToRow(orgId, provider));
  raise(error, 'aiProviders.create');
}

export async function replace(orgId: string, provider: ArgusAiProvider): Promise<void> {
  const client = requireClient();
  const {id: _id, org_id: _orgId, ...row} = aiProviderToRow(orgId, provider);
  const {error} = await client
      .from('ai_providers')
      .update(row)
      .eq('org_id', orgId)
      .eq('id', provider.id);
  raise(error, 'aiProviders.replace');
}

export async function save(
    orgId: string, provider: ArgusAiProvider, exists: boolean): Promise<void> {
  return exists ? replace(orgId, provider) : create(orgId, provider);
}

// Demote everything, then promote one. This order is not interchangeable:
// ai_providers_one_default_per_org is a unique index over the rows where
// is_default is true, so promoting first collides with the incumbent and the
// whole change fails. Demoting first leaves a brief window with no default,
// which is a state the app already handles -- an AI step naming no provider
// says so rather than guessing.
export async function setDefault(orgId: string, id: string): Promise<void> {
  const client = requireClient();
  const cleared = await client
      .from('ai_providers')
      .update({is_default: false, updated_at: new Date().toISOString()})
      .eq('org_id', orgId)
      .eq('is_default', true);
  raise(cleared.error, 'aiProviders.setDefault');
  const {error} = await client
      .from('ai_providers')
      .update({is_default: true, updated_at: new Date().toISOString()})
      .eq('org_id', orgId)
      .eq('id', id);
  raise(error, 'aiProviders.setDefault');
}

// Hard delete. A provider is configuration, not an asset -- nothing on disk
// belongs to one.
//
// Steps referencing it by id are deliberately left alone rather than rewritten:
// there is no foreign key to follow (a step lives inside an automation's jsonb),
// and silently repointing every workflow at whatever provider remains would be
// a bigger surprise than a step that says the provider it names is gone.
export async function remove(orgId: string, ids: string[]): Promise<void> {
  if (ids.length === 0) {
    return;
  }
  const client = requireClient();
  const {error} = await client
      .from('ai_providers')
      .delete()
      .eq('org_id', orgId)
      .in('id', ids);
  raise(error, 'aiProviders.remove');
}
