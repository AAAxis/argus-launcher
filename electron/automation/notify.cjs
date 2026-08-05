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

// {title, body} for every delivery of one finished run: the OS notification,
// the bell row and the connector message all carry this, so the three can
// never tell three stories.
//
// A failed run must produce a message that says so, naming the step and the
// error -- a summary that only ever reports success is worse than none.
function composeFinishMessage(record) {
  const name = record.automation_name || 'Automation';
  const where = record.profile_name ? ` on ${record.profile_name}` : '';
  const took = record.duration_ms == null ? '' : ` in ${formatDuration(record.duration_ms)}`;
  switch (record.status) {
    case 'ok':
      return {
        title: `${name} finished`,
        body: `Finished${took}${where}.`,
      };
    case 'partial': {
      const step = failedStepLabel(record);
      return {
        title: `${name} finished with a failed step`,
        body: `${step ? `"${step}" failed` : 'A step failed'}` +
          `${record.error ? `: ${record.error}` : ''}. The run continued and ` +
          `finished${took}${where}.`,
      };
    }
    case 'failed': {
      const step = failedStepLabel(record);
      return {
        title: `${name} failed`,
        body: `${step ? `Failed at "${step}"` : 'Failed'}${took}${where}` +
          `${record.error ? `: ${record.error}` : '.'}`,
      };
    }
    default:
      // 'cancelled' never reaches here (shouldNotify refuses it) and 'running'
      // cannot -- but a record from a future status still composes something
      // truthful rather than throwing inside a finally.
      return {
        title: `${name} ${record.status || 'finished'}`,
        body: `Ended with status "${record.status}"${took}${where}.`,
      };
  }
}

module.exports = {composeFinishMessage, shouldNotify};
