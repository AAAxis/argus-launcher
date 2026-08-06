// Who else is in this organization, and how they got here.
//
// Separate from orgs.ts on purpose: that module answers "which tenant am I
// looking at" -- the switcher, the active id, the org's own settings. This one
// answers "who else is in it", which is a different question with a different
// audience (the owner) and a different failure mode.
//
// Three of these go through RPCs rather than table access, each for a reason
// that is not stylistic:
//
//   - listMembers, because org_members holds ids and nothing else and Supabase
//     does not expose auth.users to clients. A join from here renders uuids.
//   - createInvite, because the token has to be minted server-side (a
//     client-chosen token is a forgery surface) and the seat has to be reserved
//     in the same transaction as the check.
//   - acceptInvite, because there is no INSERT policy on org_members and no
//     INSERT grant -- 2026-08-10 removed both. Nobody can write a membership
//     row from a client, not even the owner, which is what stops a seat being
//     granted to an address that never confirmed it. accept_org_invite is
//     SECURITY DEFINER and is the only way in.
//
// The rest are ordinary RLS-gated table access, following the same two rules
// the rest of src/db/ follows (see index.ts): orgId is always explicit, and
// every mutation touches one row.
import type {OrgInvite, OrgMember} from '../types';
import {optionalClient, raise, requireClient} from './client';
import {rowToInvite, rowToMember} from './mappers';
import type {OrgInviteRow, OrgMemberIdentityRow} from './rows';

const INVITE_COLUMNS =
  'id,org_id,email,role,token,status,invited_by,accepted_by,expires_at,created_at,accepted_at,' +
  'last_emailed_at';

// The whole roster, oldest membership first -- so the founding owner leads the
// list and the order is stable as people come and go.
export async function listMembers(orgId: string): Promise<OrgMember[]> {
  const client = optionalClient();
  if (!client) {
    return [];
  }
  const {data, error} = await client.rpc('org_members_with_identity', {p_org: orgId});
  raise(error, 'team.listMembers');
  return ((data || []) as OrgMemberIdentityRow[]).map(rowToMember);
}

// Outstanding offers only. Accepted invites are already visible as members, and
// revoked ones are noise -- the table keeps both for the audit trail, but the
// roster has no use for either.
//
// Expired invites ARE returned: the owner needs to see that the link they sent
// last week went stale, which is exactly the thing they would otherwise be
// waiting on. The UI marks them expired.
export async function listInvites(orgId: string): Promise<OrgInvite[]> {
  const client = optionalClient();
  if (!client) {
    return [];
  }
  const {data, error} = await client
      .from('org_invites')
      .select(INVITE_COLUMNS)
      .eq('org_id', orgId)
      .eq('status', 'pending')
      .order('created_at', {ascending: false});
  raise(error, 'team.listInvites');
  return ((data || []) as unknown as OrgInviteRow[]).map(rowToInvite);
}

// How many seats the outstanding invites are holding.
//
// The predicate is copied from create_org_invite deliberately -- `status =
// 'pending' AND expires_at > now()`, which is narrower than listInvites above.
// An expired invite is still worth showing the owner (their link went stale) but
// it no longer reserves anything, so counting it would report a workspace as
// fuller than the database considers it.
//
// This exists because Settings and the Team tab were reporting different seat
// usage for the same workspace: the Team tab counted members plus live invites,
// matching what create_org_invite refuses on, while Settings counted only
// orgs.countMembers() and showed "1 of 5" beside the Team tab's "4 of 5". Two
// numbers for one entitlement, and neither screen said which it meant.
//
// A head count rather than a fetch: the caller wants the number, not the rows.
//
// Owner-only in effect, not by check. Every policy on org_invites is
// is_org_owner, so a member's count comes back 0 rather than forbidden -- the
// caller has to know that and say what it is counting.
export async function countLiveInvites(orgId: string): Promise<number> {
  const client = optionalClient();
  if (!client) {
    return 0;
  }
  const {count, error} = await client
      .from('org_invites')
      .select('id', {count: 'exact', head: true})
      .eq('org_id', orgId)
      .eq('status', 'pending')
      .gt('expires_at', new Date().toISOString());
  raise(error, 'team.countLiveInvites');
  return count || 0;
}

// The column names are prefixed because `returns table (id, token, expires_at)`
// would shadow the identically-named columns inside the function's own body --
// see the note on create_org_invite in 2026-08-05-teams.sql.
type CreateInviteRow = {invite_id: string; invite_token: string; invite_expires_at: string};

export type CreatedInvite = {id: string; token: string; expires_at: string};

// Mints an invite and reserves a seat. Raises seat_limit_reached when the org is
// full, which describeDbError already has a sentence for -- the same exception
// trg_seat_limit raises, deliberately, so both refusals read identically to the
// user however they arrive.
//
// Returns the token so the caller can build the link and hand it to
// lib/inviteEmail.ts, which asks the website to email it. This is the only
// moment the token is available to the client, so the dialog still shows the
// link: the send is a separate round trip and can fail while this one succeeded,
// and an invitation can always land in a stranger's spam.
//
// No role parameter: every invite offers membership, and create_org_invite
// refuses anything else. p_role is still sent, explicitly, because the function
// keeps its three-argument signature -- PostgREST resolves an RPC by the names
// of the arguments it is given, so omitting it here would be a different call.
export async function createInvite(
    orgId: string, email: string): Promise<CreatedInvite> {
  const client = requireClient();
  const {data, error} = await client.rpc('create_org_invite', {
    p_org: orgId,
    p_email: email,
    p_role: 'member',
  });
  raise(error, 'team.createInvite');
  // `returns table(...)` comes back as an array of one, not as a scalar.
  const row = (Array.isArray(data) ? data[0] : data) as CreateInviteRow | undefined;
  if (!row?.invite_token) {
    throw new Error('The invite was created but no link came back. Reload and check the list.');
  }
  return {id: row.invite_id, token: row.invite_token, expires_at: row.invite_expires_at};
}

// The .select() is what turns a member's attempt into a visible failure, the
// same reason orgs.updateBuiltInExtensions carries one: RLS filters the row
// rather than erroring, so an unprivileged update returns success-with-no-rows
// and the invite would appear to vanish from the list until the next load.
export async function revokeInvite(orgId: string, id: string): Promise<void> {
  const client = requireClient();
  const {data, error} = await client
      .from('org_invites')
      .update({status: 'revoked'})
      .eq('org_id', orgId)
      .eq('id', id)
      .select('id');
  raise(error, 'team.revokeInvite');
  if (!data || data.length === 0) {
    throw new Error('Only the owner can revoke an invite.');
  }
}

// Joins the org the token was issued for, and returns its id.
//
// Not reachable from the launcher's own UI today -- invites are accepted on the
// website, because a link has to work for someone who has not installed the app
// yet. It lives here anyway because it is the same table's lifecycle and the
// next person looking for it will look here.
export async function acceptInvite(token: string): Promise<string> {
  const client = requireClient();
  const {data, error} = await client.rpc('accept_org_invite', {p_token: token});
  raise(error, 'team.acceptInvite');
  if (!data) {
    throw new Error('That invite could not be accepted.');
  }
  return data as string;
}

// There is deliberately no setMemberRole. With two roles there is nothing to set:
// membership is the only role that can be granted, and ownership is held by
// whoever ran bootstrap_org. Transferring it is a separate feature with its own
// consequences for billing, and it does not exist yet.
//
// The database agrees rather than merely permitting this: 2026-08-10 dropped the
// UPDATE policy on org_members and revoked the grant, so there is no request
// this module could send that would change anybody's role.

// Removing someone frees their seat and nothing else. Their profiles, proxies
// and automations stay -- those belong to the organization, not to them, which
// is the whole point of the org-scoped model and what the confirm dialog says.
//
// The owner's own row cannot be deleted by anyone, including the owner: the
// policy carries `role <> 'owner'`, which is what stops a workspace being left
// with billing, data and nobody able to administer it.
export async function removeMember(orgId: string, userId: string): Promise<void> {
  const client = requireClient();
  const {data, error} = await client
      .from('org_members')
      .delete()
      .eq('org_id', orgId)
      .eq('user_id', userId)
      .select('user_id');
  raise(error, 'team.removeMember');
  if (!data || data.length === 0) {
    throw new Error('Only the owner can remove someone from the workspace.');
  }
}

// Leaving is a member removing their own row, and it works: org_members_delete
// carries `user_id = auth.uid()` as an alternative to being the owner.
//
// It did not before 2026-08-10 -- the policy was is_org_admin(org_id), so a plain
// member's delete matched nothing and returned success-with-no-rows, which is to
// say Leave was a button that quietly did nothing.
//
// The one person this still refuses is the owner, who has nowhere to hand the
// workspace to. The Team tab does not offer them the button.
export async function leaveOrg(orgId: string, userId: string): Promise<void> {
  const client = requireClient();
  const {data, error} = await client
      .from('org_members')
      .delete()
      .eq('org_id', orgId)
      .eq('user_id', userId)
      .select('user_id');
  raise(error, 'team.leaveOrg');
  if (!data || data.length === 0) {
    throw new Error('The owner cannot leave their own workspace.');
  }
}
