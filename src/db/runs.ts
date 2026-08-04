// Run history.
//
// Runs are not part of CloudState. They are unbounded and only the history view
// wants them, so they are read on demand with an explicit limit -- the same
// reason cookieSets.list() leaves the `cookies` column out of its select.
import type {AutomationRun} from '../types';
import {optionalClient, raise, requireClient} from './client';
import {rowToRun, runToRow} from './mappers';
import type {AutomationRunRow} from './rows';

const COLUMNS =
  'id,org_id,automation_id,automation_name,profile_id,profile_name,trigger,status,' +
  'started_at,finished_at,duration_ms,step_count,failed_step_id,error,vars,log';

const DEFAULT_LIMIT = 50;

export async function list(
    orgId: string,
    options: {automationId?: string; profileId?: string; limit?: number} = {},
): Promise<AutomationRun[]> {
  const client = optionalClient();
  if (!client) {
    return [];
  }
  let query = client
      .from('automation_runs')
      .select(COLUMNS)
      .eq('org_id', orgId);
  if (options.automationId) {
    query = query.eq('automation_id', options.automationId);
  }
  if (options.profileId) {
    query = query.eq('profile_id', options.profileId);
  }
  const {data, error} = await query
      .order('started_at', {ascending: false})
      .limit(options.limit ?? DEFAULT_LIMIT);
  raise(error, 'runs.list');
  return ((data || []) as unknown as AutomationRunRow[]).map(rowToRun);
}

// Inserted when the run starts, not when it ends.
//
// A row that only appears on success would mean a crashed or killed run leaves
// no trace at all, which is the outcome the whole disk-buffer path in
// electron/automation/store.cjs exists to prevent. A `running` row that never
// reaches a terminal status is itself the signal something died.
export async function start(orgId: string, run: AutomationRun): Promise<void> {
  const client = requireClient();
  const {error} = await client.from('automation_runs').insert(runToRow(orgId, run));
  raise(error, 'runs.start');
}

// The terminal write. Takes the whole run rather than a patch because the
// runner holds it entire and the log is only complete at this point.
export async function finish(orgId: string, run: AutomationRun): Promise<void> {
  const client = requireClient();
  const {id: _id, org_id: _orgId, ...row} = runToRow(orgId, run);
  const {error} = await client
      .from('automation_runs')
      .update(row)
      .eq('org_id', orgId)
      .eq('id', run.id);
  raise(error, 'runs.finish');
}

// Used by the disk-buffer flush: a run that finished while the window was
// closed has no row at all, so it cannot be updated into place.
export async function upsertFinished(orgId: string, run: AutomationRun): Promise<void> {
  const client = requireClient();
  // Safe to upsert here, unlike automations: automation_runs has no BEFORE
  // INSERT trigger, so the conflict path costs nothing.
  const {error} = await client
      .from('automation_runs')
      .upsert(runToRow(orgId, run), {onConflict: 'id'});
  raise(error, 'runs.upsertFinished');
}

export async function purgeOlderThan(orgId: string, cutoffIso: string): Promise<void> {
  const client = requireClient();
  const {error} = await client
      .from('automation_runs')
      .delete()
      .eq('org_id', orgId)
      .lt('started_at', cutoffIso);
  raise(error, 'runs.purgeOlderThan');
}
