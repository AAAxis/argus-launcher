// "You're in somebody else's workspace. Want one of your own?"
//
// Asked once, of the one group the product never asked: people who arrived by
// invitation. bootstrap_org hands a new account the workspace it was invited
// into and stops -- correctly, because creating a second one nobody asked for is
// how this database ended up with several empty "gmail.com team" rows -- but the
// consequence was that an invited user had no workspace of their own and no
// prompt telling them they could have one. The sidebar switcher now offers
// "Create workspace" at any time; this is the one nudge toward it.
//
// The answer is recorded on the account (user_settings.personal_workspace_
// prompt_at), not on an org. They are sitting in somebody else's workspace by
// definition, so a column there would ask them again from the next one they
// join.
import {Building2} from 'lucide-react';
import {Modal} from '../ui/Modal';

export function PersonalWorkspaceModal({orgName, busy, onCreate, onDecline}: {
  orgName: string;
  busy: boolean;
  onCreate: () => void;
  onDecline: () => void;
}) {
  return (
    <Modal
      className="small-modal"
      // Closing is declining. Both are recorded, for the same reason the setup
      // prompt records "Not now": this has no second entry point, so the only
      // alternative to recording a decline is asking again every launch.
      onClose={onDecline}
      title="Would you like a workspace of your own?"
      subtitle={`You're working in ${orgName}, which belongs to someone else.`}
      footer={
        <>
          <button className="ghost" disabled={busy} onClick={onDecline} type="button">
            No thanks
          </button>
          <button disabled={busy} onClick={onCreate} type="button">
            <Building2 size={15} strokeWidth={1.75} /> Create one
          </button>
        </>
      }
    >
      <p className="modal-detail">
        Your own workspace has its own profiles, proxies, cookie sets and team, separate
        from {orgName}. It starts on the Free plan and is billed on its own. You can switch
        between the two from the sidebar at any time, and nothing here is moved or shared.
      </p>
    </Modal>
  );
}
