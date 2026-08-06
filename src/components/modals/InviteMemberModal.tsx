// Invite someone to the workspace.
//
// Two states in one dialog rather than two dialogs, because they are one
// thought: you type an address and you find out whether it reached them.
//
// The invitation is emailed by the website (see lib/inviteEmail.ts), and the
// second state shows the link **only when that failed**. It used to show it
// either way, on the reasoning that a delivered invitation still lands in a
// stranger's spam often enough to want a manual path. That was a bad trade: a
// dialog that offers a link to copy after every invite says nothing about
// whether the email went out, so a website deployed without its Resend key
// looked exactly like a working one. The failure now has to be visible, and the
// fallback has to be earned.
//
// When the send does fail the dialog says why -- refused, unreachable,
// throttled -- and hands over the link. For the failures that describe an
// invitation nobody can use (expired, revoked, already accepted) it says so and
// withholds the link, because that URL fails for the teammate, not the owner.
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

// What the second state renders. `emailed: true` is the whole story on its own;
// the failure case carries the sentence, and a link only when one is any use.
export type InviteOutcome =
  | {emailed: true}
  | {emailed: false; failure: string; url?: string};

export function InviteMemberModal({onClose, onInvite, seatsLeft}: {
  onClose: () => void;
  // Returns the outcome, or the sentence explaining why the invite could not be
  // created at all. The same Promise-returns-the-error convention the automation
  // editor uses, except this one carries a value back on success too.
  onInvite: (email: string) => Promise<InviteOutcome | {error: string}>;
  // Shown so the owner can see the cost of what they are about to do before
  // they do it. null is unlimited.
  seatsLeft: number | null;
}) {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [outcome, setOutcome] = useState<InviteOutcome | null>(null);
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
    setOutcome(result);
  }

  async function copy(link: string) {
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

  if (outcome) {
    const link = outcome.emailed ? '' : outcome.url;
    return (
      <Modal
        className="small-modal invite-modal"
        onClose={onClose}
        title={outcome.emailed ? 'Invitation sent' : 'Invite created, not emailed'}
        subtitle={`${email.trim()} · joins as a member`}
        footer={<button onClick={onClose}>Done</button>}
      >
        {link && (
          <div className="invite-link-row">
            <input className="invite-link" readOnly value={link} onFocus={(event) => {
              event.target.select();
            }} />
            <button className="ghost" onClick={() => void copy(link)} type="button">
              {copied ? <><Check size={15} /> Copied</> : <><Copy size={15} /> Copy</>}
            </button>
          </div>
        )}
        <p className="field-hint">
          {outcome.emailed ?
            'We emailed them a link to join. ' :
            `${outcome.failure} ${link ? 'Send this link to them yourself. ' : ''}`}
          It works once, expires in seven days, and only for the address above.
        </p>
        {/* The seat is spoken for either way, and an owner who reads "not
            emailed" as "not created" will invite them again and be told the
            plan is full. */}
        {!outcome.emailed && (
          <p className="field-hint">
            The invitation itself is fine — it is saved and holding a seat. Only the
            email failed. You can try again from the Team tab.
          </p>
        )}
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
