// The automation editor: an ordered step list, or the raw JSON behind it.
//
// The JSON view is not a debug affordance. It is the same shape an agent writes
// over MCP, so it is how a user checks what an agent built, and how they paste
// one in. It round-trips losslessly, and a parse or validation failure renders
// inline WITHOUT clobbering the step list -- you keep editing the text until it
// is right, rather than losing it the moment you mistype a brace.
import {useState} from 'react';
import {Pencil, Play, Send, Trash2} from 'lucide-react';
import {Modal} from '../ui/Modal';
import {Field} from '../ui/Field';
import {BrandIconPicker} from '../ui/BrandIconPicker';
import {BusyButton} from '../ui/BusyButton';
import {ColorPicker} from '../ui/ColorPicker';
import {TagInput} from '../ui/TagInput';
import {StepList} from '../automations/StepList';
import {STEP_SCHEMA} from '../../automations/schema';
import {
  MIN_INTERVAL_MINUTES, MAX_INTERVAL_MINUTES, validateSchedule,
} from '../../automations/schedule';
import {assigneeName} from '../../lib/assignees';
import {MAX_PROFILE_TAGS} from '../../lib/tags';
import type {AutomationSchedule, ScheduleKind} from '../../automations/schedule';
import type {TagUsage} from '../../lib/tags';
import type {ArgusAutomation, OrgMember} from '../../types';
import type {AutomationStep} from '../../automations/types';

// Mirrors electron/automation/steps.cjs validateSteps closely enough to catch
// what the editor can catch. The runner validates again before it runs anything
// -- this one is for the JSON view, where a hand-typed step can be any shape.
function validate(steps: unknown, path = 'steps', depth = 0): string[] {
  const problems: string[] = [];
  if (!Array.isArray(steps)) {
    return [`${path} must be a list`];
  }
  if (depth > 3) {
    return [`${path} is nested deeper than 3 levels`];
  }
  steps.forEach((step: unknown, index) => {
    const at = `${path}[${index}]`;
    if (!step || typeof step !== 'object') {
      problems.push(`${at} must be an object`);
      return;
    }
    const record = step as Record<string, unknown>;
    const spec = STEP_SCHEMA[record.type as keyof typeof STEP_SCHEMA];
    if (!spec) {
      problems.push(`${at}.type "${String(record.type)}" is not a known step type`);
      return;
    }
    if (!record.id) {
      problems.push(`${at}.id is required`);
    }
    for (const field of spec.fields) {
      if (field.kind === 'steps') {
        if (record[field.key] !== undefined) {
          problems.push(...validate(record[field.key], `${at}.${field.key}`, depth + 1));
        }
        continue;
      }
      const visible = !field.showWhen || Object.entries(field.showWhen).every(([key, expected]) =>
        Array.isArray(expected) ?
          expected.includes(String(record[key])) :
          String(record[key]) === expected);
      if (visible && field.required &&
          (record[field.key] === undefined || record[field.key] === '')) {
        problems.push(`${at}.${field.key} is required`);
      }
    }
  });
  return problems;
}

// The automation's name, as the dialog's heading.
//
// It was a labelled input in the sidebar, below the Steps/JSON toggle and above
// four settings -- so the one thing that identifies what you are editing sat
// fifth in a column of equals, while the header said "New automation" no matter
// what you had typed. Same call as StatusChip: the name is the value, the
// pencil is the way to change it.
function TitleField({value, onChange}: {
  value: string;
  onChange: (name: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  // Held locally while editing so Escape has something to revert to, and so an
  // empty box mid-retype does not disable Save on every keystroke.
  const [text, setText] = useState(value);

  if (!editing) {
    return (
      <span className="automation-title">
        <span className="automation-title-text">{value.trim() || 'Untitled automation'}</span>
        <button
          type="button"
          className="icon-button"
          aria-label="Rename this automation"
          title="Rename"
          onClick={() => {
            setText(value);
            setEditing(true);
          }}
        ><Pencil size={14} /></button>
      </span>
    );
  }

  function commit() {
    setEditing(false);
    const next = text.trim();
    // An empty name blocks Save, and silently keeping the old one would hide
    // that the rename did not take. Empty is allowed through and the footer
    // says why.
    onChange(next);
  }

  return (
    <span className="automation-title">
      <input
        type="text"
        className="automation-title-input"
        autoFocus
        value={text}
        placeholder="Name this automation"
        onChange={(event) => setText(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            commit();
          }
          if (event.key === 'Escape') {
            // Stops the dialog closing as well -- Modal listens for Escape.
            event.stopPropagation();
            setText(value);
            setEditing(false);
          }
        }}
      />
    </span>
  );
}

// The run budget, in seconds.
//
// It was "Run timeout (ms)" over a raw 300000, which asks the reader to divide
// by a thousand and then by sixty before they can answer "how long is that",
// and to know that a *step* timeout lives somewhere else entirely. Storage is
// untouched -- automations.timeout_ms is still milliseconds, and the local API
// still caps at 600000. This converts at the edge.
//
// The text is held locally so the box can be empty mid-retype. Bound straight
// to the draft it could not be: clearing it would write 0, and a run budget of
// zero milliseconds is not a state worth being able to type.
const DEFAULT_TIMEOUT_MS = 300000;
const MIN_TIMEOUT_SEC = 1;
const MAX_TIMEOUT_SEC = 600;

function describeSeconds(seconds: number): string {
  if (seconds < 60) {
    return `${seconds} second${seconds === 1 ? '' : 's'}`;
  }
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  const minutePart = `${minutes} minute${minutes === 1 ? '' : 's'}`;
  return rest === 0 ? minutePart : `${minutePart} ${rest} sec`;
}

function TimeoutField({value, onChange}: {
  value: number;
  onChange: (timeoutMs: number) => void;
}) {
  const [text, setText] = useState(() => String(Math.round(value / 1000)));
  const seconds = Math.round(value / 1000);

  return (
    <Field
      label={
        <>
          Give up after
          <span className="field-echo">= {describeSeconds(seconds)}</span>
        </>
      }
      hint="The whole run, not one step. The most Argus allows is 10 minutes."
    >
      <span className="field-suffixed">
        <input
          type="number"
          min={MIN_TIMEOUT_SEC}
          max={MAX_TIMEOUT_SEC}
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            const next = Number(event.target.value);
            // An empty or nonsense box leaves the saved value alone; the echo
            // above keeps showing what would be saved.
            if (event.target.value !== '' && Number.isFinite(next) && next > 0) {
              onChange(Math.min(MAX_TIMEOUT_SEC, next) * 1000);
            }
          }}
          // Clamping on blur rather than on every keystroke: clamping as you
          // type turns "600" into "6" the moment the 6 lands under a max of 60.
          onBlur={() => {
            const clamped = Math.min(
                MAX_TIMEOUT_SEC,
                Math.max(MIN_TIMEOUT_SEC, Math.round(Number(text) || seconds)));
            setText(String(clamped));
            onChange(clamped * 1000);
          }}
        />
        <span aria-hidden="true">sec</span>
      </span>
    </Field>
  );
}

// The schedule, as presets rather than cron: a kind, its one or two inputs,
// and which profiles it runs on. The document is draft state like every other
// field -- Save writes it -- and validateSchedule is the same gate the
// scheduler and the MCP handlers use, so what saves is what fires.
const DAY_CHIPS: {day: number; label: string}[] = [
  {day: 1, label: 'Mon'}, {day: 2, label: 'Tue'}, {day: 3, label: 'Wed'},
  {day: 4, label: 'Thu'}, {day: 5, label: 'Fri'}, {day: 6, label: 'Sat'},
  {day: 0, label: 'Sun'},
];

function ScheduleFields({value, profiles, problems, onChange}: {
  value: AutomationSchedule | null;
  profiles: {id: string; name: string}[];
  problems: string[];
  onChange: (schedule: AutomationSchedule | null) => void;
}) {
  function switchKind(kind: '' | ScheduleKind) {
    if (!kind) {
      // Off discards the document rather than keeping a disabled copy: dead
      // config a later edit resurrects by surprise, the notify_connector_id
      // lesson.
      onChange(null);
      return;
    }
    onChange({
      enabled: true,
      kind,
      everyMinutes: kind === 'interval' ? (value?.everyMinutes || 30) : undefined,
      at: kind === 'interval' ? undefined : (value?.at || '09:00'),
      days: kind === 'weekly' ? (value?.days?.length ? value.days : [1]) : undefined,
      profileIds: value?.profileIds || [],
    });
  }

  return (
    <>
      <Field
        label="Run on a schedule"
        hint="Fires while the launcher is open. Times it was closed for are skipped, not caught up."
      >
        <select
          value={value?.enabled ? value.kind : ''}
          onChange={(event) => switchKind(event.target.value as '' | ScheduleKind)}
        >
          <option value="">No schedule</option>
          <option value="interval">Every N minutes</option>
          <option value="daily">Daily at a time</option>
          <option value="weekly">Weekly on days</option>
        </select>
      </Field>
      {value?.enabled && value.kind === 'interval' && (
        <Field label="Every">
          <span className="field-suffixed">
            <input
              max={MAX_INTERVAL_MINUTES}
              min={MIN_INTERVAL_MINUTES}
              type="number"
              value={value.everyMinutes ?? 30}
              onChange={(event) => onChange({
                ...value,
                everyMinutes: Math.round(Number(event.target.value) || 0),
              })}
            />
            <span aria-hidden="true">min</span>
          </span>
        </Field>
      )}
      {value?.enabled && value.kind !== 'interval' && (
        <Field label="At">
          <input
            type="time"
            value={value.at || '09:00'}
            onChange={(event) => onChange({...value, at: event.target.value})}
          />
        </Field>
      )}
      {value?.enabled && value.kind === 'weekly' && (
        <Field label="On" group>
          <div className="choice-chips" role="group" aria-label="Days of week">
            {DAY_CHIPS.map(({day, label}) => {
              const active = (value.days || []).includes(day);
              return (
                <button
                  aria-pressed={active}
                  className={active ? 'choice-chip active' : 'choice-chip'}
                  key={day}
                  type="button"
                  onClick={() => onChange({
                    ...value,
                    days: active ?
                      (value.days || []).filter((d) => d !== day) :
                      [...(value.days || []), day],
                  })}
                >{label}</button>
              );
            })}
          </div>
        </Field>
      )}
      {value?.enabled && (
        <Field
          label="On profiles"
          hint={profiles.length === 0 ? 'No live profiles to schedule onto yet.' : undefined}
          group
        >
          <div className="automation-schedule-profiles">
            {profiles.map((profile) => (
              <label className="checkbox-row" key={profile.id}>
                <input
                  checked={value.profileIds.includes(profile.id)}
                  type="checkbox"
                  onChange={(event) => onChange({
                    ...value,
                    profileIds: event.target.checked ?
                      [...value.profileIds, profile.id] :
                      value.profileIds.filter((id) => id !== profile.id),
                  })}
                />
                <span>{profile.name}</span>
              </label>
            ))}
          </div>
        </Field>
      )}
      {value?.enabled && problems.length > 0 && (
        <ul className="automation-problems">
          {problems.map((problem) => <li key={problem}>{problem}</li>)}
        </ul>
      )}
    </>
  );
}

export function AutomationModal({
  automation, exists, tagOptions = [], checkProfile, connectors = [], profiles = [],
  automations = [], members = [], telegramLinked = false, telegramPref = null,
  onTelegramPref, onLinkTelegram, onClose, onSave, onRun, onDelete,
}: {
  automation: ArgusAutomation;
  exists: boolean;
  // Every tag in use across the workspace, for the suggestion row.
  tagOptions?: TagUsage[];
  // The profile a step's Check button tests its selector against.
  checkProfile?: {id: string; name: string} | null;
  // The workspace's connectors, for a step's connector dropdown. Names
  // only -- the key never comes near the editor.
  connectors?: {id: string; name: string; category: string; is_default?: boolean}[];
  // Live profiles, for the schedule's target list. Names and ids only.
  profiles?: {id: string; name: string}[];
  // The workspace's automations, for callAutomation's picker. The one being
  // edited is filtered out HERE, not by the picker: this file knows the draft's
  // id, and excluding it is what makes a self-call inexpressible in the UI.
  automations?: {id: string; name: string}[];
  // The roster, for the attribution line -- created_by/updated_by are uuids.
  members?: OrgMember[];
  // Personal Telegram: whether MY account is linked, and MY preference for
  // this automation. Written through the callbacks the moment they change --
  // they are per-user rows, not part of the automation document Save writes.
  telegramLinked?: boolean;
  telegramPref?: 'always' | 'failure' | null;
  onTelegramPref?: (value: 'always' | 'failure' | null) => void;
  onLinkTelegram?: () => void;
  onClose: () => void;
  onSave: (next: ArgusAutomation) => Promise<string | null>;
  onRun?: (next: ArgusAutomation) => void;
  // Raises the confirm dialog. It does not delete anything itself, and it is
  // deliberately not given the draft: you delete the saved workflow, not
  // whatever unsaved edits happen to be on screen.
  onDelete?: () => void;
}) {
  const [draft, setDraft] = useState<ArgusAutomation>(automation);
  const [view, setView] = useState<'steps' | 'json'>('steps');
  const [json, setJson] = useState(() => JSON.stringify(automation.steps, null, 2));
  const [jsonError, setJsonError] = useState('');
  const [saveError, setSaveError] = useState('');
  const [saving, setSaving] = useState(false);

  const problems = validate(draft.steps);
  // A schedule that is present but unsound blocks Save the same way a bad
  // step does -- the scheduler refuses invalid documents, so saving one would
  // silently never fire.
  const scheduleProblems = draft.schedule ? validateSchedule(draft.schedule) : [];

  // Only applied when it parses AND validates. Anything else leaves the step
  // list exactly as it was.
  function applyJson(text: string) {
    setJson(text);
    try {
      const parsed = JSON.parse(text);
      const found = validate(parsed);
      if (found.length > 0) {
        setJsonError(found.slice(0, 4).join('\n'));
        return;
      }
      setJsonError('');
      setDraft({...draft, steps: parsed as AutomationStep[]});
    } catch (error) {
      setJsonError(error instanceof Error ? error.message : 'That is not valid JSON.');
    }
  }

  async function save() {
    setSaving(true);
    setSaveError('');
    const error = await onSave(draft);
    setSaving(false);
    if (error) {
      setSaveError(error);
      return;
    }
    onClose();
  }

  return (
    <Modal
      onClose={onClose}
      className="automation-modal"
      title={
        <TitleField
          value={draft.name}
          onChange={(name) => setDraft({...draft, name})}
        />
      }
      subtitle={`${draft.steps.length} step${draft.steps.length === 1 ? '' : 's'}`}
      footer={
        <>
          {saveError && <p className="settings-error">{saveError}</p>}
          {/* .modal-actions gives .danger `margin-right: auto`, so this sits at
              the far left of the row and Cancel/Save stay together at the
              right. Only for an automation that exists: there is nothing to
              delete about a draft, and Cancel already discards one. */}
          {onDelete && exists && (
            <button type="button" className="ghost danger" onClick={onDelete}>
              <Trash2 size={16} /> Delete
            </button>
          )}
          <button type="button" className="ghost" onClick={onClose}>Cancel</button>
          <BusyButton
            busy={saving}
            busyLabel="Saving"
            disabled={problems.length > 0 || scheduleProblems.length > 0 || !draft.name.trim()}
            onClick={() => void save()}
          >Save</BusyButton>
        </>
      }
    >
      <div className="profile-editor-layout">
        <div className="profile-editor-main">
          {/* choice-chip, and `active` not `is-active`. Both were wrong, and
              they cancelled out into something that looked intentional: with
              neither class applied the two buttons fell back to the base rule
              and rendered as identical accent pills, so the view you were in
              was the one you could not see. */}
          <div className="choice-chips" role="radiogroup" aria-label="Editor view">
            <button
              type="button"
              role="radio"
              aria-checked={view === 'steps'}
              className={`choice-chip${view === 'steps' ? ' active' : ''}`}
              onClick={() => setView('steps')}
            >Steps</button>
            <button
              type="button"
              role="radio"
              aria-checked={view === 'json'}
              className={`choice-chip${view === 'json' ? ' active' : ''}`}
              onClick={() => {
                setJson(JSON.stringify(draft.steps, null, 2));
                setJsonError('');
                setView('json');
              }}
            >JSON</button>
          </div>

          {view === 'steps' ? (
            <StepList
              steps={draft.steps}
              checkProfile={checkProfile}
              connectors={connectors}
              automations={automations.filter((entry) => entry.id !== draft.id)}
              onChange={(steps) => setDraft({...draft, steps})}
            />
          ) : (
            <div className="automation-json">
              <textarea
                spellCheck={false}
                value={json}
                onChange={(event) => applyJson(event.target.value)}
                rows={22}
              />
              {jsonError && <pre className="settings-error">{jsonError}</pre>}
              <p className="field-hint">
                This is the same shape an agent writes over MCP. Paste one in, or copy one out.
              </p>
            </div>
          )}

          {problems.length > 0 && view === 'steps' && (
            <ul className="automation-problems">
              {problems.slice(0, 5).map((problem) => <li key={problem}>{problem}</li>)}
            </ul>
          )}
        </div>

        <aside className="profile-editor-side">
          {/* First, and primary. It was a ghost button at the bottom of the
              column, below five settings -- so the one action you came here to
              take was the quietest thing on the panel and the last thing you
              reached. Everything under it is configuration. */}
          {onRun && exists && (
            <button
              type="button"
              className="primary automation-run-now"
              onClick={() => onRun(draft)}
              disabled={problems.length > 0}
              title={problems.length > 0 ?
                'Fix the problems listed under the steps first.' :
                'Pick profiles and run'}
            ><Play size={16} /> Run now</button>
          )}

          {/* Name has moved to the dialog's heading -- this column is settings
              now, not identity. They sit on their own surface so the column
              reads as one group of settings rather than as five loose controls
              stacked against the dialog's background. */}
          <div className="automation-settings-card">
            <Field label="Description">
              <textarea
                rows={2}
                value={draft.description || ''}
                onChange={(event) => setDraft({...draft, description: event.target.value})}
              />
            </Field>
            {/* Identity before wiring: the icon and colour are how this card is
                found in the grid, the same question the profile avatar answers.
                Brands only -- the catalog is what lets an agent set one by
                name over MCP. */}
            <Field label="Icon" group>
              <BrandIconPicker
                value={draft.icon || ''}
                onChange={(icon) => setDraft({...draft, icon: icon || null})}
              />
            </Field>
            <Field label="Card colour" group>
              <ColorPicker
                label="Card colour"
                value={draft.color || ''}
                onChange={(color) => setDraft({...draft, color})}
              />
            </Field>
            <Field
              label="Tags"
              hint={`At most ${MAX_PROFILE_TAGS}. Shared catalogue with profiles.`}
              // group, not a label: TagInput is a row of buttons, and a <label>
              // wrapping them fires its implicit activation on the first one.
              group
            >
              <TagInput
                options={tagOptions}
                placeholder="signup, client-a"
                value={draft.tags || []}
                onChange={(tags) => setDraft({...draft, tags})}
              />
            </Field>
            <div className="automation-field">
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={Boolean(draft.pinned)}
                  onChange={(event) => setDraft({...draft, pinned: event.target.checked})}
                />
                <span>Show on every profile's start page</span>
              </label>
              <p className="field-hint">
                Adds a tile next to the bookmarks, so it can be run from inside the browser.
              </p>
            </div>
            <div className="automation-field">
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={Boolean(draft.close_on_finish)}
                  onChange={(event) => setDraft({...draft, close_on_finish: event.target.checked})}
                />
                <span>Close the browser when it finishes</span>
              </label>
              {/* The hint this checkbox never had, and it states the rule
                  exactly: the runner closes what the run opened and nothing
                  else, so a window you were already working in survives a run
                  against it. */}
              <p className="field-hint">
                Only a browser this run opened. A window you already had open is left alone.
              </p>
            </div>
            <Field
              label="When it finishes"
              hint={draft.notify_on === 'failure' ?
                'Includes runs where a failed step was set to continue. ' +
                  'Cancelling a run never notifies.' :
                draft.notify_on === 'always' ?
                  'Cancelling a run never notifies — you just did it yourself.' :
                  undefined}
            >
              <select
                value={draft.notify_on || ''}
                onChange={(event) => {
                  const notify_on = (event.target.value || null) as
                    'always' | 'failure' | null;
                  // Turning it off clears the target too: a connector id
                  // behind a null notify_on is dead state a later edit would
                  // resurrect by surprise.
                  setDraft(notify_on ?
                    {...draft, notify_on} :
                    {...draft, notify_on: null, notify_connector_id: null});
                }}
              >
                <option value="">Don&apos;t notify</option>
                {/* "always" spelled as what it covers. It used to say "when it
                    finishes", which read as success-only next to the failure
                    option -- the exact opposite of what it means. */}
                <option value="always">Every run — success and failure</option>
                <option value="failure">Failures only</option>
              </select>
            </Field>
            {draft.notify_on && (
              <Field
                label="Send to"
                hint="Argus always rings the bell and raises a desktop notification;
                  a connector additionally sends the outcome out of Argus."
              >
                <select
                  value={draft.notify_connector_id || ''}
                  onChange={(event) => setDraft({
                    ...draft,
                    notify_connector_id: event.target.value || null,
                  })}
                >
                  <option value="">Argus (bell + desktop)</option>
                  {connectors
                      .filter((connector) => connector.category === 'message')
                      .map((connector) => (
                        <option key={connector.id} value={connector.id}>
                          {connector.name}
                        </option>
                      ))}
                  {/* A connector that has been deleted. Listed so the setting
                      keeps showing what it names instead of silently snapping
                      to Argus-only -- the run will say the connector is gone. */}
                  {Boolean(draft.notify_connector_id) &&
                    !connectors.some((c) => c.id === draft.notify_connector_id) && (
                    <option value={String(draft.notify_connector_id)}>Missing connector</option>
                  )}
                </select>
              </Field>
            )}
            {/* Personal, not part of the document: the select writes MY pref
                row the moment it changes, so there is nothing here for Save to
                save. Only for a saved automation -- the pref row references
                the automation and cannot exist before it does. */}
            {exists && onTelegramPref && (
              <Field
                label="Personal Telegram"
                hint={telegramLinked ?
                  'Messages you, and only you, through the Argus bot. ' +
                    'Teammates set their own.' :
                  'One-time setup: open the Argus bot and press Start.'}
              >
                {telegramLinked ? (
                  <select
                    value={telegramPref || ''}
                    onChange={(event) => onTelegramPref(
                        (event.target.value || null) as 'always' | 'failure' | null)}
                  >
                    <option value="">Don&apos;t message me</option>
                    <option value="always">Message me every run — success and failure</option>
                    <option value="failure">Message me on failures only</option>
                  </select>
                ) : (
                  <button className="ghost" onClick={onLinkTelegram} type="button">
                    <Send size={14} /> Link Telegram
                  </button>
                )}
              </Field>
            )}
            <ScheduleFields
              profiles={profiles}
              problems={scheduleProblems}
              value={draft.schedule ?? null}
              onChange={(schedule) => setDraft({...draft, schedule})}
            />
            <TimeoutField
              value={draft.timeout_ms ?? DEFAULT_TIMEOUT_MS}
              onChange={(timeout_ms) => setDraft({...draft, timeout_ms})}
            />
          </div>

          {/* Who made this and who last touched it. The uuids are resolved
              against the roster; an agent's work names the agent, because
              created_by on an MCP write is just whoever had the launcher
              open. */}
          {exists && (automation.created_by || automation.created_via === 'mcp') && (
            <p className="automation-attribution">
              Created by {automation.created_via === 'mcp' ?
                `${automation.created_by_label || 'an agent'} (MCP)` :
                assigneeName(automation.created_by, members) || 'someone'}
              {automation.created_at ? ` · ${automation.created_at.slice(0, 10)}` : ''}
              {automation.updated_by && automation.updated_at &&
                automation.updated_at.slice(0, 10) !== automation.created_at?.slice(0, 10) ?
                ` — edited by ${assigneeName(automation.updated_by, members) || 'someone'}` +
                  ` · ${automation.updated_at.slice(0, 10)}` :
                ''}
            </p>
          )}
        </aside>
      </div>
    </Modal>
  );
}
