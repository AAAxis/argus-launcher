// The workflow runner.
//
// Lives in the main process, not the renderer. The renderer is a window, and
// window-all-closed does not quit on macOS, so a closed window would abandon a
// run with a browser still driving. Main already owns automationLaunches,
// getFreePort, waitForCdpReady and the kill path; splitting session ownership
// across the IPC boundary is how you get an orphaned Chromium.
//
// Main owns no data, so the division is: the RENDERER hands over a fully
// resolved automation and profile at start, and the runner streams events back
// for the renderer to persist. docs/process-boundary.md stays true -- the main
// process still never talks to Supabase.

const {openPageSession} = require('../cdp-core.cjs');
const {interpolateStep} = require('./interpolate.cjs');
const {redactSecrets} = require('./redact.cjs');
const {EXECUTORS, evaluateCondition, sleep, validateSteps} = require('./steps.cjs');
const store = require('./store.cjs');
const SCHEMA = require('./step-schema.json');

const DEFAULT_STEP_TIMEOUT_MS = 15000;
// goto and waitFor wait on the network, not on the DOM.
const NAV_STEP_TIMEOUT_MS = 30000;
const DEFAULT_RUN_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_LOOP_ITERATIONS = 1000;
const MAX_RETRIES = 5;
// How many callAutomation frames may stack. Mirrors MAX_CALL_DEPTH in
// src/automations/callGraph.ts -- the renderer refuses statically, this
// refuses at runtime for steps that arrived without pre-resolution.
const MAX_CALL_DEPTH = 3;
const RETRY_BACKOFF_MS = 1000;

// Three concurrent runs, and exactly one per profile.
//
// Two runs driving the same window is not a feature, it is a race. The global
// cap is deliberately not the plan's max_concurrent (5-100): that entitlement
// is about browser SESSIONS, and conflating them would let an Enterprise org
// start a hundred Chromiums from one button on someone's laptop.
const MAX_CONCURRENT_RUNS = 3;

// Caps applied before a record leaves this process. A 1000-iteration loop over
// six steps would otherwise write a jsonb column nobody can read.
const MAX_LOG_ENTRIES = 2000;
const MAX_LOG_CHARS = 256 * 1024;

const NAV_STEPS = new Set(['goto', 'waitFor']);

// runId -> {run, cancel, profileId}
const active = new Map();

function timeoutIn(ms, label) {
  return new Promise((_resolve, reject) => {
    setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
}

function stepTimeout(step) {
  if (step.timeoutMs && step.timeoutMs > 0) {
    return step.timeoutMs;
  }
  return NAV_STEPS.has(step.type) ? NAV_STEP_TIMEOUT_MS : DEFAULT_STEP_TIMEOUT_MS;
}

// Renders the schema's summary template against a step, for the log line.
function summarize(step) {
  const spec = SCHEMA[step.type];
  if (step.label) {
    return step.label;
  }
  if (!spec) {
    return step.type;
  }
  return spec.summary.replace(/\{([A-Za-z0-9_.]+)\}/g, (_match, key) => {
    const value = key.split('.').reduce((acc, part) => (acc ? acc[part] : undefined), step);
    return value === undefined || value === null ? '' : String(value);
  }).trim() || spec.label;
}

class Run {
  constructor({app, automation, profile, trigger, cdpUrl, vars, onEvent, pushCookies,
    resolvedAutomations, secretVarNames}) {
    this.app = app;
    this.automation = automation;
    this.profile = profile;
    this.trigger = trigger;
    this.cdpUrl = cdpUrl;
    this.onEvent = onEvent || (() => {});
    // Absent when this launch cannot reach a renderer to push to (no window,
    // or a caller that never asked for the capability) -- saveCookies throws
    // rather than silently no-op-ing when this is undefined; see steps.cjs.
    this.pushCookies = pushCookies;
    // calleeId -> steps, for every callAutomation reachable from the root.
    // Pre-resolved by the renderer (src/automations/callGraph.ts), which also
    // refused unknown ids and cycles -- this process has no catalogue to
    // resolve against, so an id missing here is a named runtime error.
    this.resolvedAutomations = resolvedAutomations || {};
    // Variable names to mask in the log and in the sealed record -- the root
    // automation's `secret` parameters plus every callee's, collected by the
    // renderer on the same pass that resolved the call tree. See redact.cjs
    // for why this cannot be read off `automation` here.
    this.secretVarNames = secretVarNames || [];
    this.id = `run_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    this.cancelled = false;
    this.screenshotIndex = 0;
    this.logChars = 0;
    this.truncated = false;
    this.stepCount = 0;
    this.vars = {...(automation.variables || {}), ...(vars || {})};
    this.record = {
      id: this.id,
      automation_id: automation.id,
      automation_name: automation.name || '',
      profile_id: profile.id,
      profile_name: profile.name || '',
      trigger,
      status: 'running',
      started_at: new Date().toISOString(),
      finished_at: null,
      duration_ms: null,
      step_count: 0,
      failed_step_id: null,
      error: null,
      vars: {},
      log: [],
    };
  }

  // The interpolation context. Rebuilt per step so {{loop.*}} reflects the
  // innermost loop and {{vars.*}} reflects everything written so far.
  context(loop) {
    return {
      profile: {
        id: this.profile.id,
        name: this.profile.name,
        email: this.profile.email,
        password: this.profile.password,
        status: this.profile.status,
        tags: this.profile.tags,
        folder_id: this.profile.folder_id,
      },
      vars: this.vars,
      run: {id: this.id, startedAt: this.record.started_at, trigger: this.trigger},
      ...(loop ? {loop} : {}),
    };
  }

  log(level, message, extra = {}) {
    if (this.record.log.length >= MAX_LOG_ENTRIES || this.logChars >= MAX_LOG_CHARS) {
      if (!this.truncated) {
        this.truncated = true;
        this.record.log.push({
          at: new Date().toISOString(),
          path: '',
          stepId: '',
          type: 'run',
          level: 'warn',
          message: `Log truncated after ${this.record.log.length} entries`,
        });
      }
      return;
    }
    this.logChars += String(message).length;
    const entry = {at: new Date().toISOString(), level, message, ...extra};
    this.record.log.push(entry);
    this.onEvent({type: 'log', runId: this.id, entry});
  }

  persist() {
    // Redacted here too, and not only in seal(): persist() runs on every change
    // AND once more from flush() after the seal, so an unmasked assignment here
    // would put the secret straight back into the record the renderer writes to
    // Supabase -- and into the disk mirror under <userData>/AutomationRuns/,
    // which outlives the run.
    this.record.vars = redactSecrets(this.vars, this.secretVarNames);
    store.writeRun(this.app, this.record);
  }

  async saveScreenshot(base64, stepId) {
    this.screenshotIndex += 1;
    return store.saveScreenshot(this.app, this.id, this.screenshotIndex, stepId, base64);
  }

  // Throws rather than no-op-ing when this.pushCookies was never supplied
  // (a run started without a renderer to push to, e.g. from a route that
  // never asked for the capability) -- a saveCookies step that appears to run
  // and silently saves nothing is worse than one the log names as failed.
  saveCookies(cookies) {
    if (!this.pushCookies) {
      throw new Error('This launch cannot save cookies to the Launcher');
    }
    return this.pushCookies(this.profile.id, cookies);
  }

  // Runs one step under its own timeout and error policy. Returns nothing;
  // throws only when the policy says the run should stop.
  async runStep(cdp, rawStep, path, loop) {
    if (this.cancelled) {
      throw new Error('cancelled');
    }
    if (rawStep.enabled === false) {
      // Logged rather than skipped silently -- a step that vanishes from the
      // log when disabled is how people lose an afternoon.
      this.log('info', `Skipped ${summarize(rawStep)}`,
          {path, stepId: rawStep.id, type: rawStep.type});
      return;
    }

    const attempts = rawStep.onError === 'retry' ?
      Math.min(Number(rawStep.retries) || 1, MAX_RETRIES) + 1 :
      1;

    for (let attempt = 1; attempt <= attempts; attempt++) {
      const startedAt = Date.now();
      try {
        // Interpolated per attempt so a retry re-reads variables a previous
        // step may have changed.
        const step = interpolateStep(rawStep, this.context(loop), SCHEMA);
        const result = await this.execute(cdp, step, path, loop);
        this.stepCount += 1;
        if (result?.vars) {
          Object.assign(this.vars, result.vars);
        }
        this.log('info', summarize(step), {
          path,
          stepId: step.id,
          type: step.type,
          durationMs: Date.now() - startedAt,
          ...(result?.screenshot ? {screenshot: result.screenshot} : {}),
          // Redacted, not raw: this line is written into the run's log and
          // read back by the whole workspace. The bag the next step
          // interpolates against (this.vars, assigned above) keeps the real
          // value.
          ...(result?.vars ?
            {vars: redactSecrets(result.vars, this.secretVarNames)} : {}),
        });
        return;
      } catch (error) {
        if (this.cancelled) {
          throw new Error('cancelled');
        }
        const message = error?.message || String(error);
        const last = attempt === attempts;
        if (!last) {
          this.log('warn', `${summarize(rawStep)} failed (attempt ${attempt}): ${message}`,
              {path, stepId: rawStep.id, type: rawStep.type, durationMs: Date.now() - startedAt});
          await sleep(RETRY_BACKOFF_MS);
          continue;
        }
        this.log('error', `${summarize(rawStep)}: ${message}`, {
          path,
          stepId: rawStep.id,
          type: rawStep.type,
          durationMs: Date.now() - startedAt,
        });
        if (rawStep.onError === 'continue') {
          // The run keeps going but can no longer end `ok` -- see the status
          // note in 2026-08-05-automations.sql.
          this.degraded = true;
          return;
        }
        this.record.failed_step_id = rawStep.id;
        throw error;
      }
    }
  }

  // Dispatches one interpolated step. if/loop/callAutomation are handled here
  // rather than in steps.cjs because they recurse back into runStep.
  async execute(cdp, step, path, loop) {
    if (step.type === 'callAutomation') {
      const callee = this.resolvedAutomations[step.automationId];
      if (!callee) {
        throw new Error('The automation this step calls no longer exists or was ' +
          'not resolved before the run started');
      }
      // The renderer's static walk already refused cycles and depth; this is
      // the belt for steps that arrived some other way (a buffered run, a
      // future caller that skips resolution). Counted off the path because the
      // path IS the call stack.
      const callDepth = path.split('.call.').length - 1;
      if (callDepth >= MAX_CALL_DEPTH) {
        throw new Error(`Automations can only call ${MAX_CALL_DEPTH} levels deep`);
      }
      // Same session, same vars bag, same whole-run budget: a callee is inline
      // steps, not a second run. `.call.` in the path is what the log viewer
      // indents on, and what the guard above counts.
      for (let i = 0; i < callee.length; i++) {
        await this.runStep(cdp, callee[i], `${path}.call.${i}`, loop);
      }
      return undefined;
    }

    if (step.type === 'if') {
      const taken = await evaluateCondition(cdp, step.condition || {});
      const branch = taken ? (step.then || []) : (step.else || []);
      const branchName = taken ? 'then' : 'else';
      for (let i = 0; i < branch.length; i++) {
        await this.runStep(cdp, branch[i], `${path}.${branchName}.${i}`, loop);
      }
      return undefined;
    }

    if (step.type === 'loop') {
      const cap = Math.min(Number(step.maxIterations) || 100, MAX_LOOP_ITERATIONS);
      let items;
      if (step.mode === 'forEach') {
        items = step.items;
        if (!Array.isArray(items)) {
          throw new Error('The list to loop over did not resolve to an array');
        }
      } else {
        items = Array.from({length: Math.max(0, Number(step.times) || 0)}, (_, i) => i);
      }
      const total = Math.min(items.length, cap);
      if (items.length > cap) {
        this.log('warn',
            `Loop capped at ${cap} of ${items.length} iterations`,
            {path, stepId: step.id, type: step.type});
      }
      for (let index = 0; index < total; index++) {
        const body = step.body || [];
        for (let i = 0; i < body.length; i++) {
          await this.runStep(cdp, body[i], `${path}.body.${i}`, {item: items[index], index});
        }
      }
      return undefined;
    }

    const executor = EXECUTORS[step.type];
    if (!executor) {
      throw new Error(`No executor for step type ${step.type}`);
    }
    const timeout = stepTimeout(step);
    // The race lives here, not inside each executor, so no executor can forget
    // one. Note the deadline handed to waitFor matches the same budget.
    return Promise.race([
      executor({
        cdp,
        step,
        log: (level, message) => this.log(level, message, {path, stepId: step.id, type: step.type}),
        deadline: Date.now() + timeout,
        saveScreenshot: (base64) => this.saveScreenshot(base64, step.id),
        saveCookies: (cookies) => this.saveCookies(cookies),
      }),
      timeoutIn(timeout, summarize(step)),
    ]);
  }

  // finish() split in two so notify-on-finish can run between them: seal()
  // decides the record's verdict, flush() writes it and tells the renderer.
  // The send needs the sealed verdict (the message reports status, duration
  // and the failing step) but must complete BEFORE flush(), because flush is
  // what the renderer answers by writing the run to Supabase -- a send that
  // fails after it would be logged into a record already gone.
  seal(status, error) {
    this.record.status = status;
    this.record.error = error || null;
    this.record.finished_at = new Date().toISOString();
    this.record.duration_ms =
      new Date(this.record.finished_at).getTime() - new Date(this.record.started_at).getTime();
    this.record.step_count = this.stepCount;
    // The sealed bag is what automation_runs.vars stores, so secrets are masked
    // on the way in. this.vars itself is untouched -- the run is over, but
    // nothing should depend on the order of these two lines.
    this.record.vars = redactSecrets(this.vars, this.secretVarNames);
  }

  // `extra` rides on the finished event -- today that is the composed
  // notification main.cjs built, which the renderer inserts into the
  // `notifications` table (this process holds no Supabase credentials).
  flush(extra) {
    this.persist();
    this.onEvent({type: 'finished', runId: this.id, run: this.record, ...(extra || {})});
  }
}

// Starts a run and resolves as soon as it is registered -- NOT when it
// finishes. Callers get a runId immediately and follow progress through events.
//
// This is not a style choice: AUTOMATION_REQUEST_TIMEOUT_MS is 20s and a real
// run is minutes, so a route that awaited completion would 504 and look like a
// hang in the runner rather than a timeout in the bridge.
async function start({app, automation, profile, trigger, cdpUrl, vars, onEvent, onFinish,
  onNotify, pushCookies, resolvedAutomations, secretVarNames}) {
  const problems = validateSteps(automation.steps || [], SCHEMA);
  // Callees run through the same runStep, so they are held to the same
  // validity -- checked here, once, not per call at runtime.
  for (const [calleeId, steps] of Object.entries(resolvedAutomations || {})) {
    problems.push(...validateSteps(steps || [], SCHEMA)
        .map((problem) => `${calleeId}: ${problem}`));
  }
  if (problems.length > 0) {
    throw new Error(`This automation is not valid: ${problems.slice(0, 5).join('; ')}`);
  }
  for (const entry of active.values()) {
    if (entry.profileId === profile.id) {
      const error = new Error('That profile already has a run in flight');
      error.status = 409;
      throw error;
    }
  }
  if (active.size >= MAX_CONCURRENT_RUNS) {
    const error = new Error(
        `Too many runs at once (${MAX_CONCURRENT_RUNS} is the limit). Wait for one to finish.`);
    error.status = 429;
    throw error;
  }

  const run = new Run({app, automation, profile, trigger, cdpUrl, vars, onEvent, pushCookies,
    resolvedAutomations, secretVarNames});
  active.set(run.id, {run, profileId: profile.id});
  run.persist();
  onEvent({type: 'started', runId: run.id, run: run.record});

  // Deliberately not awaited.
  void execute(run, onFinish, onNotify);
  return run.id;
}

// onFinish is what makes `close_on_finish` real. It is a callback rather than a
// reference to the launch table on purpose: this module owns the CDP socket for
// the length of a run and nothing else, and teaching it to kill browser
// processes would put the two halves of the process boundary in one file. main
// decides what closing means; this decides when.
//
// onNotify is notify-on-finish, a callback for the same reason: main owns the
// connector registry and the OS notification, this owns the one moment the
// record is sealed but not yet flushed. It receives the sealed record and
// returns the composed notification for the finished event (or null when the
// automation's setting says this outcome does not notify).
async function execute(run, onFinish, onNotify) {
  let session = null;
  // Seeded with a failure rather than left null: every path out of the try
  // below assigns it, and if some future edit finds one that does not, a run
  // that ends as 'failed' is a bug you can see rather than one that leaves the
  // record stuck on 'running' forever.
  let outcome = {status: 'failed', error: 'The run ended without a result'};
  const budget = Math.min(
      Number(run.automation.timeout_ms) || DEFAULT_RUN_TIMEOUT_MS,
      DEFAULT_RUN_TIMEOUT_MS);
  try {
    const opened = await openPageSession(run.cdpUrl);
    session = opened.session;
    await session.send('Page.enable');
    await session.send('Runtime.enable');

    // The browser is mid-navigation to its start page when CDP first answers
    // (writeProfileStartupPrefs points startup at the generated home file), so
    // without this settle the first goto races the browser's own navigation.
    await Promise.race([
      session.once('Page.loadEventFired', 2000).catch(() => undefined),
      sleep(2000),
    ]);

    const steps = run.automation.steps || [];
    await Promise.race([
      (async () => {
        for (let i = 0; i < steps.length; i++) {
          await run.runStep(session, steps[i], String(i), null);
        }
      })(),
      timeoutIn(budget, 'This run'),
    ]);

    outcome = {status: run.degraded ? 'partial' : 'ok', error: null};
  } catch (error) {
    const message = error?.message || String(error);
    outcome = run.cancelled || message === 'cancelled' ?
      {status: 'cancelled', error: null} :
      {status: 'failed', error: message};
  } finally {
    if (session) {
      session.close();
    }
    // Closing the browser happens BEFORE the record is sealed. It used to sit
    // at the end of each branch above, and a warning logged after the seal-
    // and-flush would have reached the open window as an event and then never
    // been written anywhere -- flush() is what persists the log and what the
    // renderer answers by flushing the run to Supabase.
    //
    // Not on 'cancelled': the user is standing at the machine having just
    // stopped the run, and taking their window away is the opposite of what
    // stopping asked for.
    if (onFinish && outcome.status !== 'cancelled') {
      try {
        onFinish();
      } catch (error) {
        run.log('warn', `Could not close the browser: ${error?.message || String(error)}`);
      }
    }
    run.seal(outcome.status, outcome.error);
    // Notify-on-finish sits between seal and flush on purpose: the message
    // reports the sealed verdict, and a send that fails is logged into the
    // record the user reads rather than into one already flushed. onNotify
    // never throws for a dead connector -- it reports that as sendError so a
    // broken webhook cannot also silence the bell -- but it is guarded anyway:
    // a throw out of this finally would eat the run's own outcome.
    let notification = null;
    if (onNotify) {
      try {
        notification = await onNotify(run.record);
      } catch (error) {
        run.log('warn',
            `Could not send the finish notification: ${error?.message || String(error)}`);
      }
    }
    if (notification && notification.sendError) {
      run.log('warn', `The finish message was not delivered: ${notification.sendError}`);
    }
    run.flush(notification ? {notification} : {});
    active.delete(run.id);
  }
}

function cancel(runId) {
  const entry = active.get(runId);
  if (!entry) {
    return false;
  }
  entry.run.cancelled = true;
  return true;
}

function isProfileRunning(profileId) {
  for (const entry of active.values()) {
    if (entry.profileId === profileId) {
      return true;
    }
  }
  return false;
}

function activeRuns() {
  return Array.from(active.values()).map((entry) => entry.run.record);
}

module.exports = {
  MAX_CONCURRENT_RUNS,
  SCHEMA,
  activeRuns,
  cancel,
  isProfileRunning,
  start,
  validateSteps: (steps) => validateSteps(steps, SCHEMA),
};
