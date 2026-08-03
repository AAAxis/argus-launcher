// The persistent chrome: the sidebar rail, the topbar, and the corner toasts.
import {Settings, X} from 'lucide-react';
import {tabs} from '../data/tabs';
import {initials, shortenEmail} from '../lib/text';
import {native} from '../native';
import {useOrg} from '../org';
import type {ReactNode} from 'react';
import type {TabId} from '../data/tabs';
import type {UpdateState} from '../native';

export function Sidebar({activeTab, onTab, onSettings}: {
  activeTab: TabId;
  onTab: (tab: TabId) => void;
  onSettings: () => void;
}) {
  const org = useOrg();
  return (
    <aside className="sidebar">
      {/* The mark alone -- the window title already says "Argus Launcher", so
          the wordmark was saying it twice. Alpha-masked PNG, tinted by the
          stylesheet so it inverts cleanly in dark mode. */}
      <div className="brand">
        <span className="brand-mark" role="img" aria-label="Argus" />
      </div>
      <nav>
        {tabs.map((tab) => (
          <button
            aria-current={activeTab === tab.id ? 'page' : undefined}
            className={activeTab === tab.id ? 'active' : ''}
            key={tab.id}
            onClick={() => onTab(tab.id)}
          >
            <tab.icon size={16} strokeWidth={1.75} />
            {tab.label}
          </button>
        ))}
      </nav>
      <div className="account">
        <button
          className="account-row account-trigger"
          onClick={onSettings}
          title={`${org.email} -- open settings`}
        >
          {org.avatarUrl ?
            <img alt="" className="account-avatar" referrerPolicy="no-referrer" src={org.avatarUrl} /> :
            <span>{initials(org.email)}</span>}
          <strong>{shortenEmail(org.email)}</strong>
          <Settings className="account-gear" size={15} strokeWidth={1.75} aria-hidden="true" />
        </button>
      </div>
    </aside>
  );
}

export function Topbar({activeTab, actions}: {activeTab: TabId; actions: ReactNode}) {
  const org = useOrg();
  return (
    <header className="topbar">
      <div>
        <h1>{tabs.find((tab) => tab.id === activeTab)?.label}</h1>
        <p>Argus Launcher owns cloud data. Argys Browser starts as a separate anonymous process.</p>
      </div>
      <div className="actions">
        {/* Only shown when the user is actually in more than one firm --
            the common case is one org, chosen silently. */}
        {org.orgs.length > 1 && (
          <label className="field">
            <span>Organization</span>
            <select value={org.orgId || ''} onChange={(event) => org.setOrgId(event.target.value)}>
              {org.orgs.map((membership) => (
                <option key={membership.org.id} value={membership.org.id}>
                  {membership.org.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {actions}
      </div>
    </header>
  );
}

// The corner toast prompting an available/downloading/downloaded update. Lives
// in the shared .toast-stack alongside the status toast so the two stack
// instead of overlapping when both are visible at once.
//
// Dismissal is tracked per version so closing it does not hide a later,
// different update forever. Before this existed, an available update only ever
// showed up as a one-line status buried in Settings, so it was easy to sit on
// an old, unpatched build indefinitely without ever knowing.
export function UpdateToast({state, dismissedVersion, onDismiss}: {
  state: UpdateState | null;
  dismissedVersion: string;
  onDismiss: (version: string) => void;
}) {
  if (!state ||
      !['available', 'downloading', 'downloaded'].includes(state.status) ||
      dismissedVersion === (state.updateInfo?.version || '')) {
    return null;
  }
  const version = state.updateInfo?.version || '';
  return (
    <div className="update-toast">
      <div className="update-toast-body">
        <strong>
          {state.status === 'downloaded' ?
            `Version ${version} downloaded — restart to install` :
            state.status === 'downloading' ?
              `Downloading update… ${Math.round(state.progress?.percent || 0)}%` :
              `Update ${version} available`}
        </strong>
      </div>
      <div className="update-toast-actions">
        {state.status === 'available' && (
          <button onClick={() => native?.downloadUpdate?.()}>Download</button>
        )}
        {state.status === 'downloaded' && (
          <button onClick={() => native?.installUpdate?.()}>Restart &amp; install</button>
        )}
        <button
          className="icon-button"
          aria-label="Dismiss update notice"
          onClick={() => onDismiss(version || 'unknown')}
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
}
