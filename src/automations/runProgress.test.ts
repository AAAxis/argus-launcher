// Run progress, tested against the real module the runner and the loopback
// status route both call (electron/automation/progress.cjs, typed by its
// hand-written .d.cts) rather than a copy -- nothing compiles electron/, but
// vitest can import it directly. The same arrangement redactSecrets.test.ts uses.
//
// Every case here is one the side panel renders differently, and every one of
// them is silent when wrong: a bar is a bar whether or not the number behind it
// means anything.
import {describe, expect, it} from 'vitest';
import {currentStepOf, progressOf, runSummary} from '../../electron/automation/progress.cjs';

describe('progressOf', () => {
  it('reports a fraction of the declared top-level steps', () => {
    expect(progressOf({total_steps: 4, step_count: 1})).toBe(0.25);
    expect(progressOf({total_steps: 4, step_count: 4})).toBe(1);
  });

  it('starts at zero rather than at null', () => {
    expect(progressOf({total_steps: 4, step_count: 0})).toBe(0);
  });

  // The case that makes this a function rather than a division at the call site.
  // total_steps counts only the top-level steps, so a loop or a callAutomation
  // runs steps that were never in the denominator -- a run of six declared steps
  // whose third iterates forty rows would report 700%.
  it('gives up rather than exceed 1 when a loop overshoots the denominator', () => {
    expect(progressOf({total_steps: 6, step_count: 7})).toBeNull();
    expect(progressOf({total_steps: 6, step_count: 46})).toBeNull();
  });

  it('gives up when there is no denominator', () => {
    expect(progressOf({total_steps: 0, step_count: 0})).toBeNull();
    expect(progressOf({step_count: 3})).toBeNull();
    expect(progressOf({})).toBeNull();
    expect(progressOf(null)).toBeNull();
    expect(progressOf(undefined)).toBeNull();
  });

  // A record old enough to predate total_steps reads as absent, not as zero
  // progress -- runs written before this field existed are still in the disk
  // mirror under <userData>/AutomationRuns/ and still get flushed.
  it('reads a record with no total_steps as indeterminate', () => {
    expect(progressOf({id: 'run_1', step_count: 2, status: 'running'})).toBeNull();
  });

  it('never returns a negative fraction from a corrupt count', () => {
    expect(progressOf({total_steps: 4, step_count: -2})).toBe(0);
  });
});

describe('currentStepOf', () => {
  it('reads the last thing the run said it was doing', () => {
    expect(currentStepOf({log: [
      {level: 'info', message: 'Go to example.com'},
      {level: 'info', message: 'Fill #email'},
    ]})).toBe('Fill #email');
  });

  // A retry's warning is exactly what someone watching a stalled run needs to
  // see. Skipping back to the last `info` would hide the only line explaining
  // why the bar has not moved for thirty seconds.
  it('keeps a warning or an error rather than skipping back to the last info', () => {
    expect(currentStepOf({log: [
      {level: 'info', message: 'Fill #email'},
      {level: 'warn', message: 'Wait for #otp failed (attempt 1): timed out'},
    ]})).toBe('Wait for #otp failed (attempt 1): timed out');
  });

  it('skips an entry with no message rather than reporting a blank', () => {
    expect(currentStepOf({log: [
      {level: 'info', message: 'Fill #email'},
      {level: 'info'},
      {level: 'info', message: ''},
    ]})).toBe('Fill #email');
  });

  it('is empty for a run that has not logged anything yet', () => {
    expect(currentStepOf({log: []})).toBe('');
    expect(currentStepOf({})).toBe('');
    expect(currentStepOf(null)).toBe('');
  });
});

describe('runSummary', () => {
  const record = {
    id: 'run_abc',
    automation_id: 'a1',
    automation_name: 'Daily login',
    profile_id: 'p1',
    profile_name: 'Sophia Bennett',
    trigger: 'panel',
    status: 'running',
    started_at: '2026-08-09T01:00:00.000Z',
    finished_at: null,
    step_count: 3,
    total_steps: 12,
    error: null,
    vars: {password: 'hunter2'},
    log: [{level: 'info', message: 'Fill #password'}],
  };

  it('reduces a record to what a watcher is shown', () => {
    expect(runSummary(record)).toEqual({
      runId: 'run_abc',
      status: 'running',
      automationId: 'a1',
      automationName: 'Daily login',
      trigger: 'panel',
      startedAt: '2026-08-09T01:00:00.000Z',
      finishedAt: null,
      stepCount: 3,
      totalSteps: 12,
      progress: 0.25,
      currentStep: 'Fill #password',
      error: null,
    });
  });

  // The reduction is the point. The record carries the vars bag and the full
  // step log -- selectors, urls, typed values -- and this crosses a loopback
  // socket to a browser window once a second. Not sending them is stronger than
  // sending them masked, so this asserts they are absent rather than redacted.
  it('carries neither the vars bag nor the log', () => {
    const summary = runSummary(record) as unknown as Record<string, unknown>;
    expect(summary.vars).toBeUndefined();
    expect(summary.log).toBeUndefined();
    expect(JSON.stringify(summary)).not.toContain('hunter2');
  });

  it('keeps the runner\'s own wording for a failure', () => {
    const summary = runSummary({
      ...record,
      status: 'failed',
      error: 'Fill #password: no element matched #password',
    });
    expect(summary!.status).toBe('failed');
    expect(summary!.error).toBe('Fill #password: no element matched #password');
  });

  it('is null for no record, so a caller cannot mistake it for an idle run', () => {
    expect(runSummary(null)).toBeNull();
    expect(runSummary(undefined)).toBeNull();
  });
});
