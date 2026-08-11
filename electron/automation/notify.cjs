// Notify-on-finish: whether a finished run notifies, and what the message says.
//
// Pure on purpose -- no electron, no fs, no state -- so the two decisions the
// feature turns on can be unit-tested from src/automations/notifyOnFinish.test.ts
// against the real code rather than a copy. The runner calls shouldNotify from
// its finally; main.cjs calls composeFinishMessage to build the OS
// notification, the bell row and the connector message from one place.
//
// Everything here READS the run record and computes nothing of its own: the
// record decided the verdict, and a notification that works the outcome out a
// second time is a second place for the two to disagree.

// 'always' | 'failure' | null -> does this run's outcome go out?
//
// Cancelled never notifies, under either setting. A cancel is the user's own
// action, taken while watching -- the same reasoning that keeps close_on_finish
// from firing on cancel. "Always" means "tell me the outcome when I'm not
// looking", and there is no outcome to report about a run the user just ended
// themselves.
//
// 'failure' includes 'partial': a partial run contained a real step failure
// that onError:'continue' stepped past, and "tell me on failure" staying
// silent about it would make the setting a liar.
function shouldNotify(notifyOn, status) {
  if (status === 'cancelled') {
    return false;
  }
  if (notifyOn === 'always') {
    return true;
  }
  if (notifyOn === 'failure') {
    return status === 'failed' || status === 'partial';
  }
  return false;
}

// The verdict at a glance, for the channels that render one. A Telegram
// notification is read on a phone, in a list of chats, next to a dozen other
// bots -- the emoji is what says "this one needs you" before a word is read.
// Deliberately three distinguishable marks and not a green/red pair: partial
// is its own outcome (the run finished, a step did not) and flattening it into
// either one loses the thing the reader has to act on.
const STATUS_EMOJI = {
  ok: '✅',
  partial: '⚠️',
  failed: '❌',
  cancelled: '🛑',
};

function statusEmoji(status) {
  return STATUS_EMOJI[status] || 'ℹ️';
}

function formatDuration(ms) {
  const total = Math.max(0, Math.round(Number(ms) || 0));
  const seconds = Math.round(total / 1000);
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${seconds - minutes * 60}s`;
}

// The failing step, as the log described it -- "Go to example.com" -- rather
// than as an id nobody can read. The log entry is the one place the step's
// summary already exists on the record; falling back to the raw id keeps the
// message honest when the failure happened outside any logged step.
function failedStepLabel(record) {
  if (!record.failed_step_id) {
    return '';
  }
  const entries = Array.isArray(record.log) ? record.log : [];
  for (let index = entries.length - 1; index >= 0; index--) {
    const entry = entries[index];
    if (entry && entry.stepId === record.failed_step_id && entry.message) {
      return entry.message;
    }
  }
  return `step ${record.failed_step_id}`;
}

// One finished run described in three pieces: `title`, the sentence around
// the error (`lead` before it, `trail` after), and the error itself held
// apart.
//
// Split rather than returned as one string because the two renderings differ
// only in where the error goes -- inline for plain text, in its own monospace
// block for Telegram. Composing each from the record separately would be two
// places to keep saying the same true thing.
//
// A failed run must produce a message that says so, naming the step and the
// error -- a summary that only ever reports success is worse than none.
function describeFinish(record) {
  const name = record.automation_name || 'Automation';
  const where = record.profile_name ? ` on ${record.profile_name}` : '';
  const took = record.duration_ms == null ? '' : ` in ${formatDuration(record.duration_ms)}`;
  const error = String(record.error || '').trim();
  switch (record.status) {
    case 'ok':
      return {
        title: `${name} finished`,
        lead: `Finished${took}${where}`,
        trail: '.',
        error: '',
      };
    case 'partial': {
      const step = failedStepLabel(record);
      return {
        title: `${name} finished with a failed step`,
        lead: step ? `"${step}" failed` : 'A step failed',
        trail: `. The run continued and finished${took}${where}.`,
        error,
      };
    }
    case 'failed': {
      const step = failedStepLabel(record);
      return {
        title: `${name} failed`,
        lead: `${step ? `Failed at "${step}"` : 'Failed'}${took}${where}`,
        // The full stop the error's colon would otherwise replace.
        trail: error ? '' : '.',
        error,
      };
    }
    default:
      // 'cancelled' never reaches here (shouldNotify refuses it) and 'running'
      // cannot -- but a record from a future status still composes something
      // truthful rather than throwing inside a finally.
      return {
        title: `${name} ${record.status || 'finished'}`,
        lead: `Ended with status "${record.status}"${took}${where}`,
        trail: '.',
        error: '',
      };
  }
}

// {title, body} for the plain-text deliveries of one finished run: the OS
// notification, the bell row and every connector that has no rich text, all
// from one place so they can never tell three stories.
function composeFinishMessage(record) {
  const {title, lead, trail, error} = describeFinish(record);
  return {title, body: `${lead}${error ? `: ${error}` : ''}${trail}`};
}

// Telegram's HTML mode is the smallest of the three parse modes to get right:
// only these three characters are special, and escaping them is the whole
// contract. MarkdownV2 would demand escaping eighteen characters in every step
// label and error string, and one missed backslash is a 400 that loses the
// message -- for a channel whose entire job is to report failures, that is the
// wrong trade.
function escapeHtml(text) {
  return String(text ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
}

// The same finished run as composeFinishMessage, marked up for Telegram:
// emoji verdict, bold headline, and the error in a <pre> block.
//
// Composed from the record rather than by decorating the plain body, because
// the error has to come OUT of the prose to go into its own block -- a stack
// trace or a selector reads as noise inline and as evidence in monospace, and
// Telegram's <pre> is also the only part of a message a phone can long-press
// and copy cleanly.
//
// Returns HTML for `parse_mode: 'HTML'`. Every interpolated value is escaped:
// selectors (`#promo > .price`) and error text are exactly the strings most
// likely to carry an angle bracket.
function composeFinishTelegram(record) {
  const {title, lead, trail, error} = describeFinish(record);
  return `${statusEmoji(record.status)} <b>${escapeHtml(title)}</b>\n` +
    // `trail` is empty exactly when the plain text ends on the error's colon;
    // with the error lifted out, the sentence needs its full stop back.
    escapeHtml(`${lead}${trail || '.'}`) +
    (error ? `\n<pre>${escapeHtml(error)}</pre>` : '');
}

module.exports = {composeFinishMessage, composeFinishTelegram, escapeHtml, shouldNotify, statusEmoji};
