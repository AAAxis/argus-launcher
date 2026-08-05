// Turning an assigned_to uuid into something a person can read.
//
// Lives here rather than inside the Assignee component because the four tables
// also SORT by it, and a sort comparator has no component to ask. Both paths
// have to agree on the answer or a column would sort by one name and display
// another.
import type {OrgMember} from '../types';

// The display name, the email's local part, or the email -- the same
// precedence the Team roster uses for a member's name, so one person is called
// the same thing on every screen.
//
// Returns undefined rather than '' or 'Unassigned' for an unclaimed row.
// useTableSort drops undefined to the bottom in both directions, which is what
// keeps a column of unassigned rows out of the way of a descending sort.
export function assigneeName(
    userId: string | null | undefined, members: OrgMember[]): string | undefined {
  if (!userId) {
    return undefined;
  }
  const member = members.find((item) => item.user_id === userId);
  if (!member) {
    // Assigned to somebody no longer on the roster. Sorted under a real word so
    // those rows cluster instead of scattering among the unassigned ones.
    return 'Former member';
  }
  return member.display_name || member.email.split('@')[0] || member.email;
}
