// How a run's status is spelled and coloured.
//
// Shared by the Automations tab and the run-log dialog because they used to
// disagree: the tab spelled 'ok' as "Succeeded" and the dialog printed the raw
// enum, and both reached for classes -- apply-status-warn, apply-status-busy --
// that are not defined in any stylesheet, so three of the five statuses were
// silently unstyled in both places.
//
// Both maps are keyed by RunStatus rather than by string, so a status added to
// the union has to be given a label and a tone here or typecheck fails.
import type {BadgeTone} from '../components/ui/Badge';
import type {RunStatus} from './types';

export const RUN_TONE: Record<RunStatus, BadgeTone> = {
  ok: 'active',
  // Amber, not red: a partial run did every step it could and told you which
  // one it could not. That is a different thing from a failure.
  partial: 'warmup',
  failed: 'ban',
  cancelled: 'neutral',
  running: 'review',
};

export const RUN_LABEL: Record<RunStatus, string> = {
  ok: 'Succeeded',
  partial: 'Finished with errors',
  failed: 'Failed',
  cancelled: 'Cancelled',
  running: 'Running',
};
