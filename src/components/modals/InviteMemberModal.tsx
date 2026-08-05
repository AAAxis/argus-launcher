// Invite someone to the workspace.
//
// Two states in one dialog rather than two dialogs, because they are one
// thought: you type an address and you get back a link to send. Splitting them
// would put a "done" screen between the admin and the only thing they actually
// need, which is the link.
//
// There is no email delivery anywhere in this product -- Supabase sends OTP
// codes and nothing else -- so the second state says so outright instead of
// implying the invite is already on its way. An owner who closes this without
// copying the link has to revoke and re-invite, which the copy step is placed
// to make unlikely.
//
// There is no role to pick. Everyone invited joins as a member, with full access
// to the workspace's contents and settings; the owner is whoever holds the
// account. The picker that used to be here offered 'admin', which stopped
// existing in 2026-08-10-owner-member-roles.sql.
import {useState} from 'react';
import {Check, Copy, Mail} from 'lucide-react';
import {BusyButton} from '../ui/BusyButton';
import {Field} from '../ui/Field';
import {Modal} from '../ui/Modal';

export function InviteMemberModal({onClose, onInvite, seatsLeft}: {
  onClose: () => void;
  // Returns the link, or the sentence explaining why it could not be created.
  // The same Promise-returns-the-error convention the automation editor uses,
  // except this one carries a value back on success too.
  onInvite: (email: string) => Promise<{url: string} | {error: string}>;
  // Shown so the owner can see the cost of what they are about to do before
  // they do it. null is unlimited.
  seatsLeft: number | null;
}) {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [link, setLink] = useState('');
  const [copied, setCopied] = useState(false);

  async function create() {
    setBusy(true);
    setError('');
    const result = await onInvite(email.trim());
    setBusy(false);
    if ('error' in result) {
      setError(result.error);
      return;
    }
    setLink(result.url);
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      // Clipboard access can be refused. The link is on screen and selectable,
      // so the honest fallback is to stop claiming it was copied rather than to
      // raise an error about a thing the user can still do by hand.
      setCopied(false);
    }
  }

  if (link) {
    return (
      <Modal
        className="small-modal invite-modal"
        onClose={onClose}
        title="Invite created"
        subtitle={`${email.trim()} · joins as a member`}
        footer={<button onClick={onClose}>Done</button>}
      >
        <div className="invite-link-row">
          <input className="invite-link" readOnly value={link} onFocus={(event) => {
            event.target.select();
          }} />
          <button className="ghost" onClick={() => void copy()} type="button">
            {copied ? <><Check size={15} /> Copied</> : <><Copy size={15} /> Copy</>}
          </button>
        </div>
        <p className="field-hint">
          Send this link to them yourself — we don't email it. It works once, expires in
          seven days, and only for the address above.
        </p>
      </Modal>
    );
  }

  return (
    <Modal
      className="small-modal invite-modal"
      onClose={onClose}
      title="Invite a member"
      subtitle={seatsLeft === null ?
        'Your plan has no seat limit.' :
        `${seatsLeft} ${seatsLeft === 1 ? 'seat' : 'seats'} left on your plan.`}
      footer={
        <>
          {error && <p className="settings-error">{error}</p>}
          <button className="ghost" onClick={onClose} type="button">Cancel</button>
          <BusyButton
            busy={busy}
            busyLabel="Creating"
            disabled={!email.trim()}
            icon={<Mail size={15} />}
            onClick={() => void create()}
          >Create invite</BusyButton>
        </>
      }
    >
      <Field label="Email address">
        <input
          autoFocus
          onChange={(event) => setEmail(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && email.trim() && !busy) {
              void create();
            }
          }}
          placeholder="teammate@company.com"
          type="email"
          value={email}
        />
      </Field>

      <p className="field-hint">
        They'll join as a member, with full access to this workspace's profiles, proxies,
        cookies and automations. Only you can invite or remove people.
      </p>

      <p className="field-hint">
        They'll need to sign in with this exact address — the link won't work for any
        other account.
      </p>
    </Modal>
  );
}
