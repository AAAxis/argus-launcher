// The workflow model: what a step is, and what a run context can interpolate.
//
// This file is the renderer's view. The runner in electron/automation/ works
// from electron/automation/step-schema.json instead, because nothing compiles
// electron/ -- main.cjs and its siblings are hand-written CommonJS. The JSON is
// the single source of truth for field lists, labels and validation; this union
// is the compile-time half, and STEP_SCHEMA in ./schema.ts is what pins the two
// together so a type added to one and forgotten in the other fails typecheck.
//
// Adding a step type therefore means: a member here, an entry in the JSON, and
// an executor in electron/automation/steps.cjs. The editor needs no change --
// StepFields renders whatever the JSON describes.

export type StepType =
  | 'goto'
  | 'waitFor'
  | 'click'
  | 'type'
  | 'scroll'
  | 'extract'
  | 'evaluate'
  | 'screenshot'
  | 'wait'
  | 'setVar'
  | 'httpRequest'
  | 'aiPrompt'
  | 'aiCheck'
  | 'notify'
  | 'saveCookies'
  | 'if'
  | 'loop';

// What every step carries.
//
// `id` is minted client-side at insert and never reused: the run log addresses
// steps by it, and the editor keys rows on it, so a regenerated id turns a run
// log into a list of orphans.
export type StepBase = {
  id: string;
  // Overrides the schema's generated summary in the editor and the log. Free
  // text -- "Log in" reads better than "Click button[type=submit]".
  label?: string;
  // false = skipped, and logged as skipped rather than silently absent. A step
  // that vanishes from the log when disabled is how people lose an afternoon.
  enabled?: boolean;
  timeoutMs?: number;
  onError?: 'stop' | 'continue' | 'retry';
  // Only read when onError === 'retry'. Capped at 5 by the validator.
  retries?: number;
};

// Deliberately not an expression language.
//
// Four comparators over one interpolated left side and one literal right side.
// A real parser is a week of work, and `evaluate` already covers anything this
// cannot express -- it returns a value, and setVar stores it.
export type Condition = {
  left: string;
  op: 'equals' | 'notEquals' | 'contains' | 'exists' | 'selectorExists';
  right?: string;
};

export type AutomationStep =
  | (StepBase & {
      type: 'goto';
      url: string;
      waitUntil?: 'load' | 'domcontentloaded';
    })
  | (StepBase & {
      type: 'waitFor';
      for: 'selector' | 'selectorGone' | 'url' | 'text';
      selector?: string;
      url?: string;
      text?: string;
    })
  | (StepBase & {
      type: 'click';
      selector: string;
      // Which match, when the selector is not unique. Zero-based.
      nth?: number;
    })
  | (StepBase & {
      type: 'type';
      selector: string;
      text: string;
      clear?: boolean;
      // Per-character delay. Set it and the runner dispatches real key events
      // instead of Input.insertText, which is what sites watching for
      // paste-shaped input are looking at.
      delayMs?: number;
      pressEnter?: boolean;
    })
  | (StepBase & {
      type: 'scroll';
      to: 'bottom' | 'top' | 'selector';
      selector?: string;
    })
  | (StepBase & {
      type: 'extract';
      selector: string;
      what: 'text' | 'html' | 'attr' | 'value';
      attr?: string;
      // true stores an array of every match rather than the first.
      all?: boolean;
      // Variable name to store into; readable afterwards as {{vars.<into>}}.
      into: string;
    })
  | (StepBase & {
      type: 'evaluate';
      // NEVER interpolated -- see interpolate.cjs. Splicing user data into
      // source is injection, and a {{ }} inside real JavaScript would be
      // silently rewritten. Values reach the script through `args`, which are
      // interpolated and passed as a real value.
      script: string;
      args?: Record<string, string>;
      into?: string;
    })
  | (StepBase & {
      type: 'screenshot';
      selector?: string;
      fullPage?: boolean;
    })
  | (StepBase & {
      // One step for both fixed and jittered waits: `ms`, or `minMs`/`maxMs`
      // for a random pause. Two step types for this was one too many.
      type: 'wait';
      ms?: number;
      minMs?: number;
      maxMs?: number;
    })
  | (StepBase & {
      type: 'setVar';
      name: string;
      value: string;
    })
  | (StepBase & {
      // Runs in the main process, not in the page. A fetch from the page would
      // traverse the profile's proxy and carry its cookies, which is a leaky
      // default for "post my results to a webhook".
      type: 'httpRequest';
      method: 'GET' | 'POST';
      url: string;
      headers?: Record<string, string>;
      body?: string;
      into?: string;
    })
  | (StepBase & {
      // Asks a model a question, optionally about the page, and stores the
      // answer. Like httpRequest it runs in the main process, and for the same
      // reason -- a call from the page would traverse the profile's proxy and
      // carry its cookies.
      //
      // `provider` is a connector id (category 'ai'), or empty for the
      // workspace default. The key is never here: the main process resolves
      // the id against the list the renderer pushed it, which is what keeps
      // the credential out of the steps, the vars, the log and run.json.
      type: 'aiPrompt';
      provider?: string;
      prompt: string;
      context?: 'none' | 'pageText' | 'selector';
      selector?: string;
      format?: 'text' | 'json';
      maxTokens?: number;
      into: string;
    })
  | (StepBase & {
      // The same call, constrained to a yes/no answer so a branch can act on
      // it. `into` stores the string 'yes' or 'no' rather than a boolean,
      // because Condition compares with String() on both sides -- a boolean
      // would work by accident and read as a bug.
      //
      // onFalse: 'fail' is the assertion the step catalogue never had. Nothing
      // else in it can end a run on a judgement about the page.
      type: 'aiCheck';
      provider?: string;
      question: string;
      context?: 'none' | 'pageText' | 'selector';
      selector?: string;
      into?: string;
      onFalse?: 'continue' | 'fail';
    })
  | (StepBase & {
      // Sends a message out of the run, through a message connector. Like the
      // AI steps it runs in the main process and stores only a connector id --
      // no token ever sits in a step. `message` is interpolated, which is how
      // an AI step's answer gets sent: "Done: {{vars.summary}}".
      type: 'notify';
      // A connector id (category 'message'), or empty for the workspace's
      // default message connector.
      connector?: string;
      message: string;
      // Used by email connectors; chat connectors ignore it.
      subject?: string;
    })
  | (StepBase & {
      // Collects the running profile's cookies over CDP Storage.getCookies
      // and pushes them to the launcher, which lands them as a
      // "«profile» (live)" set -- same landing as the extension's push (Task
      // 4). Runs in the main process, not the page: cookies never pass
      // through page JS.
      type: 'saveCookies';
      domain?: string;
    })
  | (StepBase & {
      type: 'if';
      condition: Condition;
      then: AutomationStep[];
      else?: AutomationStep[];
    })
  | (StepBase & {
      type: 'loop';
      mode: 'times' | 'forEach';
      times?: number;
      // A template resolving to an array, e.g. "{{vars.rows}}". Whole-field
      // templates keep their type, which is what makes this work at all.
      items?: string;
      maxIterations?: number;
      body: AutomationStep[];
    });

// Variables as they cross the wire. JSON-serializable only: an evaluate that
// returns a DOM node comes back undefined through returnByValue and is turned
// into a named error rather than a silent empty.
export type AutomationVars = Record<string, unknown>;

export type RunTrigger = 'manual' | 'launch' | 'start-page' | 'mcp' | 'api';

// `partial` is its own status rather than folded into `ok`: a run where a step
// failed under onError:'continue' did not do what it says on the tin.
export type RunStatus = 'running' | 'ok' | 'partial' | 'failed' | 'cancelled';

// One line of a run log. `path` is the step's position in the tree -- '3',
// '5.body.2', '4.then.0' -- so the log viewer can indent to match the editor.
export type RunLogEntry = {
  at: string;
  path: string;
  stepId: string;
  type: StepType | 'run';
  level: 'info' | 'warn' | 'error';
  message: string;
  durationMs?: number;
  // A filename under <userData>/AutomationRuns/<runId>/, never base64.
  screenshot?: string;
  // Only the key this step wrote, not the whole bag.
  vars?: AutomationVars;
};

// How deep if/loop nesting may go. Past this a linear editor stops being more
// readable than a graph, which is the whole reason it is linear.
export const MAX_STEP_DEPTH = 3;

// Hard ceilings the runner enforces regardless of what a workflow asks for.
export const MAX_LOOP_ITERATIONS = 1000;
export const MAX_RETRIES = 5;
