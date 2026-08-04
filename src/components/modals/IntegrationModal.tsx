import {Check, Copy, TriangleAlert, X} from 'lucide-react';
import {Modal} from '../ui/Modal';
import {BusyButton} from '../ui/BusyButton';
import {IntegrationMark} from '../ui/icons';
import {MCP_TOOL_SUMMARY} from '../../data/integrations';
import {useWorkspace} from '../../workspace/WorkspaceProvider';
import type {Integration} from '../../data/integrations';
import type {ApiKeys, IntegrationsState} from '../../hooks/useApiKeys';
import type {ApiState} from '../../native';

// What a user has to paste for the two integrations that have no config file
// this app can write. Shown with the real token once, and with a placeholder
// before connecting, so the shape is visible either way.
function manualSnippet(token: string | undefined, base: string) {
  return JSON.stringify({
    mcpServers: {
      argus: {
        type: 'stdio',
        command: 'Argus Launcher',
        args: ['<the path shown after you connect>'],
        env: {
          ELECTRON_RUN_AS_NODE: '1',
          ARGYS_API_TOKEN: token || '<your key>',
          ARGYS_API_BASE: base,
        },
      },
    },
  }, null, 2);
}

export function IntegrationModal({integration, integrations, apiKeys, apiState}: {
  integration: Integration;
  integrations: IntegrationsState;
  apiKeys: ApiKeys;
  apiState: ApiState | null;
}) {
  const {data} = useWorkspace();
  const connectedKeys = apiKeys.keysFor(integration.id);
  const state = integrations.stateFor(integration);
  const connected = connectedKeys.length > 0;
  const config = integrations.configs[integration.id];
  const result = integrations.results[integration.id];
  const token = integrations.tokens[integration.id];
  const verification = integrations.verification;
  const busy = integrations.busyId === integration.id;
  const manual = integration.category === 'manual';
  const needsRepair = state === 'attention' && Boolean(config?.hasEntry) &&
    (config?.stale || !config?.commandExists || !config?.entryIsCurrent);
  const close = () => integrations.setOpenId('');

  return (
    <Modal
      className="small-modal integration-modal"
      onClose={close}
      header={
        <div className="integration-modal-title">
          <IntegrationMark integration={integration} size={22} />
          <div>
            <h2>{integration.name}</h2>
            <p>{integration.description}</p>
          </div>
        </div>
      }
      footer={connected ? (
        <>
          <button
            className="ghost danger"
            disabled={busy}
            onClick={() => void integrations.disconnect(integration)}
          >
            Disconnect
          </button>
          {needsRepair && (
            <BusyButton busy={busy} busyLabel="Repairing…"
              onClick={() => void integrations.repair(integration)}>
              Repair
            </BusyButton>
          )}
          <BusyButton busy={busy} busyLabel="Testing…" className="ghost"
            onClick={() => void integrations.test(integration)}>
            Test connection
          </BusyButton>
          <button onClick={close}>Done</button>
        </>
      ) : (
        <>
          <button className="ghost" disabled={busy} onClick={close}>Cancel</button>
          <BusyButton busy={busy} busyLabel="Connecting…"
            onClick={() => void integrations.connect(integration)}>
            Connect
          </BusyButton>
        </>
      )}
    >
      {!connected && (
        <section className="integration-steps">
          <h3>What connecting does</h3>
          <ol>
            <li>Creates an API key scoped to the folders you pick.</li>
            <li>
              {manual ?
                `Shows you the key to paste into ${integration.configLabel} — there is no config file here for Argus to write.` :
                `Writes an "argus" MCP server into ${integration.configLabel}, pointing at the server bundled in this app. Nothing to install.`}
            </li>
            <li>{integration.restartLabel}. Your profiles show up as tools.</li>
          </ol>
        </section>
      )}

      <section className="integration-steps">
        <h3>Tools it gets</h3>
        <ul className="integration-tools">
          {MCP_TOOL_SUMMARY.map((line) => <li key={line}>{line}</li>)}
        </ul>
      </section>

      {!connected && (
        <label className="field">
          <span>Grant access to</span>
          <select
            value={integrations.scope}
            onChange={(event) => integrations.setScope(event.target.value)}
          >
            <option value="">All folders</option>
            {data.state.folders.map((folder) => (
              <option key={folder.id} value={folder.id}>{folder.name}</option>
            ))}
          </select>
          <span className="field-hint">
            A scoped key can only see and launch profiles in that folder.
          </span>
        </label>
      )}

      <div className="integration-facts">
        <div>
          <span>{manual ? 'Paste into' : 'Writes to'}</span>
          <code>{config?.configPath || integration.configLabel}</code>
        </div>
        <div>
          <span>Local API</span>
          <code>
            {apiState?.url || 'http://127.0.0.1:39219'} ({apiState?.status || 'unknown'})
          </code>
        </div>
        {connected && (
          <div>
            <span>Key</span>
            <code>
              &middot;{connectedKeys[0].tokenPreview} &middot;{' '}
              {apiKeys.describeScope(connectedKeys[0], data.state.folders)}
            </code>
          </div>
        )}
      </div>

      {needsRepair && (
        <p className="apply-status-error">
          <TriangleAlert size={14} /> This connection points at a server that is not
          installed. Repair rewrites it to use the one bundled in this app, keeping
          your existing key.
        </p>
      )}

      {result && (
        <p className={result.ok ? 'apply-status-ok' : 'apply-status-error'}>{result.message}</p>
      )}

      {/* Per-check rather than one verdict: "not ready" tells a user nothing
          about which of five independent things to go and fix. */}
      {verification && (
        <ul className="integration-checks">
          {verification.checks.map((check) => (
            <li key={check.id} className={check.ok ? 'is-ok' : 'is-bad'}>
              {check.ok ? <Check size={14} /> : <X size={14} />}
              <div>
                <strong>{check.label}</strong>
                {check.detail && <span>{check.detail}</span>}
              </div>
            </li>
          ))}
        </ul>
      )}

      {manual && <CopyableSecret value={token || manualSnippet(token, apiState?.url || '')} />}
      {!manual && token && <CopyableSecret value={token} />}
    </Modal>
  );
}

// A one-time secret with a copy button. Shared by the manual-integration token
// above and the newly created key dialog, so both present a raw key the same way.
export function CopyableSecret({value}: {value: string}) {
  return (
    <div className="snippet-block">
      <button
        className="snippet-copy"
        onClick={() => { void navigator.clipboard.writeText(value); }}
        title="Copy to clipboard"
      >
        <Copy size={14} /> Copy
      </button>
      <pre>{value}</pre>
    </div>
  );
}
