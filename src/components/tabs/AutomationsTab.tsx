// The Automations library.
//
// Cards rather than table rows: there are few of these and each carries more
// than a row's worth -- name, description, step count, where it is wired in,
// and how its last run went. The same call the Extensions tab made.
import {History, Play, Trash2, Workflow} from 'lucide-react';
import {BusyButton} from '../ui/BusyButton';
import {EmptyState} from '../ui/EmptyState';
import {useOrg} from '../../org';
import {useWorkspace} from '../../workspace/WorkspaceProvider';
import type {ArgusAutomation, AutomationRun} from '../../types';

const STATUS_TONE: Record<string, string> = {
  ok: 'apply-status-ok',
  partial: 'apply-status-warn',
  failed: 'apply-status-error',
  cancelled: 'apply-status-warn',
  running: 'apply-status-busy',
};

const STATUS_LABEL: Record<string, string> = {
  ok: 'Succeeded',
  partial: 'Finished with errors',
  failed: 'Failed',
  cancelled: 'Cancelled',
  running: 'Running',
};

export function AutomationsTab({onEdit, onNew, onHistory}: {
  onEdit: (automation: ArgusAutomation) => void;
  onNew: () => void;
  onHistory: (automation: ArgusAutomation) => void;
}) {
  const {data, automations, selectedProfileId} = useWorkspace();
  const org = useOrg();
  const {state} = data;
  const list = state.automations;
  // UX only, never security: trg_automation_limit is the real gate and
  // describeDbError turns its exception into the same sentence. This just says
  // it before the click rather than after. null means unlimited, matching
  // profile_limit's convention.
  const limit = org.org?.automation_limit ?? 0;
  const atCap = limit !== null && list.length >= limit;

  // The newest run per automation, from whatever this session has seen. Older
  // history lives in the database and is opened explicitly -- see onHistory.
  const latest = new Map<string, AutomationRun>();
  for (const run of Object.values(automations.runs)) {
    if (!run.automation_id) {
      continue;
    }
    const seen = latest.get(run.automation_id);
    if (!seen || run.started_at > seen.started_at) {
      latest.set(run.automation_id, run);
    }
  }

  if (list.length === 0) {
    return (
      <section className="automations-tab">
        <EmptyState
          hero
          icon={<Workflow size={20} strokeWidth={1.75} />}
          title="No automations yet"
          body={'An automation is a list of steps run against a profile: open a page, ' +
            'fill a form, read something back. Attach one to a profile and it runs ' +
            'when that profile launches.'}
        >
          {atCap ? (
            <p className="field-hint">
              Your plan doesn't include any automations. Upgrade on the website to add one.
            </p>
          ) : (
            <button className="primary" onClick={onNew}>New automation</button>
          )}
        </EmptyState>
      </section>
    );
  }

  return (
    <section className="automations-tab">
      <div className="automation-grid">
        {list.map((automation) => {
          const attachedTo = state.profiles.filter(
              (profile) => !profile.deleted_at && profile.automation_id === automation.id);
          const run = latest.get(automation.id);
          const busy = run?.status === 'running';
          return (
            <article className="automation-card" key={automation.id}>
              <header className="automation-card-head">
                <h2>{automation.name}</h2>
                {automation.description && <p>{automation.description}</p>}
              </header>

              <div className="automation-card-meta">
                <span className="status-pill">
                  {automation.steps.length} step{automation.steps.length === 1 ? '' : 's'}
                </span>
                {attachedTo.length > 0 && (
                  <span className="status-pill" title={attachedTo.map((p) => p.name).join(', ')}>
                    On launch · {attachedTo.length}
                  </span>
                )}
                {automation.pinned && <span className="status-pill">Start page</span>}
              </div>

              {run && (
                <p className={`automation-card-run ${STATUS_TONE[run.status] || ''}`}>
                  {STATUS_LABEL[run.status] || run.status}
                  {run.status !== 'running' && run.duration_ms ?
                    ` in ${(run.duration_ms / 1000).toFixed(1)}s` :
                    ''}
                  {run.error ? ` — ${run.error}` : ''}
                </p>
              )}

              <div className="automation-card-actions">
                <BusyButton
                  busy={busy}
                  busyLabel="Running"
                  icon={<Play size={14} />}
                  onClick={() => {
                    // Runs against the highlighted profile, or the profile it
                    // is attached to when there is exactly one. Anything more
                    // ambiguous than that is the user's choice to make, so it
                    // says so rather than guessing.
                    const target = attachedTo.length === 1 ?
                      attachedTo[0] :
                      state.profiles.find(
                          (profile) => profile.id === selectedProfileId && !profile.deleted_at);
                    if (!target) {
                      return;
                    }
                    void automations.run(automation, target);
                  }}
                  disabled={attachedTo.length !== 1 && !selectedProfileId}
                  title={attachedTo.length === 1 ?
                    `Run against ${attachedTo[0].name}` :
                    'Runs against the profile selected on the Profiles tab'}
                >Run</BusyButton>
                <button className="ghost" onClick={() => onEdit(automation)}>Edit</button>
                <button
                  className="ghost"
                  onClick={() => onHistory(automation)}
                  aria-label={`History for ${automation.name}`}
                ><History size={14} /></button>
                <button
                  className="ghost row-action-danger"
                  aria-label={`Delete ${automation.name}`}
                  onClick={() => {
                    const detaching = attachedTo.length > 0 ?
                      `\n\n${attachedTo.length} profile${attachedTo.length === 1 ? '' : 's'} ` +
                        'will stop running it on launch.' :
                      '';
                    if (window.confirm(`Delete "${automation.name}"?${detaching}`)) {
                      void automations.remove([automation.id]);
                    }
                  }}
                ><Trash2 size={14} /></button>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
