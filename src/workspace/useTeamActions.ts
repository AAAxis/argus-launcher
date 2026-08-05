// Membership mutations: invite, revoke, change a role, remove someone, leave.
//
// Invites live here rather than in CloudState because every policy on
// org_invites is is_org_admin -- including select -- so a plain member reading
// the table gets an empty list rather than an error. A silent nothing in the
// shared workspace cache is exactly the "everything vanished" failure
// useCloudData's own comments were written about; keeping the list owned by the
// screen that can read it means a member never sees a half-truth.
//
// Members, by contrast, DO live in CloudState: the Profiles table needs them to
// turn created_by into a name, and every member can read the roster.
import {useCallback, useState} from 'react';
import * as db from '../db';
import {describeDbError} from '../db/errors';
import {SITE_URL} from '../lib/auth';
import type {WorkspaceCore} from './core';
import type {OrgInvite, OrgRole} from '../types';

export type TeamActions = ReturnType<typeof useTeamActions>;

// Where an invite link points. The website hosts acceptance rather than the
// launcher, because the person following it usually has not installed the app
// yet -- and once they have joined, the launcher finds the membership on its
// next sign-in with no deep link involved.
export function inviteUrl(token: string): string {
  return `${SITE_URL}/join/${encodeURIComponent(token)}`;
}

export function useTeamActions({data, toast}: WorkspaceCore) {
  const {withDb, withDbError, patch} = data;
  // Not in CloudState; see the note at the top of the file.
  const [invites, setInvites] = useState<OrgInvite[]>([]);
  const [invitesLoaded, setInvitesLoaded] = useState(false);

  // Called by the Team tab when an admin opens it. A member never calls it --
  // the tab does not render the pending view for them -- so a failure here is
  // always worth reporting rather than swallowing.
  const loadInvites = useCallback(async (orgId: string) => {
    try {
      setInvites(await db.team.listInvites(orgId));
    } catch (error) {
      toast.setMessage(describeDbError(error, 'Could not load pending invites.'));
    } finally {
      setInvitesLoaded(true);
    }
    // toast is rebuilt every render; the identity of setMessage is what matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-reads the roster after a change, rather than patching it locally.
  //
  // The local-patch shortcut the rest of the app uses does not fit here: a role
  // change and a removal both alter a row the server also derives things from,
  // and the roster is a handful of rows read through one RPC. One round trip is
  // cheaper than a divergence.
  const reloadMembers = useCallback(async (orgId: string) => {
    try {
      const members = await db.team.listMembers(orgId);
      patch.members(() => members);
    } catch {
      // The caller has already reported whatever went wrong with the write
      // itself; a second toast about the refresh would be noise, and the next
      // window focus reloads the workspace anyway.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Returns the link on success, or an error string -- the same
  // Promise<string | null> convention the automation editor uses, except this
  // one carries a value back on the happy path. The dialog renders the error
  // inline next to the field that caused it rather than raising a toast, so
  // both halves of the result are its business.
  async function createInvite(
      orgId: string, email: string, role: Exclude<OrgRole, 'owner'>,
  ): Promise<{url: string} | {error: string}> {
    try {
      const created = await db.team.createInvite(orgId, email, role);
      await loadInvites(orgId);
      return {url: inviteUrl(created.token)};
    } catch (error) {
      return {error: describeDbError(error, 'Could not create the invite.')};
    }
  }

  async function revokeInvite(orgId: string, id: string): Promise<void> {
    // Optimistically dropped from the list, then reconciled: revoking is the
    // one action here whose result is entirely local, and a row that lingers
    // until a round trip completes reads as a click that did nothing.
    const before = invites;
    setInvites((current) => current.filter((invite) => invite.id !== id));
    const ok = await withDb(() => db.team.revokeInvite(orgId, id));
    if (!ok) {
      setInvites(before);
    }
  }

  async function setRole(
      orgId: string, userId: string, role: Exclude<OrgRole, 'owner'>): Promise<void> {
    if (await withDb(() => db.team.setMemberRole(orgId, userId, role))) {
      await reloadMembers(orgId);
    }
  }

  async function remove(orgId: string, userId: string): Promise<void> {
    if (await withDb(() => db.team.removeMember(orgId, userId))) {
      await reloadMembers(orgId);
    }
  }

  // Returns the failure text rather than toasting it: leaving is refused for a
  // plain member by org_members_delete, and that refusal is an instruction
  // ("ask an owner or admin to remove you") that belongs in the dialog the user
  // is looking at, not in a corner toast they may not connect to the click.
  async function leave(orgId: string, userId: string): Promise<string | null> {
    return withDbError(() => db.team.leaveOrg(orgId, userId));
  }

  return {
    invites,
    invitesLoaded,
    loadInvites,
    createInvite,
    revokeInvite,
    setRole,
    remove,
    leave,
  };
}
