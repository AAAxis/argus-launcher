// Everything that mutates automations, plus starting a run.
//
// Mirrors useProxyActions: local state is patched optimistically and the write
// goes through withDb, so a failure toasts once and the caller bails without a
// false success message.
import {useAutomationRuns} from '../hooks/useAutomationRuns';
import * as db from '../db';
import {buildLaunchPayload} from '../lib/launch';
import {native} from '../native';
import {newId} from './core';
import type {WorkspaceCore} from './core';
import type {ArgusAutomation, ArgusProfile} from '../types';
import type {AutomationVars, RunTrigger} from '../automations/types';

export type AutomationActions = ReturnType<typeof useAutomationActions>;

export function useAutomationActions(
    {data, toast}: WorkspaceCore,
    orgId: string | null,
    signedIn: boolean,
) {
  const {state, withDb, withDbError, patch} = data;
  const {runs, startRun, cancelRun} = useAutomationRuns(orgId, signedIn);

  function newAutomation(): ArgusAutomation {
    return {
      id: newId(),
      name: 'New automation',
      steps: [],
      variables: {},
      pinned: false,
      timeout_ms: 300000,
      close_on_finish: false,
    };
  }

  // create vs replace is the caller's call, never an upsert -- see the comment
  // in src/db/automations.ts for the BEFORE INSERT trigger this avoids.
  async function save(automation: ArgusAutomation, exists: boolean): Promise<string | null> {
    const error = await withDbError(
        (activeOrgId) => db.automations.save(activeOrgId, automation, exists));
    if (error) {
      return error;
    }
    patch.automations((list) => exists ?
      list.map((item) => item.id === automation.id ? automation : item) :
      [...list, automation]);
    return null;
  }

  async function remove(ids: string[]) {
    if (ids.length === 0) {
      return;
    }
    const ok = await withDb((activeOrgId) => db.automations.remove(activeOrgId, ids));
    if (!ok) {
      return;
    }
    patch.automations((list) => list.filter((item) => !ids.includes(item.id)));
    // The database detaches profiles for us (ON DELETE SET NULL), but local
    // state has to be told, or the profile row keeps showing a workflow that
    // no longer exists until the next reload.
    patch.profiles((list) => list.map((profile) =>
      profile.automation_id && ids.includes(profile.automation_id) ?
        {...profile, automation_id: null} :
        profile));
  }

  async function setPinned(automation: ArgusAutomation, pinned: boolean) {
    patch.automations((list) =>
      list.map((item) => item.id === automation.id ? {...item, pinned} : item));
    await withDb((activeOrgId) =>
      db.automations.update(activeOrgId, automation.id, {pinned}));
  }

  // Which automation runs when this profile launches. A bare UPDATE, so it
  // never fires trg_profile_limit.
  async function attach(profileId: string, automationId: string | null) {
    patch.profiles((list) => list.map((profile) =>
      profile.id === profileId ? {...profile, automation_id: automationId} : profile));
    await withDb((activeOrgId) =>
      db.profiles.update(activeOrgId, profileId, {automation_id: automationId}));
  }

  // Runs an automation against a profile, launching it first if it is not open.
  //
  // The launch goes through buildLaunchPayload like every other launch -- it is
  // the single seam, and routing around it is how a run would miss the proxy,
  // the fingerprint or the shared extensions. The debugging port is appended
  // only here, for this launch.
  async function run(
      automation: ArgusAutomation,
      profile: ArgusProfile,
      options: {trigger?: RunTrigger; vars?: AutomationVars} = {},
  ) {
    const bridge = native;
    if (!bridge) {
      toast.setMessage('Automation needs the desktop app.');
      return;
    }
    toast.setMessage(`Starting ${automation.name}`);
    const result = await startRun(automation, profile, {
      trigger: options.trigger,
      vars: options.vars,
      buildLaunch: async (cdpPort) => {
        // null rather than undefined: buildLaunchPayload distinguishes "no
        // proxy assigned" from "assigned but not found", and the second is
        // what a dangling proxy_id looks like.
        const proxy = state.proxies.find((item) => item.id === profile.proxy_id) || null;
        return bridge.launchProfile(
            buildLaunchPayload(profile, proxy, state),
            [`--remote-debugging-port=${cdpPort}`]);
      },
    });
    if (!result.ok) {
      toast.fail(`Couldn't run ${automation.name}`, result.error);
      return;
    }
    toast.setMessage(`Running ${automation.name}`);
  }

  return {runs, attach, newAutomation, remove, run, save, setPinned, cancelRun};
}
