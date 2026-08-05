// Handing an item to a teammate.
//
// Worth being precise about what "share" means here, because the word invites
// the wrong reading. It is NOT a grant of access. Profiles, proxies, cookie
// sets and automations are scoped by org_id and by nothing else, so every
// member of the workspace can already see all of them -- there is no permission
// left to give. What a hand-off moves is responsibility: accepting sets the
// item's assigned_to to you.
//
// The approve step therefore guards consent rather than data. Work does not
// appear on your plate because somebody else decided it should.
//
// (This replaced a cross-organization design that copied a snapshot into the
// recipient's workspace. It was wrong twice: sharing outside the team is
// already served by CSV export, and inside the team a copy would hand somebody
// a duplicate of a row already on their screen. See the long note at the top of
// docs/schema-changes/2026-08-06-handoffs.sql.)
//
// Reads are ordinary RLS-gated table access -- handoffs_select is
// is_org_member, and both parties are in that org, so the launcher resolves
// their names from CloudState.members. Writes are all RPCs, because each one
// touches the offer and the item's assigned_to together and a client that could
// write handoffs directly could mark an offer accepted without ever taking the
// assignment.
import type {Handoff, HandoffKind} from '../types';
import {optionalClient, raise, requireClient} from './client';
import {rowToHandoff} from './mappers';
import type {HandoffRow} from './rows';

const COLUMNS =
  'id,org_id,kind,item_id,item_name,from_user,to_user,note,status,created_at,resolved_at';

// Every pending offer in the org, both directions.
//
// One read rather than an inbox call and an outbox call: handoffs_select
// already returns the whole org's rows, the list is small, and splitting it by
// to_user is a filter the caller can do for free. Two round trips for one small
// table would be the expensive way to ask the same question.
//
// Pending only. A declined offer is a decision already made and an accepted one
// is visible as the assignment itself -- neither belongs in a list whose job is
// "what still needs answering".
export async function listPending(orgId: string): Promise<Handoff[]> {
  const client = optionalClient();
  if (!client) {
    return [];
  }
  const {data, error} = await client
      .from('handoffs')
      .select(COLUMNS)
      .eq('org_id', orgId)
      .eq('status', 'pending')
      .order('created_at', {ascending: false});
  raise(error, 'shared.listPending');
  return ((data || []) as unknown as HandoffRow[]).map(rowToHandoff);
}

// Offers one or more items of a single kind to one teammate.
//
// One kind per call rather than a mixed basket: the entry points are per-tab,
// so a mixed hand-off is not reachable from the UI, and offer_handoff branches
// on kind to look each item's name up anyway.
//
// Raises cannot_share_with_yourself and not_a_teammate; describeDbError turns
// both into sentences.
export async function offer(
    orgId: string,
    kind: HandoffKind,
    ids: string[],
    toUserId: string,
    note?: string): Promise<number> {
  const client = requireClient();
  const {data, error} = await client.rpc('offer_handoff', {
    p_org: orgId,
    p_kind: kind,
    p_ids: ids,
    p_to: toUserId,
    p_note: note || null,
  });
  raise(error, 'shared.offer');
  return Array.isArray(data) ? data.length : 0;
}

// Takes the assignment. Cannot fail on a plan cap: this is an UPDATE of one
// column, not an insert, so unlike the copy model it never meets
// trg_profile_limit.
export async function accept(id: string): Promise<void> {
  const client = requireClient();
  const {error} = await client.rpc('accept_handoff', {p_id: id});
  raise(error, 'shared.accept');
}

export async function decline(id: string): Promise<void> {
  const client = requireClient();
  const {error} = await client.rpc('decline_handoff', {p_id: id});
  raise(error, 'shared.decline');
}

// Sender-side, pending only. After acceptance the assignment is real, and the
// way to undo it is to hand it back or clear it -- not to rewrite the offer
// that produced it.
export async function cancel(id: string): Promise<void> {
  const client = requireClient();
  const {error} = await client.rpc('cancel_handoff', {p_id: id});
  raise(error, 'shared.cancel');
}

// Point an item at somebody, or at nobody. `toUserId` is any member of the org
// or null to unassign.
//
// This used to refuse everyone but yourself, on the reasoning that work should
// not appear on a colleague's plate without their agreement. Dividing a shared
// pool turned out to be the common case and negotiating it row by row the rare
// one, so assignment is direct and offer() is what you reach for when you do
// want them to accept first. See 2026-08-07-assign-directly.sql.
//
// Raises not_a_teammate for a user id outside the org -- the guard that stops a
// row naming somebody who cannot see the workspace it lives in.
export async function setAssignee(
    orgId: string, kind: HandoffKind, itemId: string, toUserId: string | null): Promise<void> {
  const client = requireClient();
  const {error} = await client.rpc('set_assignee', {
    p_org: orgId,
    p_kind: kind,
    p_id: itemId,
    p_to: toUserId,
  });
  raise(error, 'shared.setAssignee');
}

// The same for many items at once, returning how many rows actually moved.
//
// One RPC rather than a loop over setAssignee: the caller is the import dialog
// pointing everything it just created at one person, and a two-hundred-profile
// import would otherwise be two hundred round trips that could fail
// individually and leave the batch half applied.
//
// An empty list is a no-op that returns 0, not an error -- a file whose every
// row updated an existing profile legitimately creates nothing to assign.
export async function setAssignees(
    orgId: string, kind: HandoffKind, itemIds: string[],
    toUserId: string | null): Promise<number> {
  const client = requireClient();
  const {data, error} = await client.rpc('set_assignees', {
    p_org: orgId,
    p_kind: kind,
    p_ids: itemIds,
    p_to: toUserId,
  });
  raise(error, 'shared.setAssignees');
  return typeof data === 'number' ? data : 0;
}
