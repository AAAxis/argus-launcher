// Where a live-cookie push from a running profile lands: the one decision that
// must agree between the bridge (which writes) and anyone reading the Cookies
// tab. Kept as a pure function so the six ways it can go are unit-tested
// without a workspace.
import type {ArgusCookie, ArgusProfile} from '../types';

export function liveSetName(profileName: string): string {
  return `${profileName} (live)`;
}

// What a launch actually consumes, resolved the one way that agrees with
// buildLaunchPayload (src/lib/launch.ts) and with the cookie-sync pull route:
// 'saved' mode with a cookie_id that still resolves to a non-trashed row.
// 'paste' mode ignores cookie_id entirely -- a profile can carry a stale one
// from before it was switched back, and mode is what decides whether that id
// means anything, not whether it happens to be set.
//
// Kept here (not duplicated per caller) because it is the load-bearing half
// of resolveLiveSetAction below: matching by id first is what stops a push
// from one profile ever landing on a different profile's or the library's
// same-named set.
export function assignedSet(profile: ArgusProfile, sets: ArgusCookie[]): ArgusCookie | null {
  if (profile.cookie_mode !== 'saved' || !profile.cookie_id) {
    return null;
  }
  return sets.find((item) => item.id === profile.cookie_id && !item.deleted_at) || null;
}

// The assigned set is only "ours to overwrite" when this flow created it --
// recognized by the naming convention, in both spellings (addCookieSet derives
// the set name from the uploaded file name, which carries .json). Anything
// else -- an ordinary library set, a trashed set, a set named for a profile
// that has since been renamed -- gets a fresh set rather than a surprise
// overwrite of something the user curated by hand.
//
// Matching starts from assignedSet (by id), not by scanning `sets` for a
// name match: two profiles can perfectly legally share a name (and so the
// same "«name» (live)" convention), and a name-only match would let profile
// A's push overwrite profile B's live set, or a stray same-named library set
// that neither profile owns.
export function resolveLiveSetAction(
    profile: ArgusProfile,
    sets: ArgusCookie[],
): {kind: 'update'; set: ArgusCookie} | {kind: 'create'; name: string} {
  const name = liveSetName(profile.name);
  const assigned = assignedSet(profile, sets);
  if (assigned && (assigned.name === name || assigned.name === `${name}.json`)) {
    return {kind: 'update', set: assigned};
  }
  return {kind: 'create', name};
}
