// The three dialogs that exist to make a destructive action deliberate, plus
// the one that reports a failure the user has to read.
import {useState} from 'react';
import {Trash2} from 'lucide-react';
import {BusyButton} from '../ui/BusyButton';
import {Modal} from '../ui/Modal';
import {TRASH_RETENTION_DAYS} from '../../lib/trash';
import {useAsyncAction} from '../../useAsyncAction';
import {useWorkspace} from '../../workspace/WorkspaceProvider';
import type {ErrorDialog} from '../../hooks/useToast';

export type ProfileDeleteRequest = {
  profileIds: string[];
  label: string;
  // Proxies used by these profiles and nothing else, so deleting them cannot
  // break a profile that is staying.
  exclusiveProxyIds: string[];
};

export type ProxyDeleteRequest = {
  proxyIds: string[];
  label: string;
  affectedProfiles: number;
};

export function ProfileDeleteModal({request, onClose, onDeleted}: {
  request: ProfileDeleteRequest;
  // Dismissed without deleting: leaves whatever raised the dialog untouched.
  onClose: () => void;
  // Deleted for real: the editor that raised it should close too.
  onDeleted: () => void;
}) {
  const {toast, profiles} = useWorkspace();
  const {run, isPending} = useAsyncAction();
  const [alsoDeleteProxies, setAlsoDeleteProxies] = useState(false);
  const {profileIds, label, exclusiveProxyIds} = request;
  const removingProxies = alsoDeleteProxies && exclusiveProxyIds.length > 0;

  async function confirm() {
    if (!await profiles.softDelete(profileIds, removingProxies ? exclusiveProxyIds : [])) {
      return;
    }
    onDeleted();
    toast.setMessage(`${label} moved to Trash${removingProxies ? ' with its proxy deleted' : ''}`);
  }

  return (
    <Modal
      className="small-modal"
      onClose={onClose}
      title={`Delete ${label}?`}
      footer={
        <>
          <button className="ghost" onClick={onClose}>Cancel</button>
          <BusyButton
            className="danger"
            busy={isPending('delete-profiles')}
            icon={<Trash2 size={16} />}
            busyLabel="Deleting…"
            onClick={() => void run('delete-profiles', confirm)}
          >
            Delete
          </BusyButton>
        </>
      }
    >
      <p className="error-detail">
        Moved to Trash for {TRASH_RETENTION_DAYS} days (Profiles tab &rarr; Trash), then permanently deleted. You can restore
        {profileIds.length === 1 ? ' it' : ' them'} any time before that.
      </p>
      {exclusiveProxyIds.length > 0 && (
        <label className="checkbox-confirm">
          <input
            type="checkbox"
            checked={alsoDeleteProxies}
            onChange={(event) => setAlsoDeleteProxies(event.target.checked)}
          />
          <span>
            Also permanently delete {exclusiveProxyIds.length === 1 ?
              'the proxy' :
              `the ${exclusiveProxyIds.length} proxies`} assigned
            {profileIds.length === 1 ? ' to this profile' : ' to these profiles'} now (not used by any other profile). Proxies aren't moved to Trash.
          </span>
        </label>
      )}
    </Modal>
  );
}

export function ProxyDeleteModal({request, onClose, onDeleted}: {
  request: ProxyDeleteRequest;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const {toast, proxies} = useWorkspace();
  const [acknowledged, setAcknowledged] = useState(false);
  const {proxyIds, label, affectedProfiles} = request;
  const one = proxyIds.length === 1;

  async function confirm() {
    if (!await proxies.remove(proxyIds)) {
      return;
    }
    onDeleted();
    toast.setMessage(`${label} deleted`);
  }

  return (
    <Modal
      className="small-modal"
      onClose={onClose}
      title={`Delete ${label}?`}
      footer={
        <>
          <button className="ghost" onClick={onClose}>Cancel</button>
          <button className="danger" disabled={!acknowledged} onClick={() => void confirm()}>
            <Trash2 size={16} /> Delete
          </button>
        </>
      }
    >
      <p className="error-detail">
        {affectedProfiles > 0 ?
          `This will permanently remove ${one ? 'this proxy' : 'these proxies'} and unassign ${affectedProfiles === 1 ? 'it' : 'them'} from ${affectedProfiles} ${affectedProfiles === 1 ? 'profile' : 'profiles'}. Those profiles will be blocked from launching until a new proxy is assigned.` :
          `This will permanently remove ${one ? 'this proxy' : 'these proxies'}. No profile is currently assigned to it.`}
      </p>
      <label className="checkbox-confirm">
        <input
          type="checkbox"
          checked={acknowledged}
          onChange={(event) => setAcknowledged(event.target.checked)}
        />
        <span>I understand this cannot be undone.</span>
      </label>
    </Modal>
  );
}

export function ErrorModal({dialog, onClose}: {dialog: ErrorDialog; onClose: () => void}) {
  return (
    <Modal
      className="small-modal error-modal"
      onClose={onClose}
      title={dialog.title}
      footer={
        <>
          <button
            className="ghost"
            onClick={() => void navigator.clipboard.writeText(dialog.detail)}
          >
            Copy error
          </button>
          <button onClick={onClose}>Close</button>
        </>
      }
    >
      <p className="error-detail">{dialog.detail}</p>
    </Modal>
  );
}
