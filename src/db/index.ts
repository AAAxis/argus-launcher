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
// One exception to rule 1: `account` is the signed-in user's own record, which
// belongs to a person rather than to a tenant, so its functions take no orgId.
export * as account from './account';
export * as automations from './automations';
export * as bookmarks from './bookmarks';
export * as cookieSets from './cookieSets';
export * as extensions from './extensions';
export * as folders from './folders';
export * as orgs from './orgs';
export * as profiles from './profiles';
export * as proxies from './proxies';
export * as runs from './runs';
export * as statuses from './statuses';

export {CloudUnavailableError, STORAGE_BUCKET, supabase} from './client';
export {describeDbError} from './errors';
