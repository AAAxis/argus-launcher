import {Download, RefreshCw} from 'lucide-react';
import {Modal} from '../ui/Modal';
import {CopyableSecret} from './IntegrationModal';
import {updateStatusLabel} from '../../hooks/useNativeState';
import {useWorkspace} from '../../workspace/WorkspaceProvider';
import type {Updater} from './SettingsModal.types';

// Settings itself lives in src/settings/ -- it is a five-section dialog with
// its own rail, not a modal body. What stays here is the update panel it
// borrows, plus the smaller dialogs that were always beside it.
export function UpdateControl({updater}: {updater: Updater}) {
  const state = updater.updateState;
  const busy = updater.busy || state?.status === 'checking' || state?.status === 'downloading';
  return (
    <section className="update-panel">
      <div>
        <span>Launcher {state?.currentVersion || ''}</span>
        <strong>{updateStatusLabel(state)}</strong>
      </div>
      {state?.progress && (
        <div className="update-progress">
          <span style={{width: `${Math.min(100, Math.max(0, state.progress.percent))}%`}} />
        </div>
      )}
      <div className="update-actions">
        <button
          className="ghost icon-button"
          aria-label="Check for updates"
          disabled={busy || state?.canCheck === false}
          onClick={() => void updater.run('check')}
        >
          <RefreshCw size={16} />
        </button>
        {state?.status === 'available' && !busy && (
          <button onClick={() => void updater.run('download')}>
            <Download size={16} /> Download
          </button>
        )}
        {state?.status === 'downloaded' && !busy && (
          <button onClick={() => void updater.run('install')}>Restart</button>
        )}
      </div>
    </section>
  );
}

export function ChangelogModal({updater, onClose}: {updater: Updater; onClose: () => void}) {
  const notes = updater.updateState?.updateInfo?.releaseNotes;
  const version = updater.updateState?.updateInfo?.version || updater.updateState?.currentVersion;
  return (
    <Modal
      className="small-modal changelog-modal"
      onClose={onClose}
      title={`Changelog${version ? ` · v${version}` : ''}`}
    >
      {notes ? (
        <pre className="changelog-notes">{notes}</pre>
      ) : (
        <div className="changelog-empty">
          <p>No changelog loaded yet.</p>
          <button onClick={() => void updater.run('check')}>
            <RefreshCw size={16} /> Check for updates
          </button>
        </div>
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
