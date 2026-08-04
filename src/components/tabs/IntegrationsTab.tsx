// The Integrations tab: which agent tools can drive this account's profiles.
//
// Moved out of SimpleTabs.tsx, which was down to this one occupant and whose
// header comment already recorded that the other tabs left as they grew. This
// one grew: sections, search, per-card status with a reason, and a Connect that
// happens on the card.
//
// The central rule here is that a card never claims more than has been checked.
// "A key exists" used to be enough to print Connected, which it is not: the
// wiring lives in a file another tool can edit, and it can point at something
// that no longer exists. `integrations.stateFor` is the only thing that decides.
import {useEffect, useMemo, useState} from 'react';
import {Plug, Search, TriangleAlert} from 'lucide-react';
import {BusyButton} from '../ui/BusyButton';
import {IntegrationMark} from '../ui/icons';
import {CATEGORY_LABELS, CATEGORY_ORDER, INTEGRATIONS} from '../../data/integrations';
import {useWorkspace} from '../../workspace/WorkspaceProvider';
import type {Integration, IntegrationId} from '../../data/integrations';
import type {ApiKeys, IntegrationsState} from '../../hooks/useApiKeys';

const ALL_IDS = INTEGRATIONS.map((integration) => integration.id);

// "2 minutes ago" beats a date here: the question a user has is "is this thing
// actually being used", and a timestamp from today reads as noise.
function sinceLabel(iso: string | null): string {
  if (!iso) {
    return '';
  }
  const seconds = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 90) {
    return 'used just now';
  }
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) {
    return `used ${minutes}m ago`;
  }
  const hours = Math.round(minutes / 60);
  if (hours < 24) {
    return `used ${hours}h ago`;
  }
  return `used ${new Date(iso).toLocaleDateString()}`;
}

function IntegrationCard({integration, apiKeys, integrations, onOpen}: {
  integration: Integration;
  apiKeys: ApiKeys;
  integrations: IntegrationsState;
  onOpen: (integration: Integration) => void;
}) {
  const {data} = useWorkspace();
  const state = integrations.stateFor(integration);
  const reason = integrations.reasonFor(integration);
  const config = integrations.configs[integration.id];
  const busy = integrations.busyId === integration.id;
  const key = apiKeys.keysFor(integration.id)[0];
  const needsRepair = state === 'attention' && Boolean(config?.hasEntry) &&
    (config?.stale || !config?.commandExists || !config?.entryIsCurrent);

  return (
    <div className={`integration-card is-${state}`}>
      <div className="integration-card-head">
        <IntegrationMark integration={integration} />
        <h2>{integration.name}</h2>
        {state === 'connected' && <span className="status-pill"><span className="status-dot" />Connected</span>}
        {state === 'attention' && (
          <span className="status-pill is-warn"><TriangleAlert size={12} />Needs attention</span>
        )}
      </div>
      <p>{integration.description}</p>

      <div className="integration-card-meta">
        {state === 'connected' && key ? (
          <span>
            {`key ·${key.tokenPreview} · ${apiKeys.describeScope(key, data.state.folders)}`}
            {key.lastUsedAt ? ` · ${sinceLabel(key.lastUsedAt)}` : ''}
          </span>
        ) : <span>{reason}</span>}
      </div>

      <div className="integration-card-actions">
        {needsRepair && (
          <BusyButton
            busy={busy}
            busyLabel="Repairing…"
            onClick={() => void integrations.repair(integration)}
          >
            Repair
          </BusyButton>
        )}
        {state === 'idle' ? (
          <BusyButton
            busy={busy}
            busyLabel="Connecting…"
            className={needsRepair ? 'ghost' : ''}
            onClick={() => void integrations.connect(integration)}
          >
            Connect
          </BusyButton>
        ) : (
          <button className="ghost" onClick={() => onOpen(integration)}>Manage</button>
        )}
      </div>
    </div>
  );
}

export function IntegrationsTab({apiKeys, integrations, onOpen}: {
  apiKeys: ApiKeys;
  integrations: IntegrationsState;
  onOpen: (integration: Integration) => void;
}) {
  const [query, setQuery] = useState('');
  const {refreshAll} = integrations;

  // Read every tool's real state on arrival. Without this the tab shows
  // whatever the key store implies until a dialog is opened, which is exactly
  // the stale picture this rebuild exists to remove.
  useEffect(() => {
    void refreshAll(ALL_IDS as IntegrationId[]);
  }, [refreshAll]);

  const matched = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) {
      return INTEGRATIONS;
    }
    return INTEGRATIONS.filter((integration) =>
      integration.name.toLowerCase().includes(needle) ||
      integration.description.toLowerCase().includes(needle));
  }, [query]);

  const apiState = integrations.apiState;
  const apiReady = apiState?.status === 'ready';

  return (
    <section className="api-panel">
      <section className="integration-bar">
        <span className={apiReady ? 'status-pill' : 'status-pill is-warn'}>
          <span className="status-dot" />
          {apiReady ? 'Local API ready' : `Local API ${apiState?.status || 'not running'}`}
        </span>
        <code>{apiState?.url || 'http://127.0.0.1:39219'}</code>
        <label className="integration-search">
          <Search size={15} />
          <input
            placeholder="Search integrations"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
      </section>

      <section className="api-note">
        <Plug size={18} />
        <span>
          Connecting lets a tool drive your profiles: launch, navigate, read,
          screenshot, close. The MCP server ships inside this app, so there is
          nothing to install — each card shows the file it writes and lets you
          narrow the key to one folder first.
        </span>
      </section>

      {CATEGORY_ORDER.map((category) => {
        const inCategory = matched.filter((integration) => integration.category === category);
        if (!inCategory.length) {
          return null;
        }
        return (
          <section className="integration-section" key={category}>
            <h3>{CATEGORY_LABELS[category]}</h3>
            <div className="integration-grid">
              {inCategory.map((integration) => (
                <IntegrationCard
                  key={integration.id}
                  integration={integration}
                  apiKeys={apiKeys}
                  integrations={integrations}
                  onOpen={onOpen}
                />
              ))}
            </div>
          </section>
        );
      })}

      {!matched.length && <p className="empty-state">No integration matches “{query}”.</p>}
    </section>
  );
}
