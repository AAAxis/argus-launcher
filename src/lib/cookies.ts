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
export function migrateLegacyCookieImports(state: CloudState) {
  let migrated = 0;
  const cookies = [...state.cookies];
  const profiles = state.profiles.map((profile) => {
    const hasValidCookieId =
      profile.cookie_id && cookies.some((cookie) => cookie.id === profile.cookie_id);
    if (hasValidCookieId || !profile.cookie_import_url) {
      return profile;
    }
    const id = profile.cookie_id || `legacy:${profile.id}`;
    if (!cookies.some((cookie) => cookie.id === id)) {
      cookies.push({
        id,
        name: profile.cookie_import_name || `${profile.name} cookies`,
        url: profile.cookie_import_url,
        count: profile.cookie_import_count ?? null,
      });
    }
    migrated++;
    return {...profile, cookie_id: id, cookie_mode: 'saved' as const};
  });
  return {state: {...state, profiles, cookies}, migrated};
}
