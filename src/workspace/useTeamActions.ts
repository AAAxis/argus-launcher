// Membership mutations: invite, revoke, remove someone, leave.
//
// Invites live here rather than in CloudState because every policy on
// org_invites is is_org_owner -- including select -- so a member reading the
// table gets an empty list rather than an error. A silent nothing in the
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
import {linkStillWorthShowing, sendInviteEmail} from '../lib/inviteEmail';
import type {InviteEmailResult} from '../lib/inviteEmail';
import type {WorkspaceCore} from './core';
import type {OrgInvite} from '../types';

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

  // Called by the Team tab when the owner opens it. A member never calls it --
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

  // What the invite dialog gets back once the row exists. `url` is present only
  // when the owner still has to deliver it -- a delivered invitation showing a
  // link to copy is what made a broken mailer indistinguishable from a working
  // one, on both this app and the website.
  type InviteOutcome = {emailed: true} | {emailed: false; failure: string; url?: string};

  // Returns the outcome, or an error string -- the same Promise-returns-the-
  // error convention the automation editor uses, except this one carries a value
  // back on the happy path. The dialog renders the error inline next to the
  // field that caused it rather than raising a toast, so both halves of the
  // result are its business.
  //
  // The send is reported separately from the creation rather than folded into
  // the error case, because a failed send is not a failed invite. The row
  // exists, the seat is reserved and the link works; the only thing that
  // changed is who has to deliver it.
  async function createInvite(
      orgId: string, email: string,
  ): Promise<InviteOutcome | {error: string}> {
    let created;
    try {
      created = await db.team.createInvite(orgId, email);
    } catch (error) {
      return {error: describeDbError(error, 'Could not create the invite.')};
    }
    // Past this point the invite is real, so nothing below may turn the result
    // into an error. sendInviteEmail never throws (see lib/inviteEmail.ts).
    const sent = await sendInviteEmail(created.token);
    await loadInvites(orgId);
    return describeOutcome(sent, created.token);
  }

  function describeOutcome(sent: InviteEmailResult, token: string): InviteOutcome {
    if (sent.ok) {
      return {emailed: true};
    }
    return {
      emailed: false,
      failure: sent.message,
      // Withheld for the failures that describe an invitation nobody can use --
      // expired, revoked, already accepted. Handing the owner a URL then would
      // give them something that fails for their teammate instead of for them.
      ...(linkStillWorthShowing(sent) ? {url: inviteUrl(token)} : {}),
    };
  }

  // Re-delivers an invitation that already exists. The website's 60-second floor
  // is what stops this being a way to drain the day's mail budget, so a refusal
  // here is expected traffic rather than a bug -- it comes back as `throttled`
  // with the seconds remaining.
  async function resendInvite(orgId: string, token: string): Promise<InviteOutcome> {
    const sent = await sendInviteEmail(token);
    // Only on success: a failure changed nothing on the server, and re-reading
    // the list to prove that costs a round trip for no new information.
    if (sent.ok) {
      await loadInvites(orgId);
    }
    return describeOutcome(sent, token);
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

  async function remove(orgId: string, userId: string): Promise<void> {
    if (await withDb(() => db.team.removeMember(orgId, userId))) {
      await reloadMembers(orgId);
    }
  }

  // Returns the failure text rather than toasting it. Leaving now succeeds for
  // any member, so the remaining refusal is the owner's -- and "the owner cannot
  // leave their own workspace" is an explanation that belongs in the dialog the
  // user is looking at, not in a corner toast they may not connect to the click.
  async function leave(orgId: string, userId: string): Promise<string | null> {
    return withDbError(() => db.team.leaveOrg(orgId, userId));
  }

  return {
    invites,
    invitesLoaded,
    loadInvites,
    createInvite,
    resendInvite,
    revokeInvite,
    remove,
    leave,
  };
}
