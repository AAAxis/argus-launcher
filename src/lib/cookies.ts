import type {CloudState} from '../types';

// One-time backfill: profiles saved before the Cookies tab existed carry
// their cookie file only as cookie_import_url/name (no cookie_id), so they
// never show up in the shared library even though the profile clearly has
// cookies assigned. Promotes each such profile's existing import into its own
// library entry and points cookie_id at it, so the Cookies tab reflects what
// was already configured instead of appearing empty.
//
// Self-healing, not just one-time: it checks that cookie_id actually resolves
// to a real entry in `cookies`, not merely that it is set. Under the old blob
// schema a save could drop the whole `cookies` column while cookie_id -- which
// lived inside the profiles blob -- persisted fine, and a plain truthiness
// check then skipped those profiles forever, leaving the Cookies tab stuck
// empty. Relational rows make that exact failure impossible, but the resolve
// check is still the right test: a cookie set deleted by one worker leaves
// another worker's profile pointing at nothing, and this rebuilds it.
// A trashed set does not count as resolving, and is not a candidate to re-point
// at either. Both halves matter, and the second is the subtle one: without it,
// trashing a legacy set nulls the profile's cookie_id, the next load finds the
// (trashed) row already present so skips the insert -- and then still returns
// the profile pointed back at it, which useCloudData writes to the database.
// The delete would silently undo itself on the next window focus.
export function migrateLegacyCookieImports(state: CloudState) {
  let migrated = 0;
  const cookies = [...state.cookies];
  const isLive = (id: string | null | undefined) =>
    Boolean(id) && cookies.some((cookie) => cookie.id === id && !cookie.deleted_at);
  const profiles = state.profiles.map((profile) => {
    if (isLive(profile.cookie_id) || !profile.cookie_import_url) {
      return profile;
    }
    const id = profile.cookie_id || `legacy:${profile.id}`;
    const existing = cookies.find((cookie) => cookie.id === id);
    if (existing?.deleted_at) {
      // Trashed on purpose. Restoring it is the user's call, not ours.
      return profile;
    }
    if (!existing) {
      cookies.push({
        id,
        name: profile.cookie_import_name || `${profile.name} cookies`,
        url: profile.cookie_import_url,
        count: profile.cookie_import_count ?? null,
        tags: [],
        folder_id: null,
      });
    }
    migrated++;
    return {...profile, cookie_id: id, cookie_mode: 'saved' as const};
  });
  return {state: {...state, profiles, cookies}, migrated};
}
