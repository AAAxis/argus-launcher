// The Automations tab's run card, from the angle a test can reach without a DOM.
//
// vitest runs here with no environment (see vite.config.ts), so paintRunCard is
// out of reach -- it is attribute assignments over these functions, and what
// needs a real layout (320px, the sweep animation, the tone colours) is what
// scripts/preview-panel.mjs is for. What is left is the phrasing, the bar and the
// clock, which is where this has room to be wrong without anything throwing.
//
// The arithmetic behind `run.progress` itself lives in
// electron/automation/progress.cjs and has its own test; this is about what the
// panel does with the answer -- especially the null one.
import {describe, expect, it} from 'vitest';
// @ts-expect-error plain-JS extension module without types
import runView from '../../extensions/cookie-manager/run-view.js';

const {bar, describe: describeRun, elapsed, meta, step} = runView;

// A summary as electron/automation/progress.cjs composes it.
const running = {
  runId: 'run_1',
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
};
const AT = Date.parse('2026-08-09T01:00:24.000Z');

describe('elapsed', () => {
  it('counts m:ss with two-digit seconds', () => {
    expect(elapsed('2026-08-09T01:00:00.000Z', Date.parse('2026-08-09T01:00:04.000Z')))
        .toBe('0:04');
    expect(elapsed('2026-08-09T01:00:00.000Z', Date.parse('2026-08-09T01:09:30.000Z')))
        .toBe('9:30');
  });

  it('grows to h:mm:ss past an hour', () => {
    expect(elapsed('2026-08-09T01:00:00.000Z', Date.parse('2026-08-09T02:05:07.000Z')))
        .toBe('1:05:07');
  });

  // Says nothing rather than claiming a run just started. A summary with no
  // startedAt is a bug somewhere else, and '0:00' would hide it behind a plausible
  // reading.
  it('is empty for an unparseable or missing start', () => {
    expect(elapsed('', AT)).toBe('');
    expect(elapsed(undefined, AT)).toBe('');
    expect(elapsed('not a date', AT)).toBe('');
  });

  it('is empty rather than negative for a start in the future', () => {
    expect(elapsed('2026-08-09T01:00:30.000Z', Date.parse('2026-08-09T01:00:00.000Z')))
        .toBe('');
  });
});

describe('bar', () => {
  it('reports the percentage of a live run', () => {
    expect(bar(running)).toEqual({percent: 25, indeterminate: false});
  });

  // The case the whole indeterminate path exists for: a loop or a callAutomation
  // pushes step_count past the declared total, progressOf gives up, and the bar
  // has to admit it cannot say rather than pinning at 100% for the rest of the run.
  it('goes indeterminate when there is no honest position', () => {
    expect(bar({...running, progress: null})).toEqual({percent: 0, indeterminate: true});
  });

  // A bar frozen at 58% under the words "Daily login failed" invites the reading
  // that it is still going.
  it('fills completely for every finished run, whatever its own arithmetic said', () => {
    for (const status of ['ok', 'partial', 'failed', 'cancelled']) {
      expect(bar({...running, status, progress: 0.58}))
          .toEqual({percent: 100, indeterminate: false});
    }
    // Including one that never had a position to begin with.
    expect(bar({...running, status: 'failed', progress: null}))
        .toEqual({percent: 100, indeterminate: false});
  });

  it('is empty and determinate with no run at all', () => {
    expect(bar(null)).toEqual({percent: 0, indeterminate: false});
  });
});

describe('step', () => {
  it('shows what the run last did while it is live', () => {
    expect(step(running)).toBe('Fill #password');
  });

  // The log line says which step; the error says what went wrong inside it. For a
  // failure the second is the more specific of the two.
  it('prefers the error once the run has failed', () => {
    expect(step({...running, status: 'failed', error: 'no element matched #password'}))
        .toBe('no element matched #password');
  });

  it('falls back to the last log line for a failure with no error text', () => {
    expect(step({...running, status: 'failed', error: null})).toBe('Fill #password');
  });

  it('is empty with no run', () => {
    expect(step(null)).toBe('');
  });
});

describe('meta', () => {
  // stepCount is how many have COMPLETED, so the step being worked on is the next
  // one -- reporting "step 3 of 12" while the fourth is running is off by one for
  // the whole run.
  it('names the step being worked on, not the last one finished', () => {
    expect(meta(running, AT)).toBe('step 4 of 12 · 0:24');
  });

  it('does not run past the total on the last step', () => {
    expect(meta({...running, stepCount: 12, progress: 1}, AT)).toBe('step 12 of 12 · 0:24');
  });

  // "step 46 of 12" is exactly the pair progressOf refused to divide. Dropping the
  // count leaves the clock, which is true and is most of what someone watching a
  // long run wants.
  it('drops the step count rather than printing an impossible one', () => {
    expect(meta({...running, progress: null, stepCount: 45}, AT)).toBe('0:24');
  });

  it('counts the steps a finished run actually ran', () => {
    expect(meta({...running, status: 'ok', stepCount: 12, finishedAt: '2026-08-09T01:01:04.000Z'}, AT))
        .toBe('12 steps · 1:04');
    expect(meta({...running, status: 'ok', stepCount: 1, finishedAt: '2026-08-09T01:00:03.000Z'}, AT))
        .toBe('1 step · 0:03');
  });

  // Measured to finishedAt, not to now: a sealed record's clock must stop, or the
  // card keeps counting up under the words "finished".
  it('freezes the clock of a finished run', () => {
    const finished = {
      ...running, status: 'ok', stepCount: 12,
      finishedAt: '2026-08-09T01:00:10.000Z',
    };
    expect(meta(finished, AT)).toBe('12 steps · 0:10');
    expect(meta(finished, AT + 600_000)).toBe('12 steps · 0:10');
  });
});

describe('describe', () => {
  it('leads with the name while the run is live, and does not spin when it is not', () => {
    const view = describeRun(running, AT);
    expect(view.title).toBe('Daily login');
    expect(view.live).toBe(true);
    expect(view.spin).toBe(true);
    expect(view.icon).toBe('loader');
  });

  // Past tense once it is over, and a whole sentence rather than a status word
  // appended: "Daily login · cancelled" reads as a category, "Daily login was
  // stopped" reads as something that happened.
  it('puts a finished run in the past tense, per outcome', () => {
    const at = AT;
    expect(describeRun({...running, status: 'ok'}, at).title).toBe('Daily login finished');
    expect(describeRun({...running, status: 'partial'}, at).title)
        .toBe('Daily login finished with problems');
    expect(describeRun({...running, status: 'failed'}, at).title).toBe('Daily login failed');
    expect(describeRun({...running, status: 'cancelled'}, at).title)
        .toBe('Daily login was stopped');
  });

  // These tones drive the tab's dot as well as the card, so they are decisions
  // about what is worth interrupting someone on another tab for. In flight is not
  // a verdict, and neither is a stop the user asked for.
  it('marks only the outcomes that need attention', () => {
    expect(describeRun(running, AT).tone).toBe('off');
    expect(describeRun({...running, status: 'cancelled'}, AT).tone).toBe('off');
    expect(describeRun({...running, status: 'ok'}, AT).tone).toBe('ok');
    expect(describeRun({...running, status: 'partial'}, AT).tone).toBe('warn');
    expect(describeRun({...running, status: 'failed'}, AT).tone).toBe('bad');
  });

  // Only a live run can be stopped, and `live` is what hides the Stop button.
  it('reports stoppability through live', () => {
    expect(describeRun(running, AT).live).toBe(true);
    for (const status of ['ok', 'partial', 'failed', 'cancelled']) {
      expect(describeRun({...running, status}, AT).live).toBe(false);
    }
  });

  // The runner is free to add a status. Painting a red card for one this panel
  // merely has not heard of would be lying about a run that was fine.
  it('treats an unknown status as in flight rather than as a failure', () => {
    const view = describeRun({...running, status: 'queued'}, AT);
    expect(view.tone).toBe('off');
    expect(view.live).toBe(true);
  });

  it('stands in a name for a run that has none', () => {
    expect(describeRun({...running, automationName: ''}, AT).title).toBe('This automation');
  });

  it('is null with no run, which is what hides the card', () => {
    expect(describeRun(null, AT)).toBeNull();
    expect(describeRun(undefined, AT)).toBeNull();
  });
});
