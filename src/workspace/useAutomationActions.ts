// Everything that mutates automations, plus starting a run.
//
// Mirrors useProxyActions: local state is patched optimistically and the write
// goes through withDb, so a failure toasts once and the caller bails without a
// false success message.
import {useRef} from 'react';
import {useAutomationRuns} from '../hooks/useAutomationRuns';
import * as db from '../db';
import {buildLaunchPayload} from '../lib/launch';
import {mapWithConcurrency} from '../lib/concurrency';
import {native} from '../native';
import {SHOWCASE_AUTOMATION} from '../data/showcaseAutomation';
import {RUN_CONCURRENCY, runWaitCeiling} from '../automations/limit';
import {newId} from './core';
import type {WorkspaceCore} from './core';
import type {ProxyActions} from './useProxyActions';
import type {ArgusAutomation, ArgusProfile} from '../types';
import type {AutomationVars, RunTrigger} from '../automations/types';

export type AutomationActions = ReturnType<typeof useAutomationActions>;

export function useAutomationActions(
    {data, toast}: WorkspaceCore,
    // The pre-launch proxy gate. Taken as a dependency rather than reading
    // state.proxies directly so a run is blocked by the same check a manual
    // launch is -- see resolveForLaunch.
    proxies: ProxyActions,
    orgId: string | null,
    signedIn: boolean,
) {
  const {state, withDb, withDbError, patch} = data;
  const {runs, startRun, cancelRun, waitForRun} = useAutomationRuns(orgId, signedIn);
  // automationId -> the profile it last ran on, this session. State the editor's
  // Check button reads through runTarget so it tests a selector against the page
  // the last run actually used. A ref, not state: nothing re-renders on it, and
  // it is written from inside an in-flight run.
  const lastRunProfileIds = useRef<Record<string, string>>({});

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

  // The pre-written example, minted the same way a blank one is.
  //
  // The id is added here rather than baked into src/data/showcaseAutomation.ts:
  // it becomes a directory name under <userData>/AutomationRuns/, so a constant
  // would hand every org the same one and make loading the example twice a
  // primary-key collision instead of two independent rows.
  //
  // Deep-cloned, not spread. The template is a module-level constant and its
  // steps are nested arrays that the editor edits in place -- a shallow copy
  // would let the first person who edits the example rewrite what everyone
  // loads next, for the rest of the session.
  function exampleAutomation(): ArgusAutomation {
    return {...structuredClone(SHOWCASE_AUTOMATION), id: newId()};
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
  // `quiet` is for a batch. toast.fail does not raise a banner -- it opens a
  // blocking ErrorModal (hooks/useToast.ts) -- so five failed runs would be
  // five stacked dialogs to dismiss. runMany collects the failures and says it
  // once instead.
  async function run(
      automation: ArgusAutomation,
      profile: ArgusProfile,
      options: {trigger?: RunTrigger; vars?: AutomationVars; quiet?: boolean} = {},
  ) {
    const bridge = native;
    if (!bridge) {
      const error = 'Automation needs the desktop app.';
      if (!options.quiet) {
        toast.setMessage(error);
      }
      return {ok: false as const, error};
    }
    if (!options.quiet) {
      toast.setMessage(`Starting ${automation.name}`);
    }
    const result = await startRun(automation, profile, {
      trigger: options.trigger,
      vars: options.vars,
      buildLaunch: async (cdpPort) => {
        // The same gate the Launch button goes through, rather than reading
        // the proxy straight off state. This path used to do the latter, which
        // is how a dead proxy first showed up as a failed run several seconds
        // in, reported by the main process in a sentence naming a profile the
        // user never picked. resolveForLaunch checks it here, where the failure
        // can be attributed and shown, and returns 'blocked' when it must not
        // launch. null is a legitimate answer -- direct and free-proxy modes
        // have no proxy to resolve.
        const proxy = await proxies.resolveForLaunch(profile);
        if (proxy === 'blocked') {
          return {ok: false, error: `${profile.name}'s proxy failed its check.`};
        }
        return bridge.launchProfile(
            buildLaunchPayload(profile, proxy, state),
            [`--remote-debugging-port=${cdpPort}`]);
      },
    });
    if (!result.ok) {
      if (!options.quiet) {
        toast.fail(`Couldn't run ${automation.name}`, result.error);
      }
      return result;
    }
    // Recorded on every successful start, whatever triggered it -- manual,
    // on-launch or an agent over the local API. The editor's Check button reads
    // it so it tests against the page this automation last ran on.
    lastRunProfileIds.current[automation.id] = profile.id;
    if (!options.quiet) {
      toast.setMessage(`Running ${automation.name}`);
    }
    // Returned as well as toasted: the API bridge answers its HTTP caller with
    // the run id, and a toast is no use to an agent.
    return result;
  }

  // One automation across several profiles, RUN_CONCURRENCY at a time.
  //
  // Paced on each run FINISHING, not on it starting. startRun resolves as soon
  // as the runner has accepted the run -- execute() is deliberately not awaited
  // over there -- so a queue built on startRun alone would launch every profile
  // at once and hit the runner's own cap, which refuses with a 429 instead of
  // waiting. waitForRun is what turns that cap into a queue.
  async function runMany(
      automation: ArgusAutomation,
      list: ArgusProfile[],
      options: {trigger?: RunTrigger; vars?: AutomationVars} = {},
  ) {
    if (list.length === 0) {
      return {started: 0, failed: 0};
    }
    if (list.length === 1) {
      // One profile is not a batch: it keeps the live messages and the real
      // error dialog, which are more use than a summary counting to one.
      const single = await run(automation, list[0], options);
      return {started: single.ok ? 1 : 0, failed: single.ok ? 0 : 1};
    }
    toast.setMessage(
        `Running ${automation.name} on ${list.length} profiles · ${RUN_CONCURRENCY} at a time`);
    const ceiling = runWaitCeiling(automation.timeout_ms);
    let started = 0;
    const failures: string[] = [];
    await mapWithConcurrency(list, RUN_CONCURRENCY, async (profile) => {
      const result = await run(automation, profile, {...options, quiet: true});
      if (!result.ok) {
        failures.push(`${profile.name}: ${result.error}`);
        return;
      }
      started++;
      // Holds this queue slot until the run ends. Null means the ceiling was
      // reached rather than the run failing -- the slot is given away, but the
      // run itself is still going and still writes its own record, so counting
      // it as a failure here would be a lie.
      await waitForRun(result.runId, ceiling);
    });
    if (failures.length) {
      // One dialog for the batch, with every profile that could not start named
      // in the detail -- the per-run history has the rest.
      toast.fail(
          `${started} of ${list.length} runs started`,
          failures.join('\n'));
    } else {
      toast.notify(`${started} runs finished · ${automation.name}`, {tone: 'ok'});
    }
    return {started, failed: failures.length};
  }

  return {
    runs, attach, exampleAutomation, newAutomation, remove, run, runMany, save, setPinned,
    cancelRun,
    lastRunProfileId: (automationId: string) => lastRunProfileIds.current[automationId] || null,
  };
}
