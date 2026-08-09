// What an automation asks for before it runs, and how a run's variable bag is
// assembled from four sources.
//
// The point of the whole file: a flat-search workflow that looks in Dortmund
// and one that looks in Essen should be ONE automation with a `city_name`
// parameter, not two copies of twelve steps. The interpolation that makes that
// work already exists (electron/automation/interpolate.cjs substitutes
// {{vars.city_name}} into any field the step catalogue marks interpolate:true);
// what was missing was a declaration, somewhere to keep each profile's values,
// and a single place that decides which value wins.
//
// Everything here is pure and free of workspace imports, for the reason
// callGraph.ts is: the MCP create/update handlers run the same validation the
// editor does, so what one refuses the other refuses identically.
import type {AutomationVars} from './types';

// How a parameter renders and what its value coerces to.
//
// A deliberate subset of the step catalogue's FieldKind (src/automations/schema.ts)
// plus two of its own. Nothing here recurses or references other rows -- a
// parameter is a value the user types, not a step -- so 'steps', 'condition',
// 'keyvalue', 'connector' and 'automation' have no meaning at this level.
//
// 'secret' is masked in the UI and redacted out of the run record
// (electron/automation/redact.cjs). Masking is display-only: the value sits in
// Supabase in plain text, exactly like every proxy password and connector
// credential already does, and the editor's hint says so rather than implying
// an encryption that is not there.
//
// 'list' is a textarea whose value becomes a real string[], so it can feed a
// loop step's `items` directly -- a whole-field "{{vars.cities}}" keeps the
// array rather than stringifying it, which is the one interpolation rule that
// makes this kind worth having.
export type ParamKind =
  | 'text'
  | 'textarea'
  | 'number'
  | 'boolean'
  | 'select'
  | 'secret'
  | 'list';

export const PARAM_KINDS: ParamKind[] =
  ['text', 'textarea', 'number', 'boolean', 'select', 'secret', 'list'];

// One declared input. Modelled on ConnectorField (src/data/connectors.ts) and
// FieldSpec (src/automations/schema.ts) -- the two field descriptors already in
// the tree -- so the editor's renderer has nothing new to learn.
export type AutomationParam = {
  // Addressable from any interpolated step field as {{vars.<name>}}. The
  // pattern is setVar.name's pattern, not a looser one: a parameter that cannot
  // be written by a setVar step is a parameter the runner cannot reason about.
  name: string;
  // What the form shows. Falls back to `name`, so a parameter is usable the
  // moment it is named.
  label?: string;
  kind: ParamKind;
  // Blocks a run that has no value. Never set on 'boolean' -- see validateParams.
  required?: boolean;
  // The automation-level value, under every profile's own.
  default?: unknown;
  // 'select' only, at least one entry.
  options?: string[];
  hint?: string;
  placeholder?: string;
};

// Values a profile holds for one automation, and the whole per-profile map
// (profiles.automation_vars), keyed by automation id.
export type ParamValues = Record<string, unknown>;
export type ProfileAutomationVars = Record<string, ParamValues>;

// Past this a right-hand column stops being a form and starts being a table,
// which is the same argument MAX_STEP_DEPTH makes about nesting.
export const MAX_PARAMETERS = 20;

// setVar.name's pattern, verbatim from electron/automation/step-schema.json.
const NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function paramLabel(param: AutomationParam): string {
  return param.label?.trim() || param.name;
}

// Human-readable problems, empty when the list is sound. Addressed to whoever
// wrote it: the editor shows them inline, the MCP create/update handlers return
// them as a 400 sentence. Same contract as validateSchedule.
export function validateParams(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return ['parameters must be a list'];
  }
  if (value.length > MAX_PARAMETERS) {
    return [`parameters may declare at most ${MAX_PARAMETERS}`];
  }
  const problems: string[] = [];
  const seen = new Set<string>();
  value.forEach((entry: unknown, index) => {
    const at = `parameters[${index}]`;
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      problems.push(`${at} must be an object`);
      return;
    }
    const param = entry as Partial<AutomationParam>;
    if (typeof param.name !== 'string' || !NAME_PATTERN.test(param.name)) {
      problems.push(`${at}.name must start with a letter or underscore and ` +
        'contain only letters, numbers and underscores');
    } else if (seen.has(param.name)) {
      problems.push(`${at}.name "${param.name}" is declared twice`);
    } else {
      seen.add(param.name);
    }
    if (!PARAM_KINDS.includes(param.kind as ParamKind)) {
      problems.push(`${at}.kind must be one of ${PARAM_KINDS.join(', ')}`);
      return;
    }
    if (param.kind === 'select') {
      const options = param.options;
      if (!Array.isArray(options) || options.length === 0 ||
          options.some((option) => typeof option !== 'string' || option.trim() === '')) {
        problems.push(`${at}.options must list at least one choice`);
      }
    }
    // A yes/no box is always answered -- it is checked or it is not -- so
    // `required` on one can never fail, and a run blocked by a checkbox nobody
    // can satisfy is the confusing outcome this refuses up front.
    if (param.kind === 'boolean' && param.required) {
      problems.push(`${at} is a yes/no parameter, which is always answered — ` +
        'remove required');
    }
  });
  return problems;
}

// What the mapper runs on every row read. An empty list for anything that does
// not validate: the only writers validate first, so a broken document means the
// column was edited by hand, and a form must not render on a guess.
export function normalizeParams(value: unknown): AutomationParam[] {
  return validateParams(value).length === 0 ? value as AutomationParam[] : [];
}

// Whether a raw value counts as supplied. Blank is undefined, null, or a string
// that is only whitespace -- and, for 'list', an array with nothing in it.
//
// 'boolean' is never blank: false is an answer, not an absence. That is also
// why validateParams refuses `required` on one.
export function hasValue(param: AutomationParam, raw: unknown): boolean {
  if (param.kind === 'boolean') {
    return raw !== undefined && raw !== null;
  }
  if (raw === undefined || raw === null) {
    return false;
  }
  if (typeof raw === 'string') {
    return raw.trim() !== '';
  }
  if (Array.isArray(raw)) {
    return raw.length > 0;
  }
  return true;
}

// One raw value to the type its declaration promises.
//
// Runs once, at resolve time, rather than on write -- so the editors can keep
// storing strings (what a controlled input holds, and what src/drafts.ts's
// all-strings rule expects), an agent over MCP can send real JSON, and changing
// a parameter's kind later needs no data migration.
//
// A 'number' whose text is not a number is passed through UNCHANGED rather than
// becoming NaN: a URL containing the word the user typed fails visibly, and
// "?rooms=NaN" does not.
export function coerceParamValue(param: AutomationParam, raw: unknown): unknown {
  switch (param.kind) {
    case 'number': {
      if (typeof raw === 'number') {
        return raw;
      }
      const parsed = Number(String(raw).trim());
      return Number.isFinite(parsed) ? parsed : raw;
    }
    case 'boolean':
      if (typeof raw === 'boolean') {
        return raw;
      }
      return raw === 'true' || raw === '1' || raw === 'yes';
    case 'list': {
      if (Array.isArray(raw)) {
        return raw.map((entry) => String(entry).trim()).filter(Boolean);
      }
      return String(raw).split('\n').map((line) => line.trim()).filter(Boolean);
    }
    default:
      return typeof raw === 'string' ? raw : String(raw);
  }
}

// The automation-level layer: every parameter that declares a default.
export function paramDefaults(params: AutomationParam[] = []): ParamValues {
  const out: ParamValues = {};
  for (const param of params) {
    if (hasValue(param, param.default)) {
      out[param.name] = param.default;
    }
  }
  return out;
}

// Only the keys that are actually set, so a profile holding "" for a parameter
// falls through to the automation's default instead of blanking it. Keys with
// no declaration are dropped: a stale value left behind by a renamed parameter
// must not reappear in the bag under its old name.
function suppliedOnly(params: AutomationParam[], values: ParamValues = {}): ParamValues {
  const byName = new Map(params.map((param) => [param.name, param]));
  const out: ParamValues = {};
  for (const [name, raw] of Object.entries(values)) {
    const param = byName.get(name);
    if (param && hasValue(param, raw)) {
      out[name] = raw;
    }
  }
  return out;
}

// The variable bag a run starts with, assembled from four layers, weakest
// first. The result is handed to the runner as its existing `vars` argument, so
// runner.cjs's {...automation.variables, ...vars} merge does the rest and
// nothing in the main process had to learn about parameters at all.
//
// `calleeParameters` is the declarations of every automation reachable through
// callAutomation (resolveCallTree gives the ids). They sit at the bottom
// because a callee shares the caller's bag: without their defaults a callee's
// own default is invisible and the step dies on an interpolation error nobody
// can explain from the parent's editor.
export function resolveRunVars(input: {
  parameters?: AutomationParam[];
  calleeParameters?: AutomationParam[][];
  profileValues?: ParamValues;
  overrides?: ParamValues;
}): AutomationVars {
  const own = input.parameters || [];
  const callees = (input.calleeParameters || []).flat();
  // Own declarations win when a caller and a callee name the same parameter --
  // the run is the caller's, and its editor is where the value was set.
  const known = [...callees, ...own];

  const merged: ParamValues = {
    ...paramDefaults(callees),
    ...paramDefaults(own),
    ...suppliedOnly(known, input.profileValues),
    ...suppliedOnly(known, input.overrides),
  };

  const byName = new Map(known.map((param) => [param.name, param]));
  const out: AutomationVars = {};
  for (const [name, raw] of Object.entries(merged)) {
    const param = byName.get(name);
    out[name] = param ? coerceParamValue(param, raw) : raw;
  }
  return out;
}

// Required parameters this value set does not answer. `values` is the resolved
// bag, not a single layer -- a default satisfies `required` just as a profile's
// own value does.
export function missingRequired(
    params: AutomationParam[] = [], values: ParamValues = {}): AutomationParam[] {
  return params.filter((param) => param.required && !hasValue(param, values[param.name]));
}

// The sentence a blocked surface shows: the Run dialog on the row it will not
// let you tick, the launch path in its toast, the scheduler in its warning.
// Null when nothing is missing. Callers add the subject ("Renter DE-1 ") --
// the same sentence has to read correctly in all three places.
export function describeMissingParams(
    params: AutomationParam[] = [], values: ParamValues = {}): string | null {
  const missing = missingRequired(params, values);
  if (missing.length === 0) {
    return null;
  }
  const names = missing.map(paramLabel);
  const list = names.length === 1 ? names[0] :
    `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  return names.length === 1 ?
    `needs a value for ${list}` :
    `needs values for ${list}`;
}

// The collapsed row in the editor's Parameters card: "city_name · text · required".
export function paramSummary(param: AutomationParam): string {
  const parts = [param.name, param.kind];
  if (param.required) {
    parts.push('required');
  }
  return parts.join(' · ');
}
