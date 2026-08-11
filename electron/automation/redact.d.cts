// Hand-written declarations for redact.cjs, so the vitest suite under src/ can
// import the real module instead of testing a copy. Nothing compiles electron/,
// so these are maintained beside the implementation -- change one, change the
// other. Same contract as notify.d.cts.

export const MASK: string;

export function redactSecrets<T>(
  vars: T,
  secretVarNames: string[] | undefined,
): T;
