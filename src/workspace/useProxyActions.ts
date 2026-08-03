import * as db from '../db';
import {toCsv} from '../lib/csv';
import {native} from '../native';
import {newId} from './core';
import type {WorkspaceCore} from './core';
import type {ProxyCheckResult, ProxyConfig} from '../native';
import type {ArgusProxy} from '../types';

const NO_CHECKER = 'Native proxy checker is not available. Restart Argus Launcher and try again.';

export type ProxyActions = ReturnType<typeof useProxyActions>;

export function useProxyActions({data, toast}: WorkspaceCore) {
  const {state, withDb, patch} = data;

  // Every proxy-check path (background loop, manual re-check, pre-launch check)
  // lands here. The write touches the six last_* columns only, so a check
  // completing while someone edits that proxy's credentials cannot undo the
  // edit. Explicit nulls matter: a proxy that just started working must clear
  // its stored error, and PostgREST drops undefined rather than nulling it.
  async function recordCheck(proxy: ArgusProxy): Promise<boolean> {
    patch.proxies((list) => list.map((item) => item.id === proxy.id ? proxy : item));
    return withDb((activeOrgId) => db.proxies.recordCheck(activeOrgId, proxy.id, {
      country: proxy.country,
      country_code: proxy.country_code,
      egress_ip: proxy.egress_ip,
      ping_ms: proxy.ping_ms,
      checked_at: proxy.checked_at,
      check_error: proxy.check_error,
    }));
  }

  // Runs the native check and folds its result into the proxy row. Shared by
  // the background sweep, the pre-launch gate and the manual re-check, so all
  // three record failures the same way.
  async function runCheck(proxy: ArgusProxy): Promise<ArgusProxy> {
    const result = await native?.checkProxy?.(proxy);
    if (!result) {
      throw new Error(NO_CHECKER);
    }
    return {
      ...proxy,
      country: result.country,
      country_code: result.countryCode,
      egress_ip: result.ip,
      ping_ms: result.pingMs,
      checked_at: new Date().toISOString(),
      check_error: result.ok ? undefined : result.error || 'Proxy check failed',
    };
  }

  // A check against connection details that may not be saved yet -- the proxy
  // editor's "Test connection", which has to work before a row exists. The main
  // process check takes a bare host/port/credentials (the local HTTP API's
  // POST /v1/proxies/check already relies on that), so nothing here touches the
  // database: the caller decides whether the result is worth recording.
  //
  // Returns the failure rather than throwing so the dialog can render it inline
  // next to the fields that caused it, instead of in a toast that vanishes
  // while the user is still typing.
  async function testConnection(config: ProxyConfig): Promise<ProxyCheckResult> {
    if (!native?.checkProxy) {
      return {ok: false, error: NO_CHECKER};
    }
    try {
      return await native.checkProxy(config);
    } catch (error) {
      return {ok: false, error: error instanceof Error ? error.message : String(error)};
    }
  }

  async function checkOnce(proxy: ArgusProxy) {
    if (!native?.checkProxy) {
      toast.setMessage(NO_CHECKER);
      return;
    }
    try {
      const checked = await runCheck(proxy);
      if (!await recordCheck(checked)) {
        return;
      }
      const label = proxy.name || proxy.host;
      toast.setMessage(checked.check_error ?
        `${label} check failed · ${checked.check_error}` :
        `${label} checked · ${checked.country || checked.country_code || checked.egress_ip || 'OK'} · ${checked.ping_ms}ms`);
    } catch (error) {
      toast.setMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async function save(draft: {
    id?: string;
    name: string;
    type: 'http' | 'socks5';
    host: string;
    port: number;
    username?: string;
    password?: string;
  }): Promise<ArgusProxy | null> {
    const existing = state.proxies.find((item) => item.id === draft.id);
    const connectionUnchanged = existing &&
      existing.type === draft.type &&
      existing.host === draft.host &&
      existing.port === draft.port &&
      (existing.username || '') === (draft.username || '') &&
      (existing.password || '') === (draft.password || '');
    const proxy: ArgusProxy = {
      // When the connection details changed, the six last_* columns are written
      // as explicit nulls by proxyToRow -- the stored check result no longer
      // describes this proxy, and the background loop will re-check it.
      ...(connectionUnchanged ? {
        country: existing.country,
        country_code: existing.country_code,
        egress_ip: existing.egress_ip,
        ping_ms: existing.ping_ms,
        checked_at: existing.checked_at,
        check_error: existing.check_error,
      } : {}),
      id: draft.id || newId(),
      name: draft.name || `${draft.host}:${draft.port}`,
      type: draft.type,
      host: draft.host,
      port: draft.port,
      username: draft.username || undefined,
      password: draft.password || undefined,
    };
    const isExisting = Boolean(draft.id) && state.proxies.some((item) => item.id === proxy.id);
    if (!await withDb((activeOrgId) => db.proxies.upsert(activeOrgId, proxy))) {
      return null;
    }
    patch.proxies((list) => isExisting ?
      list.map((item) => item.id === proxy.id ? proxy : item) :
      [...list, proxy]);
    return proxy;
  }

  async function create(proxy: ArgusProxy): Promise<boolean> {
    if (!await withDb((activeOrgId) => db.proxies.upsert(activeOrgId, proxy))) {
      return false;
    }
    patch.proxies((list) => [...list, proxy]);
    return true;
  }

  async function update(proxy: ArgusProxy): Promise<boolean> {
    if (!await withDb((activeOrgId) => db.proxies.upsert(activeOrgId, proxy))) {
      return false;
    }
    patch.proxies((list) => list.map((item) => item.id === proxy.id ? proxy : item));
    return true;
  }

  // The FK on profiles.proxy_id is ON DELETE SET NULL, so the assigned profiles
  // are cleared by the same statement; the local patch only mirrors it.
  async function remove(proxyIds: string[]): Promise<boolean> {
    if (!await withDb((activeOrgId) => db.proxies.remove(activeOrgId, proxyIds))) {
      return false;
    }
    patch.proxies((list) => list.filter((item) => !proxyIds.includes(item.id)));
    patch.profiles((list) => list.map((profile) =>
      profile.proxy_id && proxyIds.includes(profile.proxy_id) ?
        {...profile, proxy_id: null} :
        profile));
    return true;
  }

  async function exportToCsv(list: ArgusProxy[]) {
    if (!list.length) {
      return;
    }
    if (!native?.saveTextFile) {
      toast.setMessage('Native file export is not available. Restart Argus Launcher and try again.');
      return;
    }
    const header = ['name', 'type', 'host', 'port', 'username', 'password', 'country', 'country_code'];
    const csv = toCsv(header, list, (proxy) => {
      const row = proxy as unknown as Record<string, unknown>;
      return Object.fromEntries(header.map((key) => [key, String(row[key] ?? '')]));
    });
    const savedPath = await native.saveTextFile(`argys-proxies-${Date.now()}.csv`, csv);
    if (savedPath) {
      toast.setMessage(`Exported ${list.length} ${list.length === 1 ? 'proxy' : 'proxies'} to ${savedPath.split('/').pop()}`);
    }
  }

  return {recordCheck, runCheck, checkOnce, testConnection, save, create, update, remove, exportToCsv};
}
