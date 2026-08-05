// Which automations a profile's start page offers as tiles.
//
// One function because three places need the same answer and disagreeing would
// be silent: useProfileActions decides whether the launch needs a debugging
// port from it, buildLaunchPayload renders the tiles from it, and the Start
// page tab previews it. When the port and the tiles were worked out separately,
// a pinned automation could be drawn on a page that had no port to run it on.
//
// `pinned` is org-wide, which is why there is no join table: the per-profile
// slot is automation_id, and pinning is the many-to-many half.
import type {ArgusAutomation, ArgusProfile} from '../types';

export function startPageAutomations(
    automations: ArgusAutomation[],
    // Omitted on the Start page tab, which is previewing what every profile
    // gets rather than one profile's page: that is the pinned set alone.
    profile?: Pick<ArgusProfile, 'automation_id'>): ArgusAutomation[] {
  return automations.filter((item) =>
    item.pinned || (profile?.automation_id ? item.id === profile.automation_id : false));
}
