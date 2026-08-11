// Hand-written declarations for notify.cjs, so the vitest suite under src/
// can import the real module instead of testing a copy. Nothing compiles
// electron/, so these are maintained beside the implementation -- change one,
// change the other (the src/lib/cookieFile.ts contract, in miniature).

export function shouldNotify(
  notifyOn: 'always' | 'failure' | null | undefined,
  status: string,
): boolean;

interface FinishedRunRecord {
  automation_name?: string | null;
  profile_name?: string | null;
  status?: string | null;
  duration_ms?: number | null;
  failed_step_id?: string | null;
  error?: string | null;
  log?: {stepId?: string; message?: string}[];
}

export function composeFinishMessage(
  record: FinishedRunRecord,
): {title: string; body: string};

// The same run as Telegram HTML -- emoji verdict, bold title, error in a
// <pre> block. Send with parse_mode 'HTML'.
export function composeFinishTelegram(record: FinishedRunRecord): string;

export function escapeHtml(text: unknown): string;

export function statusEmoji(status: string | null | undefined): string;
