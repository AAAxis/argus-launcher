// The step catalogue, as the editor sees it.
//
// The JSON is the single source of truth -- the runner in electron/ requires
// the same file, and nothing compiles electron/, so a TypeScript catalogue
// would have to be maintained twice by hand. That is the src/lib/cookieFile.ts
// drift hazard AGENTS.md warns about.
//
// The `Record<StepType, StepSpec>` annotation below is the whole anti-drift
// device, and it works in both directions:
//   - a step type in StepType with no entry in the JSON  -> missing key, error
//   - an entry in the JSON that is not a StepType        -> excess key, error
// So adding a step means touching the union, the JSON, and an executor in
// electron/automation/steps.cjs, and forgetting either of the first two fails
// typecheck rather than failing at runtime in front of a user.
import rawSchema from '../../electron/automation/step-schema.json';
import type {StepType} from './types';

// How a field renders and validates. `kind` is what StepFields switches on.
//
// 'steps' recurses into a nested list (if/loop). 'keyvalue' is a string->string
// map. 'condition' is the four-comparator shape in types.ts -- deliberately not
// an expression language.
export type FieldKind =
  | 'text'
  | 'textarea'
  | 'number'
  | 'select'
  | 'boolean'
  | 'keyvalue'
  | 'steps'
  | 'condition'
  // A dropdown of the workspace's configured connectors, filtered to the
  // field's `category` (an AI step offers the 'ai' ones, a notify step the
  // 'message' ones). The one field kind whose options are data rather than a
  // list in the JSON -- which is why the editor threads the connector list
  // down to StepFields the same way it threads checkProfile, instead of the
  // schema naming them.
  | 'connector';

export type FieldSpec = {
  key: string;
  kind: FieldKind;
  label: string;
  required?: boolean;
  // Whether {{...}} is substituted before the step runs. Absent means false.
  //
  // evaluate.script sets this false explicitly rather than by omission, because
  // it is the one place where the answer is load-bearing: interpolating into
  // source is injection, and a {{ }} inside real JavaScript would be silently
  // rewritten. Values reach a script through `args`, which are interpolated.
  interpolate?: boolean;
  default?: string | number | boolean;
  options?: string[];
  placeholder?: string;
  hint?: string;
  min?: number;
  max?: number;
  // A regex the value must match, as a string. Applied by the validator and by
  // the editor; variable names use it to stay addressable as {{vars.x}}.
  pattern?: string;
  // Marks a field the editor can test against a live page. 'selector' puts a
  // Check button beside the input, which counts what it matches on the open
  // profile. Declared here rather than inferred from the key name, because
  // `attr` and `into` are also text fields on the same steps and neither is a
  // selector -- and because a step type added later may name its selector
  // something else.
  check?: 'selector';
  // Show this field only when a sibling holds one of these values. The value is
  // a single string or a list of them.
  showWhen?: Record<string, string | string[]>;
  // For kind 'connector': which half of the catalogue the dropdown offers.
  // Absent means no filter, which no current step wants -- name it.
  category?: 'ai' | 'message';
};

export type StepSpec = {
  label: string;
  // A lucide icon name, resolved by the editor.
  icon: string;
  // Rendered against the step's own fields for the collapsed row and the run
  // log: "Go to {url}" becomes "Go to example.com".
  summary: string;
  // Which CDP domains the executor needs. Documentation for now; the runner
  // enables Page and Runtime up front and the rest lazily.
  cdp: string[];
  fields: FieldSpec[];
  // Shown under the fields in the editor when the step has a caveat worth
  // stating at the point of use.
  note?: string;
};

// ── The anti-drift check ─────────────────────────────────────────────────────
// Both bindings below exist only to fail typecheck. Neither is read.
//
// Note what does NOT work: `const S: Record<StepType, StepSpec> = raw as Record<...>`.
// A cast on the right-hand side satisfies the annotation by fiat, so the
// annotation checks nothing and the drift it was meant to catch sails through.
// The value has to be cast (the JSON infers `kind: string`, not `kind:
// FieldKind`), so the key check is done separately against `unknown` values.

// Every StepType must have an entry: a missing key is an error here.
const _everyStepTypeIsDescribed: Record<StepType, unknown> = rawSchema;

// ...and the JSON must not describe a type the union lacks. Excess-property
// checks do not apply to a non-literal, so extra keys are caught by making
// their existence a type error instead.
type UndeclaredStepTypes = Exclude<keyof typeof rawSchema, StepType>;
const _noUndeclaredStepTypes: [UndeclaredStepTypes] extends [never] ? true : never = true;

void _everyStepTypeIsDescribed;
void _noUndeclaredStepTypes;

export const STEP_SCHEMA = rawSchema as unknown as Record<StepType, StepSpec>;

export const STEP_TYPES = Object.keys(STEP_SCHEMA) as StepType[];

export function specFor(type: StepType): StepSpec {
  return STEP_SCHEMA[type];
}

// True when `field` should be visible given the step's current values.
//
// Shared by the editor and the validator so a hidden field is never required --
// otherwise `attr` would block saving every extract that is not reading an
// attribute.
export function fieldVisible(field: FieldSpec, values: Record<string, unknown>): boolean {
  if (!field.showWhen) {
    return true;
  }
  return Object.entries(field.showWhen).every(([key, expected]) => {
    const actual = values[key];
    return Array.isArray(expected) ?
      expected.includes(String(actual)) :
      String(actual) === expected;
  });
}
