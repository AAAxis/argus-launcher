// Local automation API keys, and the integrations that create them.
//
// The key store is per-install -- one automation-keys.json shared by every
// account that has ever signed in on this machine -- so the list has to be
// filtered by the signed-in user. It used to be loaded once at mount and never
// cleared, which is why signing in as a new account still showed the previous
// one's keys, and with them its integrations as Connected.
import {useCallback, useEffect, useState} from 'react';
import {API_BASE_URL} from '../data/apiDocs';
import {native} from '../native';
import type {ApiKey, ApiState, IntegrationStatus} from '../native';
import type {Integration, IntegrationId} from '../data/integrations';
import type {ArgusFolder} from '../types';

export type ApiKeys = ReturnType<typeof useApiKeys>;

export function useApiKeys(userId: string | null, orgId: string | null) {
  const [keys, setKeys] = useState<ApiKey[]>([]);

  const refresh = useCallback(async () => {
    const listed = await native?.listApiKeys?.(userId);
    setKeys(listed || []);
  }, [userId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Empty string means "no folder chosen", which is full access -- the same
  // thing a null folderScope means to the main process. A one-element array is
  // an explicit single-folder grant.
  function scopeFromSelection(folderId: string) {
    return folderId ? [folderId] : null;
  }

  async function create(name: string, folderId: string) {
    if (!native?.createApiKey) {
      return null;
    }
    const created = await native.createApiKey(name || 'Unnamed key', scopeFromSelection(folderId));
    await refresh();
    return created;
  }

  async function revoke(id: string) {
    await native?.revokeApiKey?.(id);
    await refresh();
  }

  // A key belongs to an integration only if the connect flow stamped it with
  // that integration's id. This used to compare key.name against the display
  // name, which meant any key ever created on this machine called "Claude Code"
  // -- by a previous account, by hand on the API tab, or by an OAuth client
  // that chose its own key name -- made the card read Connected.
  function keysFor(integrationId: IntegrationId) {
    return keys.filter((key) => key.integrationId === integrationId);
  }

  function describeScope(key: ApiKey, folders: ArgusFolder[]) {
    if (!key.folderScope) {
      return 'All folders';
    }
    return key.folderScope
        .map((id) => folders.find((folder) => folder.id === id)?.name || id)
        .join(', ') || 'No folders';
  }

  return {
    keys,
    setKeys,
    refresh,
    create,
    revoke,
    keysFor,
    describeScope,
    scopeFromSelection,
    userId,
    orgId,
  };
}

export type IntegrationsState = ReturnType<typeof useIntegrations>;

export function useIntegrations(apiKeys: ApiKeys, apiState: ApiState | null) {
  // Which integration's dialog is open, '' for none.
  const [openId, setOpenId] = useState<IntegrationId | ''>('');
  const [scope, setScope] = useState('');
  const [busyId, setBusyId] = useState<IntegrationId | ''>('');
  const [results, setResults] = useState<Partial<Record<IntegrationId, {ok: boolean; message: string}>>>({});
  const [tokens, setTokens] = useState<Partial<Record<IntegrationId, string>>>({});
  const [testResult, setTestResult] = useState<{ok: boolean; message: string} | null>(null);
  // What each tool's config file says right now, as opposed to what this app's
  // key store says. Filled by refreshStatus.
  const [configs, setConfigs] = useState<Partial<Record<IntegrationId, IntegrationStatus>>>({});
  // Where argus-hive-bridge lives. Was a hardcoded Windows path
  // (C:\Users\dima\argus-hive-bridge) that could not be right on any other
  // machine; now seeded from the main process and overridable in the dialog.
  const [bridgePath, setBridgePath] = useState('');

  useEffect(() => {
    void native?.defaultBridgePath?.().then((resolved) => {
      if (resolved) {
        setBridgePath(resolved);
      }
    });
  }, []);

  async function refreshStatus(integrationId: IntegrationId) {
    if (!native?.integrationStatus) {
      return null;
    }
    const status = await native.integrationStatus(integrationId, bridgePath || null);
    setConfigs((prev) => ({...prev, [integrationId]: status}));
    return status;
  }

  function open(integration: Integration) {
    setOpenId(integration.id);
    setScope('');
    setTestResult(null);
    void refreshStatus(integration.id);
  }

  // Creates the key and writes the target tool's config in one step, but only
  // after the dialog has shown which file it will touch and let the user narrow
  // the folder scope. Hive gets the raw token revealed instead, since it has no
  // config file of its own for Anty to write.
  async function connect(integration: Integration) {
    if (!native?.createApiKey) {
      return;
    }
    setBusyId(integration.id);
    try {
      const created = await native.createApiKey(
          integration.name,
          apiKeys.scopeFromSelection(scope),
          {ownerUserId: apiKeys.userId, orgId: apiKeys.orgId, integrationId: integration.id},
      );
      await apiKeys.refresh();
      if (integration.id === 'hive') {
        setTokens((prev) => ({...prev, [integration.id]: created.token}));
        setResults((prev) => ({
          ...prev,
          [integration.id]: {
            ok: true,
            message: 'Copy this into argus-hive-bridge/.env as ARGYS_API_TOKEN -- shown once.',
          },
        }));
        return;
      }
      if (!native.applyIntegrationConfig) {
        return;
      }
      const result = await native.applyIntegrationConfig(
          integration.id, bridgePath, created.token, API_BASE_URL);
      setResults((prev) => ({
        ...prev,
        [integration.id]: result.ok ?
          {ok: true, message: `Wrote ${result.path} -- restart ${integration.name} to use it.`} :
          {ok: false, message: result.error || 'Failed to write config'},
      }));
      await refreshStatus(integration.id);
    } finally {
      setBusyId('');
    }
  }

  // Both halves, in the order that cannot strand the user: config first, then
  // the key. Revoking first would leave the tool pointed at a dead token if the
  // config write then failed.
  async function disconnect(integration: Integration) {
    setBusyId(integration.id);
    try {
      await native?.removeIntegrationConfig?.(integration.id);
      for (const key of apiKeys.keysFor(integration.id)) {
        await native?.revokeApiKey?.(key.id);
      }
      await apiKeys.refresh();
      await refreshStatus(integration.id);
      setTokens((prev) => ({...prev, [integration.id]: ''}));
      setResults((prev) => ({
        ...prev,
        [integration.id]: {
          ok: true,
          message: 'Disconnected. The key is revoked and the config entry removed.',
        },
      }));
    } finally {
      setBusyId('');
    }
  }

  // Checks the three things that can independently be wrong: the local API is
  // up, the config still carries our entry, and the bridge's interpreter is
  // actually where the config says it is.
  async function test(integration: Integration) {
    setBusyId(integration.id);
    setTestResult(null);
    try {
      const status = await refreshStatus(integration.id);
      const problems: string[] = [];
      if (apiState?.status !== 'ready') {
        problems.push(`the local API is ${apiState?.status || 'not running'}`);
      }
      if (integration.id !== 'hive' && status && !status.hasEntry) {
        problems.push(`${integration.configLabel} has no argus entry`);
      }
      if (status && !status.bridgeExists) {
        problems.push(`no bridge checkout at ${bridgePath}`);
      } else if (status && !status.pythonExists) {
        problems.push(`no interpreter at ${status.pythonPath} -- create the venv first`);
      }
      setTestResult(problems.length === 0 ?
        {ok: true, message: 'All checks passed.'} :
        {ok: false, message: `Not ready: ${problems.join('; ')}.`});
    } finally {
      setBusyId('');
    }
  }

  // Opens the native directory chooser in the main process (Finder on macOS,
  // File Explorer on Windows), seeded with whatever is in the field.
  async function pickBridgeFolder() {
    const picked = await native?.selectBridgeFolder?.(bridgePath || null);
    if (picked) {
      setBridgePath(picked);
    }
  }

  // Everything the outgoing account established, dropped on sign-out so the
  // Integrations tab can never show their connections during the gap.
  function reset() {
    setResults({});
    setTokens({});
    setConfigs({});
    setOpenId('');
  }

  return {
    openId, setOpenId,
    scope, setScope,
    busyId, results, tokens, testResult, configs,
    bridgePath, setBridgePath, pickBridgeFolder,
    open, connect, disconnect, test, reset,
  };
}
