// Confirming that you want out of somebody else's workspace.
//
// Lived inside TeamTab.tsx while the Team tab was the only way to reach it. The
// sidebar switcher now offers the same action -- leaving is a thing you do to
// the workspace you are looking at, so it belongs next to the list of them --
// and two callers is one caller too many for a component to stay private.
import {useState} from 'react';
import {LogOut} from 'lucide-react';
import {Modal} from '../ui/Modal';

export function LeaveTeamModal({orgName, onClose, onConfirm, onLeft}: {
  orgName: string;
  onClose: () => void;
  // Resolves to a message on failure, null on success -- the shape
  // useTeamActions returns, so the caller does not have to unwrap it.
  onConfirm: () => Promise<string | null>;
  onLeft: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <Modal
      className="small-modal"
      onClose={onClose}
      title={`Leave ${orgName}?`}
      footer={
        <>
          {/* Rendered here rather than as a toast because the likely failure is
              an explanation -- org_members_delete carries `role <> 'owner'`, so
              an owner is told they cannot leave their own workspace -- and that
              belongs next to the button that produced it. */}
          {error && <p className="settings-error">{error}</p>}
          <button className="ghost" onClick={onClose}>Cancel</button>
          <button className="danger" disabled={busy} onClick={() => {
            setBusy(true);
            setError('');
            void onConfirm().then((message) => {
              setBusy(false);
              if (message) {
                setError(message);
                return;
              }
              onLeft();
            });
          }}>
            <LogOut size={16} /> Leave
          </button>
        </>
      }
    >
      <p className="error-detail">
        You'll lose access to this workspace's profiles, proxies and cookie sets. Nothing
        is deleted, and its owner can invite you back.
      </p>
    </Modal>
  );
}
