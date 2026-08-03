import {Copy, FolderOpen} from 'lucide-react';
import {Modal} from '../ui/Modal';
import {IntegrationMark} from '../ui/icons';
import {API_BASE_URL} from '../../data/apiDocs';
import {useWorkspace} from '../../workspace/WorkspaceProvider';
import type {Integration} from '../../data/integrations';
import type {ApiKeys, IntegrationsState} from '../../hooks/useApiKeys';
import type {ApiState} from '../../native';

// The picker is the OS's own, so name it the way the OS does rather than
// saying "Browse" and leaving the user to guess what opens.
function browseLabel() {
  return navigator.platform.includes('Win') ? 'Choose in File Explorer' : 'Choose in Finder';
}

export function IntegrationModal({integration, integrations, apiKeys, apiState}: {
  integration: Integration;
  integrations: IntegrationsState;
  apiKeys: ApiKeys;
  apiState: ApiState | null;
}) {
  const {data} = useWorkspace();
  const connectedKeys = apiKeys.keysFor(integration.id);
  const connected = connectedKeys.length > 0;
  const config = integrations.configs[integration.id];
  const result = integrations.results[integration.id];
  const token = integrations.tokens[integration.id];
  const busy = integrations.busyId === integration.id;
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
          <button className="ghost" disabled={busy} onClick={() => void integrations.test(integration)}>
            Test connection
          </button>
          <button onClick={close}>Done</button>
        </>
      ) : (
        <>
          <button className="ghost" disabled={busy} onClick={close}>Cancel</button>
          <button disabled={busy} onClick={() => void integrations.connect(integration)}>
            {busy ? 'Connecting…' : 'Connect'}
          </button>
        </>
      )}
    >
      <section className="integration-steps">
        <h3>How it works</h3>
        <ol>
          {integration.steps.map((step) => <li key={step}>{step}</li>)}
        </ol>
      </section>

      {!connected && (
        <>
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
          </label>
          <label className="field">
            <span>Bridge folder</span>
            <div className="path-picker">
              <input
                type="text"
                value={integrations.bridgePath}
                spellCheck={false}
                placeholder="Path to your argus-hive-bridge checkout"
                onChange={(event) => integrations.setBridgePath(event.target.value)}
              />
              <button
                className="ghost"
                title={browseLabel()}
                onClick={() => void integrations.pickBridgeFolder()}
              >
                <FolderOpen size={15} /> Browse
              </button>
            </div>
          </label>
        </>
      )}

      <div className="integration-facts">
        <div>
          <span>Writes to</span>
          <code>{config?.configPath || integration.configLabel}</code>
        </div>
        <div>
          <span>Local API</span>
          <code>{API_BASE_URL} ({apiState?.status || 'unknown'})</code>
        </div>
        {connected && (
          <div>
            <span>Key</span>
            <code>
              ...{connectedKeys[0].tokenPreview} &middot;{' '}
              {apiKeys.describeScope(connectedKeys[0], data.state.folders)}
            </code>
          </div>
        )}
      </div>

      {result && (
        <p className={result.ok ? 'apply-status-ok' : 'apply-status-error'}>{result.message}</p>
      )}
      {integrations.testResult && (
        <p className={integrations.testResult.ok ? 'apply-status-ok' : 'apply-status-error'}>
          {integrations.testResult.message}
        </p>
      )}

      {token && <CopyableSecret value={token} />}
    </Modal>
  );
}

// A one-time secret with a copy button. Shared by the Hive token above and the
// newly created key dialog, so both present a raw key the same way.
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
