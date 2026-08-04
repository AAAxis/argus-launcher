// {{path}} substitution for step fields.
//
// Four rules here are load-bearing. Each one is a bug that has a name.
//
// 1. Only fields the schema marks `interpolate: true` are touched. evaluate.script
//    is marked false explicitly: splicing user data into source is injection,
//    and a {{ }} that happens to appear inside real JavaScript would be
//    silently rewritten. Values reach a script through `args` instead, which
//    ARE interpolated and are passed as a real value.
//
// 2. A whole-field template keeps its type. If a field is exactly
//    "{{vars.rows}}" the result is the array, not "[object Object]" -- which is
//    what makes `loop.items` work at all. Any other shape ("page {{vars.n}}")
//    stringifies and concatenates.
//
// 3. An unresolved path FAILS the step, with a did-you-mean. Substituting ""
//    silently is how `goto https://{{vars.hst}}/x` becomes https:///x and
//    nobody can tell why. This is the "no phantom data" rule applied to
//    templates.
//
// 4. There is no {{env.*}}. Reading the launcher's process environment into a
//    page is a leak vector with no MVP use case.

const TEMPLATE = /\{\{\s*([A-Za-z0-9_.[\]]+)\s*\}\}/g;
const WHOLE_TEMPLATE = /^\s*\{\{\s*([A-Za-z0-9_.[\]]+)\s*\}\}\s*$/;

// Walks `profile.email`, `vars.rows.0.title`, `vars.items[2]`.
// Returns {found, value} rather than undefined so a variable legitimately
// holding undefined is distinguishable from one that does not exist.
function resolvePath(context, path) {
  const parts = String(path)
      .replace(/\[(\d+)\]/g, '.$1')
      .split('.')
      .filter(Boolean);
  let current = context;
  for (const part of parts) {
    if (current === null || current === undefined) {
      return {found: false, value: undefined};
    }
    if (typeof current !== 'object') {
      return {found: false, value: undefined};
    }
    if (!(part in current)) {
      return {found: false, value: undefined};
    }
    current = current[part];
  }
  return {found: true, value: current};
}

// Every path a template could legally use right now, for the error message and
// for the editor's insert menu.
function knownPaths(context, prefix = '', depth = 0) {
  if (depth > 2 || !context || typeof context !== 'object') {
    return [];
  }
  const paths = [];
  for (const [key, value] of Object.entries(context)) {
    const path = prefix ? `${prefix}.${key}` : key;
    paths.push(path);
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      paths.push(...knownPaths(value, path, depth + 1));
    }
  }
  return paths;
}

// Cheap edit distance, capped -- this only ever runs on the failure path.
function distance(a, b) {
  const rows = a.length + 1;
  const cols = b.length + 1;
  let previous = Array.from({length: cols}, (_, i) => i);
  for (let i = 1; i < rows; i++) {
    const current = [i];
    for (let j = 1; j < cols; j++) {
      current[j] = Math.min(
          previous[j] + 1,
          current[j - 1] + 1,
          previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return previous[cols - 1];
}

function didYouMean(path, context) {
  const candidates = knownPaths(context);
  let best = null;
  let bestScore = Infinity;
  for (const candidate of candidates) {
    const score = distance(path, candidate);
    if (score < bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  // Only suggest something genuinely close, or the hint is noise.
  return best && bestScore <= Math.max(2, Math.floor(path.length / 3)) ? best : null;
}

class InterpolationError extends Error {
  constructor(path, context) {
    const hint = didYouMean(path, context);
    super(hint ?
      `Unknown variable "${path}" (did you mean "${hint}"?)` :
      `Unknown variable "${path}"`);
    this.name = 'InterpolationError';
    this.path = path;
  }
}

// Resolves one field value. Strings get template treatment; objects and arrays
// are walked so `args` and `headers` maps interpolate their values too.
function render(value, context) {
  if (typeof value === 'string') {
    const whole = value.match(WHOLE_TEMPLATE);
    if (whole) {
      const {found, value: resolved} = resolvePath(context, whole[1]);
      if (!found) {
        throw new InterpolationError(whole[1], context);
      }
      return resolved;
    }
    return value.replace(TEMPLATE, (_match, path) => {
      const {found, value: resolved} = resolvePath(context, path);
      if (!found) {
        throw new InterpolationError(path, context);
      }
      if (resolved === null || resolved === undefined) {
        return '';
      }
      return typeof resolved === 'object' ? JSON.stringify(resolved) : String(resolved);
    });
  }
  if (Array.isArray(value)) {
    return value.map((entry) => render(entry, context));
  }
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, entry] of Object.entries(value)) {
      out[key] = render(entry, context);
    }
    return out;
  }
  return value;
}

// Returns a copy of `step` with every interpolatable field resolved.
//
// Nested step lists (`then`, `else`, `body`) are deliberately NOT resolved
// here: their steps are interpolated when they run, so a loop body sees the
// current {{loop.item}} rather than whatever it held on the first pass.
function interpolateStep(step, context, schema) {
  const spec = schema[step.type];
  if (!spec) {
    return step;
  }
  const out = {...step};
  for (const field of spec.fields) {
    if (!field.interpolate || field.kind === 'steps') {
      continue;
    }
    if (out[field.key] === undefined) {
      continue;
    }
    out[field.key] = render(out[field.key], context);
  }
  // `if` carries its comparands inside `condition`, which has its own kind and
  // so is not in the field loop above.
  if (step.type === 'if' && step.condition) {
    out.condition = {
      ...step.condition,
      left: render(step.condition.left ?? '', context),
      right: step.condition.right === undefined ?
        undefined :
        render(step.condition.right, context),
    };
  }
  return out;
}

module.exports = {InterpolationError, interpolateStep, knownPaths, render, resolvePath};
