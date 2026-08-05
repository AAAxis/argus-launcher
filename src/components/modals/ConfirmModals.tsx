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

// Deleting a workflow, from the editor's own footer.
//
// It was a window.confirm() on the card, which is the pattern the three dialogs
// around it exist to replace -- and it is the one destructive action in the app
// whose consequence lands somewhere the user is not looking: every profile with
// this automation attached silently stops running anything on launch. That
// sentence is the reason this is a dialog and not a native confirm.
export type AutomationDeleteRequest = {
  id: string;
  label: string;
  attachedProfiles: number;
};

export function AutomationDeleteModal({request, onClose, onDeleted}: {
  request: AutomationDeleteRequest;
  onClose: () => void;
  // Deleted for real: the editor that raised it should close too.
  onDeleted: () => void;
}) {
  const {toast, automations} = useWorkspace();
  const {run, isPending} = useAsyncAction();
  const {id, label, attachedProfiles} = request;

  async function confirm() {
    if (!await automations.remove([id])) {
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
          <BusyButton
            className="danger"
            busy={isPending('delete-automation')}
            icon={<Trash2 size={16} />}
            busyLabel="Deleting…"
            onClick={() => void run('delete-automation', confirm)}
          >
            Delete
          </BusyButton>
        </>
      }
    >
      <p className="error-detail">
        This permanently removes the workflow and its steps. Runs already in its
        history stay where they are.
      </p>
      {attachedProfiles > 0 && (
        <p className="error-detail">
          {attachedProfiles === 1 ?
            '1 profile has it attached and will stop running it on launch.' :
            `${attachedProfiles} profiles have it attached and will stop running it on launch.`}
        </p>
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

// Permanent deletion out of Trash: one profile, the selected ones, or the whole
// bin.
//
// The three of these were raw window.confirm() calls, while the *soft* delete --
// the reversible one -- got the styled dialog above with its "I understand"
// checkbox. That was backwards: the irreversible action was the one you could
// dismiss with a stray Return keypress, and a native confirm cannot say what
// "forever" costs here (the on-disk browser directory, cookies and logged-in
// sessions all go with it).
export type PurgeRequest = {
  // The rows to purge, or empty for "everything in Trash" -- which is counted
  // rather than listed, because Empty Trash deliberately does not require
  // selecting anything first.
  ids: string[];
  count: number;
  label: string;
};

export function PurgeProfilesModal({request, onClose, onPurged}: {
  request: PurgeRequest;
  onClose: () => void;
  onPurged: () => void;
}) {
  const {toast, profiles} = useWorkspace();
  const {run, isPending} = useAsyncAction();
  const [acknowledged, setAcknowledged] = useState(false);
  const {ids, count, label} = request;
  const emptyingAll = ids.length === 0;

  async function confirm() {
    // purgeAll rather than purge(everyId): the delete is one statement scoped by
    // deleted_at, so a profile someone else trashed while this dialog was open
    // goes too instead of being missed by an id list built before it existed.
    const ok = emptyingAll ? await profiles.purgeAll() : await profiles.purge(ids);
    if (!ok) {
      return;
    }
    onPurged();
    toast.setMessage(`${count} ${count === 1 ? 'profile' : 'profiles'} permanently deleted`);
  }

  return (
    <Modal
      className="small-modal"
      onClose={onClose}
      title={emptyingAll ? 'Empty Trash?' : `Permanently delete ${label}?`}
      footer={
        <>
          <button className="ghost" onClick={onClose}>Cancel</button>
          <BusyButton
            className="danger"
            busy={isPending('purge-profiles')}
            busyLabel="Deleting…"
            disabled={!acknowledged}
            icon={<Trash2 size={16} />}
            onClick={() => void run('purge-profiles', confirm)}
          >
            Delete forever
          </BusyButton>
        </>
      }
    >
      <p className="error-detail">
        {emptyingAll ?
          `This permanently deletes all ${count} ${count === 1 ? 'profile' : 'profiles'} in Trash.` :
          `This permanently deletes ${count === 1 ? 'this profile' : `these ${count} profiles`}.`}
        {' '}
        Cookies, saved logins and the browser data on disk go with
        {count === 1 ? ' it' : ' them'}, and there is no way to get
        {count === 1 ? ' it' : ' them'} back.
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

// The cookie-set twin of PurgeProfilesModal. Separate rather than generalised for
// the reason the two Move dialogs are separate: the consequence differs (a purged
// set drops the profiles using it back to no cookies at all), and a props union
// covering both would read worse than either.
export function PurgeCookieSetsModal({request, onClose, onPurged}: {
  request: PurgeRequest;
  onClose: () => void;
  onPurged: () => void;
}) {
  const {toast, cookies, data} = useWorkspace();
  const {run, isPending} = useAsyncAction();
  const [acknowledged, setAcknowledged] = useState(false);
  const {ids: setIds, count, label} = request;
  const emptyingAll = setIds.length === 0;

  // Only profiles that are not themselves trashed: a trashed profile cannot
  // launch, so telling the user it is about to lose its cookies is noise.
  const affected = data.state.profiles.filter((profile) =>
    !profile.deleted_at && profile.cookie_id &&
    (emptyingAll ?
      data.state.cookies.some((set) => set.id === profile.cookie_id && set.deleted_at) :
      setIds.includes(profile.cookie_id))).length;

  async function confirm() {
    const ok = emptyingAll ? await cookies.purgeAll() : await cookies.purge(setIds);
    if (!ok) {
      return;
    }
    onPurged();
    toast.setMessage(`${count} ${count === 1 ? 'cookie-set' : 'cookie-sets'} permanently deleted`);
  }

  return (
    <Modal
      className="small-modal"
      onClose={onClose}
      title={emptyingAll ? 'Empty cookie-set Trash?' : `Permanently delete ${label}?`}
      footer={
        <>
          <button className="ghost" onClick={onClose}>Cancel</button>
          <BusyButton
            className="danger"
            busy={isPending('purge-cookie-sets')}
            busyLabel="Deleting…"
            disabled={!acknowledged}
            icon={<Trash2 size={16} />}
            onClick={() => void run('purge-cookie-sets', confirm)}
          >
            Delete forever
          </BusyButton>
        </>
      }
    >
      <p className="error-detail">
        {emptyingAll ?
          `This permanently deletes all ${count} ${count === 1 ? 'cookie-set' : 'cookie-sets'} in Trash, and the cookie files behind them.` :
          `This permanently deletes ${count === 1 ? 'this cookie-set' : `these ${count} cookie-sets`}, and the cookie ${count === 1 ? 'file' : 'files'} behind ${count === 1 ? 'it' : 'them'}.`}
        {affected > 0 && ` ${affected} ${affected === 1 ? 'profile that uses one will launch' : 'profiles that use one will launch'} with no cookies.`}
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
