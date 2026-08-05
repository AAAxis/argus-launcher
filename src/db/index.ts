// The launcher's data layer. Everything that talks to Supabase lives under
// src/db/ -- main.tsx holds no queries of its own.
//
// Two rules the whole layer follows:
//   1. every function takes `orgId` explicitly, and every query filters on it
//      even though RLS enforces the same thing. A query without an org_id
//      filter is a bug; the belt-and-braces version also keeps the planner on
//      the org index.
//   2. every mutation touches exactly one row. There is no read-modify-write of
//      an array anywhere, which is what makes two workers editing different
//      profiles structurally unable to clobber each other.
// Two exceptions to rule 1. `account` is the signed-in user's own record, which
// belongs to a person rather than to a tenant. And `shared.listInbox` is
// addressed to an EMAIL rather than to an org -- an incoming share exists
// before the recipient has chosen which of their workspaces to put it in, so
// there is no org to filter on until they accept.
export * as account from './account';
export * as aiProviders from './aiProviders';
export * as automations from './automations';
export * as bookmarks from './bookmarks';
export * as cookieSets from './cookieSets';
export * as extensions from './extensions';
export * as folders from './folders';
export * as orgs from './orgs';
export * as profiles from './profiles';
export * as proxies from './proxies';
export * as runs from './runs';
export * as shared from './shared';
export * as statuses from './statuses';
export * as team from './team';

export {CloudUnavailableError, STORAGE_BUCKET, supabase} from './client';
export {describeDbError} from './errors';
