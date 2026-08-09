// Which variables a step tree writes, and which it asks for.
//
// Two jobs, both for the editor:
//   1. the insert chips under every interpolated field, so a parameter can be
//      dropped into a URL without anyone typing {{vars.}} by hand;
//   2. a warning when a step reads a variable nothing in the automation sets --
//      the failure mode a rename leaves behind, which today surfaces only as a
//      run that dies three steps in with an interpolation error.
//
// The warning is deliberately NOT a validation error. A variable can arrive
// legitimately from a caller through callAutomation, or from an MCP `vars`
// seed, and neither is visible from this automation's own document. Blocking
// Save on it would refuse to save a workflow that runs perfectly well.
import {STEP_SCHEMA} from './schema';
import type {AutomationStep} from './types';
import type {AutomationParam} from './parameters';

// The same template shape interpolate.cjs matches. Only the ROOT segment is
// captured: {{vars.rows.0.title}} is a reference to `rows`.
const VARS_TEMPLATE = /\{\{\s*vars\.([A-Za-z_][A-Za-z0-9_]*)/g;

// Walks a step list and its nested branches. `steps`-kind fields are the
// recursion (if.then/else, loop.body), exactly as the runner and the editor's
// own validator find them.
function walk(steps: AutomationStep[], visit: (step: AutomationStep) => void) {
  for (const step of steps || []) {
    visit(step);
    const spec = STEP_SCHEMA[step.type];
    for (const field of spec?.fields || []) {
      if (field.kind === 'steps') {
        const nested = (step as unknown as Record<string, unknown>)[field.key];
        if (Array.isArray(nested)) {
          walk(nested as AutomationStep[], visit);
        }
      }
    }
  }
}

// Every variable name the tree writes: setVar.name, extract.into and the rest,
// found through the schema's `writesVar` marker rather than by key name.
export function writtenVarNames(steps: AutomationStep[]): Set<string> {
  const names = new Set<string>();
  walk(steps, (step) => {
    const spec = STEP_SCHEMA[step.type];
    for (const field of spec?.fields || []) {
      if (!field.writesVar) {
        continue;
      }
      const value = (step as unknown as Record<string, unknown>)[field.key];
      if (typeof value === 'string' && value !== '') {
        names.add(value);
      }
    }
  });
  return names;
}

// Every {{vars.x}} the tree reads, with the step that reads it.
//
// Only fields the catalogue marks `interpolate` are scanned, because those are
// the only ones substitution touches -- a {{ }} inside an `evaluate` script is
// left alone at run time and must be left alone here too, or the editor would
// warn about a variable that is really just JavaScript.
export function referencedVarNames(
    steps: AutomationStep[]): {name: string; stepLabel: string}[] {
  const found: {name: string; stepLabel: string}[] = [];
  walk(steps, (step) => {
    const spec = STEP_SCHEMA[step.type];
    for (const field of spec?.fields || []) {
      if (!field.interpolate) {
        continue;
      }
      const value = (step as unknown as Record<string, unknown>)[field.key];
      // Conditions carry their templates one level down, in left/right.
      const texts = field.kind === 'condition' ?
        Object.values((value as Record<string, unknown>) || {}) : [value];
      for (const text of texts) {
        if (typeof text !== 'string') {
          continue;
        }
        for (const match of text.matchAll(VARS_TEMPLATE)) {
          found.push({name: match[1], stepLabel: step.label || spec?.label || step.type});
        }
      }
    }
  });
  return found;
}

// Sentences for the editor's problem list. Empty when every reference has a
// source. NOT blocking -- see the note at the top of this file.
export function unsetVariables(
    steps: AutomationStep[], parameters: AutomationParam[] = []): string[] {
  const declared = new Set(parameters.map((param) => param.name));
  const written = writtenVarNames(steps);
  const seen = new Set<string>();
  const problems: string[] = [];
  for (const {name, stepLabel} of referencedVarNames(steps)) {
    if (declared.has(name) || written.has(name) || seen.has(name)) {
      continue;
    }
    seen.add(name);
    problems.push(`"${stepLabel}" reads {{vars.${name}}}, which no parameter ` +
      'declares and no step sets. It has to come from a caller or an API run.');
  }
  return problems;
}
