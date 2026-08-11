// Choosing who is on the hook for something.
//
// The write side of the Assigned column. `Assignee` renders who holds a row;
// this picks them, and the two deliberately agree on what a person is called --
// both go through the display_name / email-local-part / email precedence, so a
// profile does not read "Anna" in the table and "anna.k" in its own editor.
//
// A plain <select> rather than the Popover listbox StatusPicker and the Team
// tab's role dropdown use. It sits between Folder and Run-on-launch in the
// profile editor, which are both native selects, and a third control with its
// own popover behaviour between two that open a system menu is a difference the
// eye notices without learning anything from. The avatars a listbox would allow
// are already carried by the Assigned column beside it.
//
// Callers gate on the roster size themselves rather than this returning null
// for a one-person workspace: the field's <Field> wrapper and its hint belong
// to the caller's layout, and a component that sometimes renders nothing leaves
// a labelled empty row behind.
import {assigneeName} from '../../lib/assignees';
import {useOrg} from '../../org';
import type {OrgMember} from '../../types';

export function AssigneeSelect({value, members, onChange, unassignedLabel}: {
  // An auth user id, or '' for unassigned. '' rather than null so it can be a
  // <select> value and a draft string field without a conversion at each end.
  value: string;
  members: OrgMember[];
  onChange: (userId: string) => void;
  // "Unassigned" reads right on a profile that has an owner to lose. The import
  // dialog says "Nobody" instead, because there nothing has been created yet
  // and there is no assignment to undo.
  unassignedLabel?: string;
}) {
  const org = useOrg();

  // Yourself first and named "You", the same word the Assignee chip uses. The
  // rest in roster order.
  const others = members.filter((member) => member.user_id !== org.userId);

  // A value pointing at somebody no longer on the roster -- assigned_to is
  // ON DELETE SET NULL against auth.users, so this is the window between a
  // colleague being removed from the org and their account being deleted.
  // Without this option the <select> would silently show the first entry
  // instead, and saving the form would reassign the row to whoever that is.
  const orphaned = Boolean(value) && value !== org.userId &&
    !others.some((member) => member.user_id === value);

  return (
    <select value={value} onChange={(event) => onChange(event.target.value)}>
      <option value="">{unassignedLabel || 'Unassigned'}</option>
      {org.userId && <option value={org.userId}>You</option>}
      {others.map((member) => (
        <option key={member.user_id} value={member.user_id}>
          {assigneeName(member.user_id, members)}
        </option>
      ))}
      {orphaned && <option value={value}>Former member</option>}
    </select>
  );
}
