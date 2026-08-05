// Offering items to teammates, and answering what arrives.
//
// Pending hand-offs live here rather than in CloudState, following the
// org_invites precedent: they are a small list that only two surfaces read (the
// topbar bell and the Team tab), they change on their own schedule, and folding
// them into the ten-table parallel load would mean re-reading them on every
// window focus for screens that are not looking at them.
//
// The ASSIGNMENTS they produce are a different matter and do live in
// CloudState -- assigned_to is a column on the four entity tables, so it
// arrives with the rows themselves and needs nothing here.
import {useCallback, useState} from 'react';
import * as db from '../db';
import {describeDbError} from '../db/errors';
import {assigneeName} from '../lib/assignees';
import {useOrg} from '../org';
import type {WorkspaceCore} from './core';
import type {Handoff, HandoffKind, OrgMember} from '../types';

export type SharedActions = ReturnType<typeof useSharedActions>;

// "Assigned to you", "Assigned to Anna", "Assignment cleared".
//
// Goes through assigneeName so the toast calls somebody exactly what the
// Assigned column and the picker call them -- three renderings of one person,
// within a second of each other, is how a name starts looking like a bug.
//
// "you" rather than your own display name, matching the Assignee chip: a
// message addressed to the person reading it should not refer to them in the
// third person.
function assignedMessage(
    userId: string | null, selfId: string | null, members: OrgMember[]): string {
  if (!userId) {
    return 'Assignment cleared';
  }
  if (userId === selfId) {
    return 'Assigned to you';
  }
  const name = assigneeName(userId, members);
  return name ? `Assigned to ${name}` : 'Assigned';
}

export function useSharedActions({data, toast}: WorkspaceCore) {
  const {withDb} = data;
  const org = useOrg();
  const [pending, setPending] = useState<Handoff[]>([]);
  const [loaded, setLoaded] = useState(false);

  // Quiet by design. This runs on every window focus alongside the workspace
  // reload, and a workspace with no Supabase configured -- or a network blip --
  // must not put a toast on screen once a minute for a list nobody asked to
  // see. A failure leaves the previous list standing.
  const load = useCallback(async (orgId: string) => {
    try {
      setPending(await db.shared.listPending(orgId));
    } catch {
      // Deliberately silent; see above.
    } finally {
      setLoaded(true);
    }
  }, []);

  // Returns an error string rather than toasting, the same convention
  // createInvite uses: every failure here is about the teammate or the
  // selection the user is looking at right now -- "you can't share with
  // yourself", "they're not on this team" -- so it belongs in the dialog beside
  // the control that caused it.
  async function offer(
      orgId: string,
      kind: HandoffKind,
      ids: string[],
      toUserId: string,
      note?: string): Promise<{count: number} | {error: string}> {
    try {
      const count = await db.shared.offer(orgId, kind, ids, toUserId, note);
      await load(orgId);
      return {count};
    } catch (error) {
      return {error: describeDbError(error, 'Could not share that.')};
    }
  }

  // Accepting changes a column on a row in CloudState, so the workspace has to
  // be re-read for the Assigned column to catch up. `reload` is passed in
  // rather than reached for: WorkspaceProvider owns it and this hook is
  // constructed before it exists.
  async function accept(
      id: string, orgId: string, reload: () => void): Promise<boolean> {
    // Dropped from the list first: an offer that lingers for a round trip after
    // you press Accept reads as a click that did nothing, and this is a button
    // people press several times in a row.
    const before = pending;
    setPending((current) => current.filter((item) => item.id !== id));
    const ok = await withDb(() => db.shared.accept(id));
    if (!ok) {
      setPending(before);
      return false;
    }
    reload();
    await load(orgId);
    return true;
  }

  async function decline(id: string, orgId: string): Promise<boolean> {
    const before = pending;
    setPending((current) => current.filter((item) => item.id !== id));
    const ok = await withDb(() => db.shared.decline(id));
    if (!ok) {
      setPending(before);
      return false;
    }
    await load(orgId);
    return true;
  }

  // Sender-side, pending only.
  async function cancel(id: string, orgId: string): Promise<boolean> {
    const ok = await withDb(() => db.shared.cancel(id));
    if (ok) {
      await load(orgId);
    }
    return ok;
  }

  // Point an item at a teammate, at yourself, or at nobody. offer() is the
  // other road: same destination, but they accept it first.
  //
  // The toast used to say "Assigned to you" unconditionally, which was true
  // only while set_assignee refused every other target. Now it would be a lie
  // about where the profile actually went, so it names the person -- read from
  // the roster already in state rather than passed in by every caller.
  async function setAssignee(
      orgId: string, kind: HandoffKind, itemId: string, toUserId: string | null,
      reload: () => void): Promise<boolean> {
    const ok = await withDb(() => db.shared.setAssignee(orgId, kind, itemId, toUserId));
    if (ok) {
      reload();
      toast.setMessage(assignedMessage(toUserId, org.userId, data.state.members));
    }
    return ok;
  }

  // The bulk form, for the import dialog. Silent on success: it runs as the
  // last act of an import that already puts its own summary on screen, and a
  // toast over that reads as a second, unrelated thing having happened.
  async function setAssignees(
      orgId: string, kind: HandoffKind, itemIds: string[],
      toUserId: string | null): Promise<boolean> {
    if (!itemIds.length) {
      return true;
    }
    return withDb(() => db.shared.setAssignees(orgId, kind, itemIds, toUserId));
  }

  return {
    pending,
    loaded,
    load,
    offer,
    accept,
    decline,
    cancel,
    setAssignee,
    setAssignees,
  };
}
