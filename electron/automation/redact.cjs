// Keeping a `secret` parameter's value out of the run record.
//
// automation_runs.vars is sealed onto every run and readable by the whole
// workspace, and every log line carries the variable its step wrote. So a
// parameter the editor masks behind dots would arrive in run history in plain
// text -- a masked field that leaks is worse than an unmasked one, because it
// tells the user the value is protected when it is not.
//
// Redaction happens at SEAL and LOG time only. Interpolation keeps the real
// value throughout the run: the point is that the secret still works, not that
// it stops reaching the page.
//
// The names arrive from the renderer (secretVarNames in
// src/automations/parameters.ts) rather than being read off the automation
// here, and that is load-bearing rather than incidental: a callAutomation
// target shares the caller's variable bag, and this process holds no
// catalogue -- resolvedAutomations carries steps, not declarations -- so a
// callee's secret would be invisible to anything reading only the root
// automation. The renderer already walks the call tree to resolve the bag; it
// collects the names on the same pass.
//
// This is display protection in a record, not encryption. The value itself sits
// in Supabase in plain text, exactly like every proxy password and connector
// credential already does, and the editor's hint says so to the user.

const MASK = '••••';

// A copy of `vars` with every named key masked. Returns the input untouched
// when nothing is secret, which is the common case -- no allocation for the
// automations that declare none.
function redactSecrets(vars, secretVarNames) {
  const names = new Set(Array.isArray(secretVarNames) ? secretVarNames : []);
  if (names.size === 0 || !vars || typeof vars !== 'object') {
    return vars;
  }
  const out = {};
  for (const [name, value] of Object.entries(vars)) {
    out[name] = names.has(name) ? MASK : value;
  }
  return out;
}

module.exports = {MASK, redactSecrets};
