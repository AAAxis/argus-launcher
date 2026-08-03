// The four tabs that are a list and nothing else. Kept together because each
// is small enough that a file per tab would be more navigation than content.
import {ExternalLink, Pencil, Plug, Plus, Trash2} from 'lucide-react';
import {BookmarkFavicon} from '../ui/BookmarkFavicon';
import {IntegrationMark} from '../ui/icons';
import {BUILT_IN_EXTENSIONS} from '../../data/statuses';
import {INTEGRATIONS} from '../../data/integrations';
import {displayBookmarkUrl, normalizeBookmarkUrl} from '../../lib/bookmarks';
import {useOrg} from '../../org';
import {useWorkspace} from '../../workspace/WorkspaceProvider';
import type {Integration} from '../../data/integrations';
import type {ApiKeys} from '../../hooks/useApiKeys';
import type {BuiltInExtensionToggles, SharedBookmark} from '../../types';

export function CookiesTab() {
  const {data, library, toast} = useWorkspace();

  async function remove(id: string) {
    const cookie = data.state.cookies.find((item) => item.id === id);
    if (await library.removeCookieSet(id)) {
      toast.setMessage(cookie ? `Deleted "${cookie.name}"` : 'Cookie-set deleted');
    }
  }

  return (
    <section className="panel">
      <div className="panel-title">
        <h2>Saved cookie-sets</h2>
      </div>
      <p>Shared cookie-set library. Assign one to a profile from its Cookie import section.</p>
      {data.state.cookies.length === 0 && <p className="empty-state">No saved cookie-sets yet.</p>}
      {data.state.cookies.map((cookie) => (
        <div className="extension-row" key={cookie.id}>
          <span>{cookie.name}</span>
          <small>{cookie.count ? `${cookie.count} cookies` : ''}</small>
          <button onClick={() => void remove(cookie.id)}><Trash2 size={16} /></button>
        </div>
      ))}
    </section>
  );
}

export function BookmarksTab({onEditBookmark}: {onEditBookmark: (bookmark: SharedBookmark) => void}) {
  const {data} = useWorkspace();
  return (
    <section className="card-grid">
      {data.state.shared_bookmarks.map((bookmark) => {
        const url = normalizeBookmarkUrl(bookmark.url);
        const label = bookmark.title || url;
        return (
          <article className="data-card bookmark-card" key={`${bookmark.title}-${bookmark.url}`}>
            <BookmarkFavicon bookmark={bookmark} />
            <h2 title={label}>{label}</h2>
            <div className="data-card-actions bookmark-card-actions">
              <button
                className="icon-button"
                aria-label={`Open ${label}`}
                title="Open"
                onClick={() => window.open(url, '_blank')}
              >
                <ExternalLink size={15} />
              </button>
              <button
                className="icon-button"
                aria-label={`Edit ${label}`}
                title="Edit"
                onClick={() => onEditBookmark(bookmark)}
              >
                <Pencil size={15} />
              </button>
            </div>
            <p title={url}>{displayBookmarkUrl(bookmark.url)}</p>
          </article>
        );
      })}
      {data.state.shared_bookmarks.length === 0 &&
        <p className="empty-state">No shared bookmarks loaded.</p>}
    </section>
  );
}

export function ExtensionsTab({onAddExtension}: {onAddExtension: () => void}) {
  const org = useOrg();
  const {data, library} = useWorkspace();
  // Undefined/missing means enabled, for cloud state saved before this toggle
  // existed.
  const enabled = (key: keyof BuiltInExtensionToggles) =>
    data.state.built_in_extensions?.[key] !== false;

  return (
    <section className="panel">
      <div className="panel-title">
        <h2>Built-in extensions</h2>
      </div>
      {!org.isAdmin && org.orgId && (
        <p className="empty-state">
          These apply to everyone in {org.org?.name || 'this organization'}, so only an owner
          or admin can change them.
        </p>
      )}
      {BUILT_IN_EXTENSIONS.map((entry) => (
        <div className="extension-row" key={entry.key}>
          <span>{entry.name}</span>
          <small>{entry.description}</small>
          <label
            className="switch"
            aria-label={`${enabled(entry.key) ? 'Disable' : 'Enable'} ${entry.name}`}
          >
            <input
              type="checkbox"
              checked={enabled(entry.key)}
              disabled={!org.isAdmin}
              onChange={(event) =>
                void library.setBuiltInExtensionEnabled(entry.key, event.target.checked)}
            />
            <span className="switch-track"><span className="switch-thumb" /></span>
          </label>
        </div>
      ))}

      <div className="panel-subsection">
        <div className="panel-title">
          <h2>Shared extensions</h2>
          <button onClick={onAddExtension}><Plus size={16} /> Add</button>
        </div>
        {data.state.shared_extensions.map((extension) => (
          <div className="extension-row" key={extension.id}>
            <span>{extension.name || extension.id}</span>
            <small>{extension.source === 'webstore' ? 'Chrome Web Store' : 'Shared folder'}</small>
            <button onClick={() => void library.removeExtension(extension.id)}>
              <Trash2 size={16} />
            </button>
          </div>
        ))}
        {data.state.shared_extensions.length === 0 &&
          <p className="empty-state">No shared extensions loaded.</p>}
      </div>
    </section>
  );
}

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
