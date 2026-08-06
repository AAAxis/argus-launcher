// Where a live-cookie push from a running profile lands: the one decision that
// must agree between the bridge (which writes) and anyone reading the Cookies
// tab. Kept as a pure function so the six ways it can go are unit-tested
// without a workspace.
import type {ArgusCookie, ArgusProfile} from '../types';

export function liveSetName(profileName: string): string {
  return `${profileName} (live)`;
}

// The assigned set is only "ours to overwrite" when this flow created it --
// recognized by the naming convention, in both spellings (addCookieSet derives
// the set name from the uploaded file name, which carries .json). Anything
// else -- an ordinary library set, a trashed set, a set named for a profile
// that has since been renamed -- gets a fresh set rather than a surprise
// overwrite of something the user curated by hand.
export function resolveLiveSetAction(
    profile: ArgusProfile,
    sets: ArgusCookie[],
): {kind: 'update'; set: ArgusCookie} | {kind: 'create'; name: string} {
  const name = liveSetName(profile.name);
  const assigned = profile.cookie_mode === 'saved' && profile.cookie_id ?
    sets.find((item) => item.id === profile.cookie_id && !item.deleted_at) :
    null;
  if (assigned && (assigned.name === name || assigned.name === `${name}.json`)) {
    return {kind: 'update', set: assigned};
  }
  return {kind: 'create', name};
}
