// Hand-written declarations for progress.cjs, so the vitest suite under src/ can
// import the real module instead of testing a copy. Nothing compiles electron/,
// so these are maintained beside the implementation -- change one, change the
// other. Same contract as redact.d.cts and notify.d.cts.

// The subset of an automation_runs record these functions read. The record
// itself is wider (vars, failed_step_id, per-entry step metadata); this names
// only what is looked at, plus an index signature so passing the real record --
// which carries all of it -- is not an error at a call site or in a test.
export interface RunLogEntryShape {
  message?: string;
  [key: string]: unknown;
}

export interface RunRecordShape {
  id?: string;
  status?: string;
  automation_id?: string;
  automation_name?: string;
  trigger?: string;
  started_at?: string | null;
  finished_at?: string | null;
  step_count?: number;
  total_steps?: number;
  error?: string | null;
  log?: RunLogEntryShape[];
  [key: string]: unknown;
}

export interface RunSummary {
  runId: string;
  status: string;
  automationId: string;
  automationName: string;
  trigger: string;
  startedAt: string | null;
  finishedAt: string | null;
  stepCount: number;
  totalSteps: number;
  /** null means "cannot say" -- render an indeterminate bar, not zero. */
  progress: number | null;
  currentStep: string;
  error: string | null;
}

export function progressOf(record: RunRecordShape | null | undefined): number | null;

export function currentStepOf(record: RunRecordShape | null | undefined): string;

export function runSummary(record: RunRecordShape | null | undefined): RunSummary | null;
