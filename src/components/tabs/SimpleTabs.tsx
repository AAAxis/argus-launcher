// The tabs that are a list and nothing else. Kept together because each is
// small enough that a file per tab would be more navigation than content.
//
// The Cookies tab used to live here. It grew folders, tags, a Trash and an
// editable payload, and moved to CookiesTab.tsx. Bookmarks followed: it grew a
// search box and a tile grid, and is now StartPageTab.tsx. Extensions was the
// third: it grew a card grid and a Discover catalog, and is now
// ExtensionsTab.tsx. Integrations is what is left.
import {Plug} from 'lucide-react';
import {IntegrationMark} from '../ui/icons';
import {INTEGRATIONS} from '../../data/integrations';
import type {Integration} from '../../data/integrations';
import type {ApiKeys} from '../../hooks/useApiKeys';

export function IntegrationsTab({apiKeys, onOpen}: {
  apiKeys: ApiKeys;
  onOpen: (integration: Integration) => void;
}) {
  return (
    <section className="api-panel">
      <section className="api-note">
        <Plug size={18} />
        <span>
          Connecting drives your profiles as MCP tools -- launch, navigate,
          read, screenshot, close. Each card shows exactly which config file
          it will write and lets you narrow the key to one folder before
          anything is created.
        </span>
      </section>

      <section className="integration-grid">
        {INTEGRATIONS.map((integration) => {
          const connected = apiKeys.keysFor(integration.id).length > 0;
          return (
            <div className="integration-card" key={integration.id}>
              <div className="integration-card-head">
                <IntegrationMark integration={integration} />
                <h2>{integration.name}</h2>
              </div>
              <p>{integration.description}</p>
              {connected ?
                <span className="status-pill"><span className="status-dot" />Connected</span> :
                <span className="status-pill is-idle">Not connected</span>}
              <button className={connected ? 'ghost' : ''} onClick={() => onOpen(integration)}>
                {connected ? 'Manage' : 'Connect'}
              </button>
            </div>
          );
        })}
      </section>
    </section>
  );
}
