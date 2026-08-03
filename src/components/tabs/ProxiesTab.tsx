import {useState} from 'react';
import {Download, ExternalLink, Pencil, Plus, Trash2, Waypoints, X} from 'lucide-react';
import {FlagIcon} from '../ui/icons';
import {PaginationBar} from '../ui/PaginationBar';
import {isProxyAssigned} from '../../lib/proxies';
import {paginate} from '../../lib/paginate';
import {SITE_URL} from '../../lib/auth';
import {PROXY_PROVIDERS, providerPath} from '../../data/proxyProviders';
import {native} from '../../native';
import {useSelection} from '../../hooks/useSelection';
import {useWorkspace} from '../../workspace/WorkspaceProvider';
import type {ArgusProxy} from '../../types';

export type ProxiesTabProps = {
  onAddProxy: () => void;
  onEditProxy: (proxy: ArgusProxy) => void;
  onRequestDelete: (proxyIds: string[], label: string, onDeleted?: () => void) => void;
};

export function ProxiesTab({onAddProxy, onEditProxy, onRequestDelete}: ProxiesTabProps) {
  const {data, proxies, checkingProxyId} = useWorkspace();
  const state = data.state;
  const selection = useSelection<ArgusProxy>();

  const [search, setSearch] = useState('');
  const [assignedFilter, setAssignedFilter] = useState<'' | 'assigned' | 'unassigned'>('');
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);

  const assigned = (proxy: ArgusProxy) => isProxyAssigned(proxy, state.profiles);
  const visible = visibleProxies(state.proxies, {search, assignedFilter, assigned});
  const {items, page: clampedPage, totalPages, total} = paginate(visible, page, pageSize);

  // Owning no proxies at all is a different situation from having filtered them
  // all away, and it gets the whole tab. The toolbar and the pager are dropped
  // rather than disabled: a search box and a page selector over zero rows are
  // the loudest thing on a screen whose real job is to explain what a proxy is
  // for and where to get one.
  if (state.proxies.length === 0) {
    return <ProxiesEmptyState onAddProxy={onAddProxy} />;
  }

  return (
    <>
      <section className="table-toolbar">
        <label className="check-field">
          <input
            type="checkbox"
            checked={selection.allSelected(visible)}
            onChange={() => selection.toggleAll(visible)}
          />
          <span>{selection.size > 0 ? `${selection.size} selected` : 'Select all'}</span>
        </label>
        <input
          type="text"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search proxies by name, host, or country"
        />
        <select
          value={assignedFilter}
          onChange={(event) => setAssignedFilter(event.target.value as '' | 'assigned' | 'unassigned')}
        >
          <option value="">All proxies</option>
          <option value="assigned">Assigned to a profile</option>
          <option value="unassigned">Not assigned</option>
        </select>
        {visible.length > 0 && (
          <button className="ghost" onClick={() => void proxies.exportToCsv(visible)}>
            <Download size={16} /> Export all
          </button>
        )}
      </section>

      {selection.size > 0 && (
        <section className="selection-toolbar">
          <div className="selection-toolbar-actions">
            <button
              className="ghost"
              onClick={() => void proxies.exportToCsv(selection.selectedFrom(state.proxies))}
            >
              <Download size={16} /> Export selected
            </button>
            <button
              className="danger ghost"
              onClick={() => onRequestDelete(
                  [...selection.ids],
                  `${selection.size} selected ${selection.size === 1 ? 'proxy' : 'proxies'}`,
                  selection.clear)}
            >
              <Trash2 size={16} /> Delete selected
            </button>
          </div>
        </section>
      )}

      <section className="card-grid">
        {items.map((proxy) => (
          <article
            className={selection.has(proxy.id) ? 'data-card proxy-card selected' : 'data-card proxy-card'}
            key={proxy.id}
          >
            <label className="card-select" onClick={(event) => event.stopPropagation()}>
              <input
                type="checkbox"
                checked={selection.has(proxy.id)}
                onChange={() => selection.toggle(proxy.id)}
              />
            </label>
            <div className="proxy-card-main">
              <div className="proxy-title-row">
                <span className="proxy-flag" title={proxy.country || proxy.country_code || 'Unchecked'}>
                  <FlagIcon countryCode={proxy.country_code} />
                </span>
                <h2>{proxy.name || proxy.host}</h2>
              </div>
              <p>{proxy.type || 'http'} · {proxy.host}:{proxy.port}</p>
              <p>{describeLastCheck(proxy)}</p>
              <p>
                <span className={assigned(proxy) ? 'proxy-badge assigned' : 'proxy-badge unassigned'}>
                  {assigned(proxy) ? 'Assigned' : 'Not assigned'}
                </span>
              </p>
            </div>
            <div className="data-card-actions">
              {checkingProxyId === proxy.id && <span className="proxy-status">Checking...</span>}
              <button
                className="icon-button"
                aria-label={`Edit ${proxy.name || proxy.host}`}
                onClick={() => onEditProxy(proxy)}
              >
                <Pencil size={16} />
              </button>
            </div>
          </article>
        ))}
        {/* Past the early return above there is at least one proxy, so an empty
          * grid here is always the search or the assignment filter. */}
        {items.length === 0 && (
          <p className="empty-state">
            {search.trim() ?
              'No proxies match your search.' :
              'No proxies match this filter.'}
          </p>
        )}
      </section>

      <PaginationBar
        page={clampedPage}
        totalPages={totalPages}
        total={total}
        pageSize={pageSize}
        onPage={setPage}
        onPageSize={(size) => { setPageSize(size); setPage(0); }}
      />
    </>
  );
}

// Dismissal is a per-device UI preference, not workspace data, so it lives in
// localStorage the same way the theme choice does -- read once on mount, written
// on change. A user who has their own provider should not have to re-close this
// on every visit.
const PROVIDERS_DISMISSED_KEY = 'argus.proxy-providers-dismissed';

function readProvidersDismissed() {
  try {
    return window.localStorage.getItem(PROVIDERS_DISMISSED_KEY) === '1';
  } catch {
    return false;
  }
}

function ProxiesEmptyState({onAddProxy}: {onAddProxy: () => void}) {
  const [dismissed, setDismissed] = useState(readProvidersDismissed);

  function setProvidersDismissed(next: boolean) {
    setDismissed(next);
    try {
      if (next) {
        window.localStorage.setItem(PROVIDERS_DISMISSED_KEY, '1');
      } else {
        window.localStorage.removeItem(PROVIDERS_DISMISSED_KEY);
      }
    } catch {
      // Private-mode or a wiped profile dir: the preference is not worth
      // failing the render over, it just will not survive a restart.
    }
  }

  return (
    <section className="tab-empty">
      <span className="tab-empty-mark">
        <Waypoints size={26} strokeWidth={1.5} />
      </span>
      <h2>No proxies yet</h2>
      <p>
        A profile needs a proxy before it can launch. Add one you already own,
        or pick up traffic from a provider below.
      </p>
      <button onClick={onAddProxy}><Plus size={18} /> Add proxy</button>

      {dismissed ? (
        <button className="link-button" onClick={() => setProvidersDismissed(false)}>
          Show proxy providers
        </button>
      ) : (
        <ProviderStrip onDismiss={() => setProvidersDismissed(true)} />
      )}
    </section>
  );
}

// Every link goes to our own /go redirect rather than the provider directly:
// the main process only opens hosts we own, and it keeps the destination
// editable on the site. See providerPath in data/proxyProviders.
function ProviderStrip({onDismiss}: {onDismiss: () => void}) {
  return (
    <section className="provider-strip">
      <div className="provider-strip-head">
        <h3>Where to buy</h3>
        <button className="icon-button" aria-label="Hide proxy providers" onClick={onDismiss}>
          <X size={16} />
        </button>
      </div>
      <div className="provider-grid">
        {PROXY_PROVIDERS.map((provider) => {
          const Icon = provider.icon;
          const mark = provider.logo ?
            <img
              alt=""
              className={provider.invertOn ?
                `integration-logo invert-on-${provider.invertOn}` :
                'integration-logo'}
              src={provider.logo}
            /> :
            <Icon size={20} />;
          return (
            <article className="provider-card" key={provider.slug}>
              <div className="provider-card-head">
                {mark}
                <h4>{provider.name}</h4>
              </div>
              <p className="provider-kinds">{provider.kinds}</p>
              <p>{provider.blurb}</p>
              <button
                className="ghost"
                onClick={() => void native?.openExternal?.(`${SITE_URL}${providerPath(provider.slug)}`)}
              >
                Visit <ExternalLink size={14} />
              </button>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function describeLastCheck(proxy: ArgusProxy) {
  if (!proxy.checked_at) {
    return 'Country not checked';
  }
  if (proxy.check_error) {
    return `Check failed · ${proxy.check_error}`;
  }
  const where = proxy.country || proxy.country_code || 'Unknown';
  return `${where} · ${proxy.egress_ip || 'No IP'} · ${proxy.ping_ms || 0}ms cached`;
}

function visibleProxies(
    allProxies: ArgusProxy[],
    {search, assignedFilter, assigned}: {
      search: string;
      assignedFilter: '' | 'assigned' | 'unassigned';
      assigned: (proxy: ArgusProxy) => boolean;
    }) {
  const byAssignment = assignedFilter ?
    allProxies.filter((proxy) => assigned(proxy) === (assignedFilter === 'assigned')) :
    allProxies;
  const query = search.trim().toLowerCase();
  if (!query) {
    return byAssignment;
  }
  return byAssignment.filter((proxy) =>
    [proxy.name, proxy.host, proxy.country, proxy.country_code, proxy.type]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(query));
}
