// Turns the database's own guard rails into sentences a user can act on.
//
// Limits are enforced by triggers (docs/data-model.md), not by the launcher --
// the launcher runs on hardware the customer controls, so a client-side cap is
// decoration. That means the *first* time the app hears about a limit is as a
// Postgres exception, and these strings are the whole UX for it. The exact
// tokens raised by 0003_limits_triggers.sql are `profile_limit_reached` and
// `seat_limit_reached`, both with errcode check_violation (23514).
import {CloudUnavailableError} from './client';

function messageOf(error: unknown): string {
  if (error instanceof Error) {
    const dbError = (error as Error & {dbError?: {message?: string; details?: string}}).dbError;
    return `${error.message} ${dbError?.details || ''}`;
  }
  if (error && typeof error === 'object') {
    const candidate = error as {message?: string; details?: string};
    return `${candidate.message || ''} ${candidate.details || ''}`;
  }
  return String(error ?? '');
}

export function describeDbError(error: unknown, fallback = 'Something went wrong'): string {
  if (error instanceof CloudUnavailableError) {
    return error.message;
  }
  const raw = messageOf(error);

  if (raw.includes('profile_limit_reached')) {
    return 'Your plan\'s profile limit is full. Delete a profile (Trash still counts once ' +
      'restored) or upgrade the plan to add more.';
  }
  if (raw.includes('seat_limit_reached')) {
    return 'Your plan\'s seat limit is full. Upgrade the plan to invite more people.';
  }
  // Raised by trg_automation_limit (2026-08-05-automations.sql). The free
  // default is 0, so this is the first thing a free-plan user hits on the
  // Automations tab -- it has to say what to do, not just what failed.
  if (raw.includes('automation_limit_reached')) {
    return 'Your plan doesn\'t include any more automations. Delete one, or upgrade the ' +
      'plan to add more.';
  }
  // Ids are also on-disk directory names (E:\ArgysProfiles\<id>), which is what
  // the *_id_fs_safe CHECKs protect. The CSV importer writes profile_id
  // verbatim, so this is reachable from real user input.
  if (raw.includes('_id_fs_safe') || raw.includes('cookie_sets_id_shape')) {
    return 'That id can\'t be used: ids double as folder names, so they may only contain ' +
      'letters, digits, dot, dash and underscore, must start with a letter or digit, and ' +
      'must be 128 characters or shorter.';
  }
  if (raw.includes('proxy_mode_check')) {
    return 'Unknown proxy mode. Pick Assigned, Direct or Free Proxy.';
  }
  if (raw.includes('cookie_mode_check')) {
    return 'Unknown cookie mode.';
  }
  if (raw.includes('not_authenticated')) {
    return 'Your session expired. Sign in again.';
  }
  // 23505: duplicate key. The only client-reachable one is re-adding an
  // extension id, which addExtensionFromWebStoreLink already checks for.
  if (raw.includes('duplicate key value')) {
    return 'That already exists.';
  }
  if (raw.includes('violates row-level security')) {
    return 'You don\'t have permission to change that in this organization.';
  }

  const direct = error instanceof Error ? error.message : '';
  return direct || fallback;
}
