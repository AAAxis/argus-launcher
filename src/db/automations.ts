import type {ArgusAutomation} from '../types';
import {optionalClient, raise, requireClient} from './client';
import {automationPatchToRow, automationToRow, rowToAutomation} from './mappers';
import type {AutomationRow} from './rows';

const COLUMNS =
  'id,org_id,name,description,steps,variables,tags,pinned,timeout_ms,close_on_finish,' +
  'notify_connector_id,notify_on,created_by,created_at,updated_at,assigned_to';

export async function list(orgId: string): Promise<ArgusAutomation[]> {
  const client = optionalClient();
  if (!client) {
    return [];
  }
  const {data, error} = await client
      .from('automations')
      .select(COLUMNS)
      .eq('org_id', orgId)
      .order('created_at', {ascending: true});
  raise(error, 'automations.list');
  return ((data || []) as unknown as AutomationRow[]).map(rowToAutomation);
}

// Deliberately NOT an upsert -- the same trap profiles.ts documents.
//
// trg_automation_limit is BEFORE INSERT, and Postgres fires BEFORE INSERT
// triggers for `insert ... on conflict do update` even when the conflict path
// is taken. So an upsert used to EDIT an automation raises
// automation_limit_reached whenever the org is at its cap, which would mean an
// org on a 10-flow plan with 10 flows could not edit any of them. Callers know
// whether it is new; they pick.
//
// The id is never regenerated either: it is the directory name for that
// automation's run artifacts under <userData>/AutomationRuns/, and a new id
// orphans the history.
export async function create(orgId: string, automation: ArgusAutomation): Promise<void> {
  const client = requireClient();
  const {error} = await client.from('automations').insert(automationToRow(orgId, automation));
  raise(error, 'automations.create');
}

// Writes every editable column of an existing row. `id` and `org_id` are
// stripped: they are the lookup keys, not fields to rewrite.
export async function replace(orgId: string, automation: ArgusAutomation): Promise<void> {
  const client = requireClient();
  const {id: _id, org_id: _orgId, ...row} = automationToRow(orgId, automation);
  const {error} = await client
      .from('automations')
      .update(row)
      .eq('org_id', orgId)
      .eq('id', automation.id);
  raise(error, 'automations.replace');
}

export async function save(
    orgId: string, automation: ArgusAutomation, exists: boolean): Promise<void> {
  return exists ? replace(orgId, automation) : create(orgId, automation);
}

// Only the keys present in `patch` are written, so toggling `pinned` from the
// list view cannot clobber a step edit someone else is saving.
export async function update(
    orgId: string, id: string, patch: Partial<ArgusAutomation>): Promise<void> {
  const client = requireClient();
  const {error} = await client
      .from('automations')
      .update(automationPatchToRow(patch))
      .eq('org_id', orgId)
      .eq('id', id);
  raise(error, 'automations.update');
}

// Hard delete -- automations have no Trash.
//
// An automation is a document, not an asset: nothing on disk belongs to one, so
// there is nothing to orphan. profiles.automation_id is ON DELETE SET NULL, so
// this detaches rather than cascades, and automation_runs keeps a denormalized
// automation_name so history stays readable afterwards.
export async function remove(orgId: string, ids: string[]): Promise<void> {
  if (ids.length === 0) {
    return;
  }
  const client = requireClient();
  const {error} = await client
      .from('automations')
      .delete()
      .eq('org_id', orgId)
      .in('id', ids);
  raise(error, 'automations.remove');
}
