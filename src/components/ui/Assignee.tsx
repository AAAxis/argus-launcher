// Who is on the hook for a row.
//
// Reads the roster out of CloudState rather than taking a name as a prop:
// members are already there for the Profiles table's created_by column, and
// four tabs would otherwise each resolve the same uuid the same way.
//
// An unassigned row gets an em dash, not "Unassigned". A column of eight
// dashes reads as "nobody has claimed these"; a column of eight repetitions of
// the word reads as noise, and the same choice was already made for the Team
// tab's Invited-by column.
import {initials} from '../../lib/text';
import {useOrg} from '../../org';
import {useWorkspace} from '../../workspace/WorkspaceProvider';

export function Assignee({userId}: {userId?: string | null}) {
  const {data} = useWorkspace();
  const org = useOrg();

  if (!userId) {
    return <span className="assignee">—</span>;
  }

  const member = data.state.members.find((item) => item.user_id === userId);
  // Assigned to somebody who has since left. assigned_to is ON DELETE SET NULL
  // against auth.users, so this only happens between a colleague being removed
  // from the org and their account actually being deleted -- but in that window
  // the roster no longer has them, and a bare uuid on screen is worse than an
  // admission.
  if (!member) {
    return <span className="assignee" title="This person is no longer in the workspace">
      Former member
    </span>;
  }

  const name = member.display_name || member.email.split('@')[0] || member.email;
  const isMe = userId === org.userId;
  return (
    <span className={isMe ? 'assignee is-me' : 'assignee'} title={member.email}>
      <span className="assignee-avatar">
        {member.avatar_url ?
          <img alt="" referrerPolicy="no-referrer" src={member.avatar_url} /> :
          initials(name)}
      </span>
      <span className="assignee-name">{isMe ? 'You' : name}</span>
    </span>
  );
}
