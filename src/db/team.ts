// Who else is in this organization, and how they got here.
//
// Separate from orgs.ts on purpose: that module answers "which tenant am I
// looking at" -- the switcher, the active id, the org's own settings. This one
// answers "who else is in it", which is a different question with a different
// audience (owners and admins) and a different failure mode.
//
// Three of these go through RPCs rather than table access, each for a reason
// that is not stylistic:
//
//   - listMembers, because org_members holds ids and nothing else and Supabase
//     does not expose auth.users to clients. A join from here renders uuids.
//   - createInvite, because the token has to be minted server-side (a
//     client-chosen token is a forgery surface) and the seat has to be reserved
//     in the same transaction as the check.
//   - acceptInvite, because org_members_insert is `with check
//     is_org_admin(org_id)`. An invitee is not an admin of the org they are
//     joining, so they can never insert their own membership row. This is the
//     only way in, and it is why the whole invite flow exists as SQL functions
//     rather than as three table writes.
//
// The rest are ordinary RLS-gated table access, following the same two rules
// the rest of src/db/ follows (see index.ts): orgId is always explicit, and
// every mutation touches one row.
import type {OrgInvite, OrgMember, OrgRole} from '../types';
import {optionalClient, raise, requireClient} from './client';
import {rowToInvite, rowToMember} from './mappers';
import type {OrgInviteRow, OrgMemberIdentityRow} from './rows';

const INVITE_COLUMNS =
  'id,org_id,email,role,token,status,invited_by,accepted_by,expires_at,created_at,accepted_at';

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
// Expired invites ARE returned: an admin needs to see that the link they sent
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
// Returns the token so the caller can build the link. This is the only moment
// it is available to the client; there is no email delivery, so if the admin
// closes the dialog without copying it they have to revoke and re-invite.
export async function createInvite(
    orgId: string, email: string, role: Exclude<OrgRole, 'owner'>): Promise<CreatedInvite> {
  const client = requireClient();
  const {data, error} = await client.rpc('create_org_invite', {
    p_org: orgId,
    p_email: email,
    p_role: role,
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
    throw new Error('Only an owner or admin can revoke an invite.');
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

// Roles are 'admin' or 'member'. Promotion to owner is not offered anywhere:
// ownership belongs to whoever created the org, and transferring it is a
// separate feature with its own consequences for billing.
export async function setMemberRole(
    orgId: string, userId: string, role: Exclude<OrgRole, 'owner'>): Promise<void> {
  const client = requireClient();
  const {data, error} = await client
      .from('org_members')
      .update({role})
      .eq('org_id', orgId)
      .eq('user_id', userId)
      .select('user_id');
  raise(error, 'team.setMemberRole');
  if (!data || data.length === 0) {
    throw new Error('Only an owner or admin can change roles.');
  }
}

// Removing someone frees their seat and nothing else. Their profiles, proxies
// and automations stay -- those belong to the organization, not to them, which
// is the whole point of the org-scoped model and what the confirm dialog says.
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
    throw new Error('Only an owner or admin can remove someone from the workspace.');
  }
}

// Leaving is a member removing their own row, which org_members_delete does NOT
// permit -- that policy is is_org_admin(org_id), so a plain member's delete
// matches nothing and returns success-with-no-rows.
//
// So this is honest about what it can do: an admin or owner can leave (their own
// delete passes the policy), and a member is told to ask. Making it work for
// everyone would need a fourth SECURITY DEFINER function, and "ask an admin to
// remove you" is a real answer rather than a broken button.
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
    throw new Error('Ask an owner or admin of this workspace to remove you.');
  }
}
