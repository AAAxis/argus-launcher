// Which profile an automation acts on when the user has not said.
//
// Two places need the same answer and must not drift: the Run button on the
// Automations tab, and the Check button in the step editor, which tests a
// selector against a live page and therefore has to agree about which page
// that is. Checking one profile and running against another is the kind of
// disagreement nobody notices until a selector that "passed" fails every run.
import type {ArgusAutomation, ArgusProfile, CloudState} from '../types';

// The profile this automation runs on launch when there is exactly one, and
// otherwise whatever is highlighted on the Profiles tab. Anything more
// ambiguous than that is the user's call to make, so the caller says so rather
// than guessing -- which is why null is a normal answer here, not a failure.
export function runTarget(
    state: CloudState,
    automation: ArgusAutomation | null,
    selectedProfileId: string | null,
): ArgusProfile | null {
  const attached = automation ?
    state.profiles.filter(
        (profile) => !profile.deleted_at && profile.automation_id === automation.id) :
    [];
  if (attached.length === 1) {
    return attached[0];
  }
  return state.profiles.find(
      (profile) => profile.id === selectedProfileId && !profile.deleted_at) || null;
}
