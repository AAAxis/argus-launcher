import {optionalClient, raise, requireClient} from './client';
import type {AutomationStarRow} from './rows';

// The signed-in user's starred automations. org_id is filtered even though RLS
// already narrows every read to user_id = auth.uid() -- a star made in one
// workspace must not surface in another (rule 1 in index.ts).
export async function list(orgId: string): Promise<string[]> {
  const client = optionalClient();
  if (!client) {
    return [];
  }
  const {data, error} = await client
      .from('automation_stars')
      .select('automation_id')
      .eq('org_id', orgId);
  raise(error, 'automationStars.list');
  return ((data || []) as unknown as Pick<AutomationStarRow, 'automation_id'>[])
      .map((row) => row.automation_id);
}

// Plain insert; a duplicate key means the star is already there, which is the
// state this call wanted -- the notification_reads reasoning, 23505 and
// nothing else swallowed. user_id comes from the column default, auth.uid().
export async function add(orgId: string, automationId: string): Promise<void> {
  const client = requireClient();
  const {error} = await client
      .from('automation_stars')
      .insert({org_id: orgId, automation_id: automationId});
  if (error && error.code !== '23505') {
    raise(error, 'automationStars.add');
  }
}

// RLS limits the delete to own rows, so no user_id filter is needed -- but the
// org filter stays, per rule 1.
export async function remove(orgId: string, automationId: string): Promise<void> {
  const client = requireClient();
  const {error} = await client
      .from('automation_stars')
      .delete()
      .eq('org_id', orgId)
      .eq('automation_id', automationId);
  raise(error, 'automationStars.remove');
}
