// Hand-written declarations for notify.cjs, so the vitest suite under src/
// can import the real module instead of testing a copy. Nothing compiles
// electron/, so these are maintained beside the implementation -- change one,
// change the other (the src/lib/cookieFile.ts contract, in miniature).

export function shouldNotify(
  notifyOn: 'always' | 'failure' | null | undefined,
  status: string,
): boolean;

export function composeFinishMessage(record: {
  automation_name?: string | null;
  profile_name?: string | null;
  status?: string | null;
  duration_ms?: number | null;
  failed_step_id?: string | null;
  error?: string | null;
  log?: {stepId?: string; message?: string}[];
}): {title: string; body: string};
