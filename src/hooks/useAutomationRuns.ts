// Live run state, and the only place runs are written to the database.
//
// The main process drives the browser but holds no Supabase credentials, so it
// streams events here and this hook persists them. That keeps
// docs/process-boundary.md true and means a run's record is written by whoever
// is signed in, under their RLS.
//
// Three things this has to get right:
//
//   1. A run is inserted when it STARTS, not when it finishes. A row that only
//      appears on success means a killed run leaves no trace, and "did last
//      night's run work" has no answer.
//   2. If the window was closed or signed out when a run ended, there is no row
//      to update -- the runner buffered it to disk instead. flushPending()
//      upserts those on mount. That is what makes history honest rather than
//      best-effort.
//   3. Log entries arrive one at a time and can run to thousands. They are kept
//      in a ref and mirrored into state on a timer, because setState per entry
//      would re-render the log viewer on every step of every run.
import {useCallback, useEffect, useRef, useState} from 'react';
import * as db from '../db';
import {describeDbError} from '../db';
import {native} from '../native';
import type {ArgusAutomation, ArgusProfile, AutomationRun} from '../types';
import type {AutomationVars, RunLogEntry, RunTrigger} from '../automations/types';

const FLUSH_INTERVAL_MS = 400;

export type StartRunResult =
  | {ok: true; runId: string}
  | {ok: false; error: string};

export function useAutomationRuns(orgId: string | null, signedIn: boolean) {
  // runId -> run, for anything in flight or just finished this session.
  const [runs, setRuns] = useState<Record<string, AutomationRun>>({});
  const pending = useRef<Record<string, AutomationRun>>({});
  const dirty = useRef(false);
  const orgRef = useRef(orgId);
  orgRef.current = orgId;

  // Mirror the ref into state on a timer rather than per event.
  useEffect(() => {
    const timer = setInterval(() => {
      if (!dirty.current) {
        return;
      }
      dirty.current = false;
      setRuns({...pending.current});
    }, FLUSH_INTERVAL_MS);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!native?.onAutomationRunEvent) {
      return undefined;
    }
    return native.onAutomationRunEvent((event) => {
      const org = orgRef.current;
      if (event.type === 'started') {
        pending.current[event.runId] = event.run;
        dirty.current = true;
        // Insert immediately. A failure here is not fatal to the run -- the
        // runner has already buffered it to disk and the flush will pick it up.
        if (org) {
          void db.runs.start(org, event.run).catch(() => undefined);
        }
        return;
      }
      if (event.type === 'log') {
        const run = pending.current[event.runId];
        if (run) {
          run.log = [...run.log, event.entry as RunLogEntry];
          dirty.current = true;
        }
        return;
      }
      pending.current[event.runId] = event.run;
      dirty.current = true;
      if (org) {
        // upsert, not update: if the insert above failed (offline, signed out)
        // there is no row to update and the run would vanish.
        void db.runs.upsertFinished(org, event.run)
            .then(() => native?.markAutomationRunFlushed?.(event.runId))
            .catch(() => undefined);
      }
    });
  }, []);

  // Runs that finished on disk but never reached the database.
  const flushPending = useCallback(async () => {
    if (!orgId || !signedIn || !native?.pendingAutomationRuns) {
      return;
    }
    try {
      const buffered = await native.pendingAutomationRuns();
      for (const run of buffered) {
        if ((run as AutomationRun & {flushed?: boolean}).flushed) {
          continue;
        }
        await db.runs.upsertFinished(orgId, run);
        await native.markAutomationRunFlushed?.(run.id);
      }
    } catch {
      // Offline or unreadable. The buffer stays on disk for next time --
      // losing it would be worse than retrying.
    }
  }, [orgId, signedIn]);

  // Rejoin anything already running, so reopening the window mid-run shows it.
  const adoptActive = useCallback(async () => {
    if (!native?.activeAutomationRuns) {
      return;
    }
    try {
      const active = await native.activeAutomationRuns();
      for (const run of active) {
        pending.current[run.id] = run;
      }
      if (active.length > 0) {
        dirty.current = true;
      }
    } catch {
      // Nothing in flight, or main is not answering yet.
    }
  }, []);

  useEffect(() => {
    void flushPending();
    void adoptActive();
  }, [flushPending, adoptActive]);

  // Starts a run against a profile, launching it first when it is not open.
  //
  // Reuses an existing session rather than relaunching: a manual Run against a
  // profile the user already has open must not kill their window, and
  // spawnProfileUnchecked pkills the profile before spawning.
  const startRun = useCallback(async (
      automation: ArgusAutomation,
      profile: ArgusProfile,
      options: {
        trigger?: RunTrigger;
        vars?: AutomationVars;
        buildLaunch?: (cdpPort: number) => Promise<{ok: boolean; error?: string}>;
      } = {},
  ): Promise<StartRunResult> => {
    if (!native?.startAutomationRun || !native?.resolveProfileCdp) {
      return {ok: false, error: 'Automation needs the desktop app.'};
    }
    try {
      let session = await native.resolveProfileCdp(profile.id);
      if (!session.running) {
        if (!options.buildLaunch) {
          return {ok: false, error: `${profile.name} is not open.`};
        }
        const port = await native.reserveCdpPort?.();
        if (!port) {
          return {ok: false, error: 'Could not allocate a debugging port.'};
        }
        const launched = await options.buildLaunch(port);
        if (!launched.ok) {
          return {ok: false, error: launched.error || 'The profile did not launch.'};
        }
        session = await native.resolveProfileCdp(profile.id);
        if (!session.running || !session.cdpUrl) {
          return {ok: false, error: 'The browser started but never answered on its debugging port.'};
        }
      }
      const result = await native.startAutomationRun({
        automation,
        profile,
        trigger: options.trigger || 'manual',
        cdpUrl: session.cdpUrl as string,
        vars: options.vars,
      });
      if (!result.ok || !result.runId) {
        return {ok: false, error: result.error || 'The run did not start.'};
      }
      return {ok: true, runId: result.runId};
    } catch (error) {
      return {ok: false, error: describeDbError(error, 'The run did not start.')};
    }
  }, []);

  const cancelRun = useCallback(async (runId: string) => {
    await native?.cancelAutomationRun?.(runId);
  }, []);

  return {runs, startRun, cancelRun, flushPending};
}
