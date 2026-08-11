import {useState} from 'react';
import {RefreshCw} from 'lucide-react';
import {Modal} from '../ui/Modal';
import {CopyableSecret} from './IntegrationModal';
import {formatDate} from '../../lib/text';
import type {ReleaseNotes} from '../../native';
import {useWorkspace} from '../../workspace/WorkspaceProvider';
import type {Updater} from './SettingsModal.types';

// Settings itself lives in src/settings/ -- it is a five-section dialog with
// its own rail, not a modal body. What stays here are the smaller dialogs that
// were always beside it.
//
// The launcher's update panel used to live here too, borrowed by the Settings
// dialog as a passed-in node. It is gone: the Updates page now describes the
// launcher and the browser with the same component, and a bespoke panel for
// one of the two was the thing that made them look like unrelated features.

// Release history for both programs.
//
// This used to render exactly one thing: updateState.updateInfo.releaseNotes,
// the notes attached to an *available* update. Which meant it was blank
// whenever you were current (the usual case), blank in a dev build where the
// updater is disabled outright, silent about the version actually running, and
// had nothing whatsoever for the browser. "No changelog loaded yet" was all
// most people ever saw. It now reads the release list off GitHub -- both
// programs publish to the same public repo -- and falls back to the feed's own
// notes only when that cannot be reached.
export function ChangelogModal({updater, releaseNotes, installedBrowserVersion, onClose}: {
  updater: Updater;
  releaseNotes: ReleaseNotes | null;
  installedBrowserVersion: string;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<'launcher' | 'browser'>('launcher');
  const entries = (tab === 'launcher' ? releaseNotes?.launcher : releaseNotes?.browser) || [];
  const installed = tab === 'launcher' ?
    updater.updateState?.currentVersion || '' :
    installedBrowserVersion;
  // Only reached when GitHub gave us nothing. Better than an empty dialog, and
  // it is the one thing the old version did have.
  const feedNotes = tab === 'launcher' ? updater.updateState?.updateInfo?.releaseNotes : '';

  return (
    <Modal className="small-modal changelog-modal" onClose={onClose} title="Changelog">
      <div className="changelog-tabs" role="tablist">
        {(['launcher', 'browser'] as const).map((key) => (
          <button
            aria-selected={tab === key}
            className={tab === key ? 'active' : ''}
            key={key}
            onClick={() => setTab(key)}
            role="tab"
            type="button"
          >
            {key === 'launcher' ? 'Launcher' : 'Browser'}
          </button>
        ))}
      </div>

      {entries.length > 0 ? (
        <ol className="changelog-list">
          {entries.map((entry) => (
            <li key={entry.tag}>
              <div className="changelog-entry-head">
                <strong>{entry.version}</strong>
                {entry.version === installed && <span className="changelog-installed">Installed</span>}
                <time>{formatDate(entry.publishedAt)}</time>
              </div>
              {entry.notes ?
                <pre className="changelog-notes">{entry.notes}</pre> :
                <p className="changelog-no-notes">No notes were published for this release.</p>}
            </li>
          ))}
        </ol>
      ) : feedNotes ? (
        <pre className="changelog-notes">{feedNotes}</pre>
      ) : (
        <div className="changelog-empty">
          <p>
            {releaseNotes?.stale ?
              'Could not reach the release list, and nothing is cached yet.' :
              'No releases have been published for this yet.'}
          </p>
          <button onClick={() => void updater.run('check')}>
            <RefreshCw size={16} /> Check for updates
          </button>
        </div>
      )}

      {releaseNotes?.stale && releaseNotes.fetchedAt && (
        <p className="changelog-stale">
          Offline — showing the list as of {formatDate(releaseNotes.fetchedAt)}.
        </p>
      )}
    </Modal>
  );
}

export function RevealedKeyModal({name, token, onClose}: {
  name: string;
  token: string;
  onClose: () => void;
}) {
  return (
    <Modal
      onClose={onClose}
      dismissible={false}
      title={`Key created: ${name}`}
      footer={<button onClick={onClose}>Done</button>}
    >
      <p>Copy this now -- Anty won't show the raw key again.</p>
      <CopyableSecret value={token} />
    </Modal>
  );
}

export function OAuthApprovalModal({request, folder, onFolder, onRespond}: {
  request: {clientName: string; requestedScope: string};
  folder: string;
  onFolder: (folderId: string) => void;
  onRespond: (approved: boolean) => void;
}) {
  const {data} = useWorkspace();
  return (
    <Modal
      // No backdrop dismissal and no X: an external app is waiting on an
      // explicit yes or no, and closing the dialog would answer neither.
      dismissible={false}
      onClose={() => onRespond(false)}
      title={`"${request.clientName}" wants to connect`}
      footer={
        <>
          <button onClick={() => onRespond(false)}>Deny</button>
          <button onClick={() => onRespond(true)}>Approve</button>
        </>
      }
    >
      <p>
        It's asking for: <strong>
          {request.requestedScope === 'all' ? 'every profile folder' : request.requestedScope}
        </strong>.
        You can grant a narrower folder instead before approving.
      </p>
      <label>
        <span>Grant access to</span>
        <select value={folder} onChange={(event) => onFolder(event.target.value)}>
          <option value="">All folders</option>
          {data.state.folders.map((item) => (
            <option key={item.id} value={item.id}>{item.name}</option>
          ))}
        </select>
      </label>
    </Modal>
  );
}
