import type {ArgusProxy} from '../types';
import {optionalClient, raise, requireClient} from './client';
import {proxyToRow, rowToProxy} from './mappers';
import type {ProxyRow} from './rows';

const COLUMNS =
  'id,org_id,name,type,host,port,username,password,folder_id,last_checked_at,last_ip,' +
  'last_country,last_latency_ms,created_at,last_country_code,last_error';

export async function list(orgId: string): Promise<ArgusProxy[]> {
  const client = optionalClient();
  if (!client) {
    return [];
  }
  const {data, error} = await client
      .from('proxies')
      .select(COLUMNS)
      .eq('org_id', orgId)
      .order('created_at', {ascending: true});
  raise(error, 'proxies.list');
  return ((data || []) as unknown as ProxyRow[]).map(rowToProxy);
}

export async function upsert(orgId: string, proxy: ArgusProxy): Promise<void> {
  const client = requireClient();
  const {error} = await client
      .from('proxies')
      .upsert(proxyToRow(orgId, proxy), {onConflict: 'id'});
  raise(error, 'proxies.upsert');
}

// Profiles referencing this proxy are set to proxy_id = null by the FK's
// ON DELETE SET NULL, so the caller only has to mirror that locally.
export async function remove(orgId: string, ids: string[]): Promise<void> {
  if (ids.length === 0) {
    return;
  }
  const client = requireClient();
  const {error} = await client
      .from('proxies')
      .delete()
      .eq('org_id', orgId)
      .in('id', ids);
  raise(error, 'proxies.remove');
}

// Files one proxy under a folder, or back under "All proxies" with null.
//
// A narrow update rather than an upsert of the whole row, for the same reason
// recordCheck below is one: filing a proxy while someone else edits its
// credentials -- or while the background sweep records a check -- must touch
// the one column it means to.
export async function assignFolder(
    orgId: string, id: string, folderId: string | null): Promise<void> {
  const client = requireClient();
  const {error} = await client
      .from('proxies')
      .update({folder_id: folderId})
      .eq('org_id', orgId)
      .eq('id', id);
  raise(error, 'proxies.assignFolder');
}

// The result of a proxy check -- the background loop's only write. Kept
// separate from upsert() so a check landing while someone edits the proxy's
// credentials touches only the five check columns.
export type ProxyCheckResult = {
  country?: string;
  country_code?: string;
  egress_ip?: string;
  ping_ms?: number;
  checked_at?: string;
  check_error?: string;
};

export async function recordCheck(
    orgId: string, id: string, result: ProxyCheckResult): Promise<void> {
  const client = requireClient();
  const {error} = await client
      .from('proxies')
      .update({
        last_country: result.country ?? null,
        last_country_code: result.country_code ?? null,
        last_ip: result.egress_ip ?? null,
        last_latency_ms: result.ping_ms ?? null,
        last_checked_at: result.checked_at ?? null,
        last_error: result.check_error ?? null,
      })
      .eq('org_id', orgId)
      .eq('id', id);
  raise(error, 'proxies.recordCheck');
}
