import type {ArgusOrg, BuiltInExtensionToggles, OrgMembership, OrgRole} from '../types';
import {optionalClient, raise, requireClient} from './client';
import {rowToOrg} from './mappers';
import type {OrganizationRow} from './rows';

// Every organization the signed-in user belongs to, oldest membership first.
//
// The .eq('user_id') is load-bearing, not belt-and-braces: RLS on org_members
// is is_org_member(org_id), which exposes *every* member of your orgs, not just
// your own row. Without the filter a three-person org would come back three
// times and the switcher would list it three times.
export async function listMyOrgs(): Promise<OrgMembership[]> {
  const client = optionalClient();
  if (!client) {
    return [];
  }
  const {data: userData} = await client.auth.getUser();
  const userId = userData.user?.id;
  if (!userId) {
    return [];
  }
  const {data, error} = await client
      .from('org_members')
      .select('role, organizations(id,name,plan,profile_limit,seat_limit,billing_status,' +
        'current_period_end,created_at,built_in_extensions,automation_limit)')
      .eq('user_id', userId)
      .order('created_at', {ascending: true});
  raise(error, 'listMyOrgs');
  const rows = (data || []) as unknown as Array<{
    role: string;
    organizations: OrganizationRow | null;
  }>;
  return rows
      .filter((row) => Boolean(row.organizations))
      .map((row) => ({
        org: rowToOrg(row.organizations as OrganizationRow),
        role: (row.role as OrgRole) || 'member',
      }));
}

// How many seats the org is using, for the usage meter in Settings. RLS on
// org_members exposes every member of an org you belong to, so this counts the
// whole team rather than just you -- which is the number seat_limit is compared
// against by trg_seat_limit on insert.
export async function countMembers(orgId: string): Promise<number> {
  const client = optionalClient();
  if (!client) {
    return 0;
  }
  const {count, error} = await client
      .from('org_members')
      .select('user_id', {count: 'exact', head: true})
      .eq('org_id', orgId);
  raise(error, 'orgs.countMembers');
  return count || 0;
}

export async function getOrg(orgId: string): Promise<ArgusOrg | null> {
  const client = optionalClient();
  if (!client) {
    return null;
  }
  const {data, error} = await client
      .from('organizations')
      .select('id,name,plan,profile_limit,seat_limit,billing_status,current_period_end,' +
        'created_at,built_in_extensions,automation_limit')
      .eq('id', orgId)
      .maybeSingle();
  raise(error, 'getOrg');
  return data ? rowToOrg(data as unknown as OrganizationRow) : null;
}

// The only way a client can create an organization: `organizations` has no
// INSERT policy and no INSERT grant, so a plain insert is refused by design.
// bootstrap_org is SECURITY DEFINER and idempotent -- it returns the caller's
// existing org when there is one -- which makes it safe to call on every
// sign-in rather than only when the membership list comes back empty.
export async function createOrg(name?: string): Promise<string> {
  const client = requireClient();
  const {data, error} = await client.rpc('bootstrap_org', name ? {org_name: name} : {});
  raise(error, 'bootstrap_org');
  if (!data) {
    throw new Error('bootstrap_org returned no organization id');
  }
  return data as string;
}

// Org-wide settings. RLS restricts UPDATE on organizations to is_org_admin, and
// 0002/0005 further narrow the column grant to (name, built_in_extensions) --
// plan, limits and billing_status are service-role only, so a client cannot
// grant itself a higher tier.
export async function rename(orgId: string, name: string): Promise<void> {
  const client = requireClient();
  const {error} = await client.from('organizations').update({name}).eq('id', orgId);
  raise(error, 'orgs.rename');
}

// The payload is exactly one column because 0002 revoked UPDATE on
// organizations and re-granted it per column -- a spread of the whole org row
// would be rejected outright.
//
// The .select() is what turns a member's attempt into a visible failure. RLS
// filters the row rather than erroring, so an unprivileged update comes back
// as success-with-no-rows; asking for the row back makes that an error we can
// report instead of a toggle that flips locally and reverts on next load.
export async function updateBuiltInExtensions(
    orgId: string, value: BuiltInExtensionToggles): Promise<void> {
  const client = requireClient();
  const {data, error} = await client
      .from('organizations')
      .update({built_in_extensions: value})
      .eq('id', orgId)
      .select('id');
  raise(error, 'orgs.updateBuiltInExtensions');
  if (!data || data.length === 0) {
    throw new Error('Only an owner or admin can change bundled extensions for this organization.');
  }
}

// The active org id, persisted so a restart lands where the user left off.
const ACTIVE_ORG_KEY = 'argus.activeOrgId';

export function currentOrgId(): string | null {
  try {
    return window.localStorage.getItem(ACTIVE_ORG_KEY);
  } catch {
    return null;
  }
}

export function setCurrentOrgId(orgId: string | null): void {
  try {
    if (orgId) {
      window.localStorage.setItem(ACTIVE_ORG_KEY, orgId);
    } else {
      window.localStorage.removeItem(ACTIVE_ORG_KEY);
    }
  } catch {
    // Private-mode / disabled storage: the switcher still works for this run.
  }
}
