// One step's inputs, rendered entirely from step-schema.json.
//
// Nothing here knows what a `goto` or an `extract` is. That is the payoff of
// keeping the catalogue in JSON: adding a step type means an entry in the JSON,
// a member of the StepType union and an executor -- and no change to this file
// or to any other component.
import {useState} from 'react';
import {Check} from 'lucide-react';
import {BusyButton} from '../ui/BusyButton';
import {Field} from '../ui/Field';
import {native} from '../../native';
import {fieldVisible, specFor} from '../../automations/schema';
import type {FieldSpec} from '../../automations/schema';
import type {AutomationStep, Condition} from '../../automations/types';
import type {ReactNode} from 'react';

type Values = Record<string, unknown>;

// What a selector matched, as a sentence and a tone. Kept together because the
// count alone is not the answer: one match is good, seven is a step that will
// act on whichever the browser happens to return first.
type CheckResult = {tone: 'ok' | 'warn' | 'bad' | 'idle'; message: string};

// Counts what a selector matches on the open profile's current page.
//
// Read-only: the main process evaluates querySelectorAll(...).length and
// nothing else, so checking a `click` step cannot click anything.
function SelectorCheck({selector, profileId, profileName}: {
  selector: string;
  // Null when no profile is open or selected -- the button says so rather than
  // being hidden, because "there is nothing to check against" is the answer
  // most often needed and a missing button explains nothing.
  profileId: string | null;
  profileName: string | null;
}) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<CheckResult | null>(null);

  async function run() {
    if (!profileId || !native?.checkSelector) {
      setResult({tone: 'idle', message: 'Select a profile on the Profiles tab first.'});
      return;
    }
    // A template resolves from run-time variables that do not exist yet, so
    // testing it literally would report "no match" for a selector that is
    // going to be correct. Say which, rather than being wrong confidently.
    if (selector.includes('{{')) {
      setResult({
        tone: 'idle',
        message: 'This selector fills in from a variable, so it can only be checked during a run.',
      });
      return;
    }
    setBusy(true);
    const answer = await native.checkSelector(profileId, selector);
    setBusy(false);
    if (!answer.ok) {
      setResult({
        tone: answer.notRunning ? 'idle' : 'bad',
        message: answer.notRunning ?
          `Launch ${profileName || 'the profile'} to check against its page.` :
          answer.error || 'The check did not run.',
      });
      return;
    }
    const count = answer.count ?? 0;
    if (count === 0) {
      setResult({tone: 'bad', message: `Nothing on ${profileName}'s page matches this.`});
      return;
    }
    if (count === 1) {
      setResult({tone: 'ok', message: `1 match on ${profileName}'s page.`});
      return;
    }
    setResult({
      tone: 'warn',
      message: `${count} matches. This step acts on the first unless you set a match index.`,
    });
  }

  return (
    <div className="automation-check">
      <BusyButton
        busy={busy}
        busyLabel="Checking"
        icon={<Check size={14} />}
        className="ghost small automation-check-run"
        disabled={!selector.trim()}
        onClick={() => void run()}
        title={profileId ?
          `Count what this matches on ${profileName}'s open page` :
          'Select a profile on the Profiles tab first'}
      >Check</BusyButton>
      {result && (
        <span className={`automation-check-result is-${result.tone}`}>{result.message}</span>
      )}
    </div>
  );
}

// A string->string map, edited as rows. Used by evaluate.args and
// httpRequest.headers.
function KeyValueRows({value, onChange}: {
  value: Record<string, string>;
  onChange: (next: Record<string, string>) => void;
}) {
  const rows = Object.entries(value || {});
  return (
    <div className="automation-kv">
      {rows.map(([key, entry], index) => (
        <div className="automation-kv-row" key={index}>
          <input
            value={key}
            placeholder="name"
            onChange={(event) => {
              const next: Record<string, string> = {};
              rows.forEach(([k, v], i) => {
                next[i === index ? event.target.value : k] = v;
              });
              onChange(next);
            }}
          />
          <input
            value={entry}
            placeholder="value"
            onChange={(event) => onChange({...value, [key]: event.target.value})}
          />
          <button
            type="button"
            className="icon-button"
            aria-label={`Remove ${key || 'row'}`}
            onClick={() => {
              const next = {...value};
              delete next[key];
              onChange(next);
            }}
          >×</button>
        </div>
      ))}
      <button
        type="button"
        className="ghost small"
        onClick={() => onChange({...value, '': ''})}
      >Add</button>
    </div>
  );
}

// The four-comparator condition. Deliberately not an expression editor -- see
// the note on Condition in automations/types.ts.
function ConditionFields({value, onChange}: {
  value: Condition;
  onChange: (next: Condition) => void;
}) {
  const condition = value || {left: '', op: 'equals'};
  const needsRight = !['exists', 'selectorExists'].includes(condition.op);
  return (
    <div className="automation-condition">
      <input
        value={condition.left || ''}
        placeholder="{{vars.status}}"
        onChange={(event) => onChange({...condition, left: event.target.value})}
      />
      <select
        value={condition.op}
        onChange={(event) => onChange({...condition, op: event.target.value as Condition['op']})}
      >
        <option value="equals">equals</option>
        <option value="notEquals">does not equal</option>
        <option value="contains">contains</option>
        <option value="exists">is set</option>
        <option value="selectorExists">matches an element</option>
      </select>
      {needsRight && (
        <input
          value={condition.right || ''}
          placeholder="value"
          onChange={(event) => onChange({...condition, right: event.target.value})}
        />
      )}
    </div>
  );
}

// One-click {{vars.x}} insertion, under any field substitution actually
// touches.
//
// Insertion goes at the CURSOR, not at the end: a url is usually
// "https://immo.de/<here>/rent", and appending would make the chip useful only
// for fields that are still empty. The target is found by walking up from the
// button, so this works for both the <input> and <textarea> cases without
// either control having to hold a ref.
function InsertVarChips({names, onInsert}: {
  names: string[];
  onInsert: (snippet: string, target: HTMLInputElement | HTMLTextAreaElement | null) => void;
}) {
  if (names.length === 0) {
    return null;
  }
  return (
    <div className="automation-insert-vars">
      <span className="automation-insert-vars-label">insert</span>
      {names.map((name) => (
        <button
          key={name}
          type="button"
          className="automation-insert-var"
          title={`Insert {{vars.${name}}}`}
          onClick={(event) => {
            const scope = event.currentTarget.closest('.field, .automation-field');
            onInsert(`{{vars.${name}}}`,
                scope?.querySelector('input, textarea') as
                  HTMLInputElement | HTMLTextAreaElement | null);
          }}
        >{name}</button>
      ))}
    </div>
  );
}

// Splices `snippet` in at the caret, or appends when the field was never
// focused (selectionStart is null on a control the user has not touched).
function spliceAtCaret(
    current: string,
    snippet: string,
    target: HTMLInputElement | HTMLTextAreaElement | null,
): string {
  const at = target?.selectionStart;
  if (at === undefined || at === null) {
    return current + snippet;
  }
  const end = target?.selectionEnd ?? at;
  return current.slice(0, at) + snippet + current.slice(end);
}

function control(
    field: FieldSpec,
    value: unknown,
    set: (next: unknown) => void,
    // The workspace's connectors and automations, for the two field kinds
    // whose options are data rather than a list in step-schema.json. Names and
    // ids only -- no config ever reaches the editor.
    connectors: {id: string; name: string; category: string; is_default?: boolean}[],
    automations: {id: string; name: string}[],
): ReactNode {
  switch (field.kind) {
    case 'textarea':
      return (
        <textarea
          rows={field.key === 'script' ? 6 : 3}
          value={String(value ?? '')}
          placeholder={field.placeholder}
          onChange={(event) => set(event.target.value)}
        />
      );
    case 'number':
      return (
        <input
          type="number"
          min={field.min}
          max={field.max}
          value={value === undefined || value === null ? '' : String(value)}
          onChange={(event) =>
            set(event.target.value === '' ? undefined : Number(event.target.value))}
        />
      );
    case 'select':
      return (
        <select value={String(value ?? field.default ?? '')} onChange={(e) => set(e.target.value)}>
          {(field.options || []).map((option) => (
            <option key={option} value={option}>{option}</option>
          ))}
        </select>
      );
    case 'boolean':
      return (
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={value === undefined ? Boolean(field.default) : Boolean(value)}
            onChange={(event) => set(event.target.checked)}
          />
          <span>{field.label}</span>
        </label>
      );
    case 'keyvalue':
      return (
        <KeyValueRows
          value={(value as Record<string, string>) || {}}
          onChange={set}
        />
      );
    case 'condition':
      return <ConditionFields value={value as Condition} onChange={set} />;
    case 'connector': {
      // The dropdown offers only the field's category: an AI step lists the
      // workspace's models, a notify step its messaging targets. The default
      // named in the first option is that category's default too.
      const options = connectors.filter(
          (entry) => !field.category || entry.category === field.category);
      return (
        <select value={String(value ?? '')} onChange={(event) => set(event.target.value)}>
          {/* Empty means "whichever the workspace has marked default", which is
              resolved at run time and not here -- so an automation stays
              correct after the default changes, and an agent authoring one over
              MCP can leave the field out entirely. */}
          <option value="">
            Workspace default{options.some((entry) => entry.is_default) ?
              ` (${options.find((entry) => entry.is_default)?.name})` :
              ' — none set yet'}
          </option>
          {options.map((connector) => (
            <option key={connector.id} value={connector.id}>{connector.name}</option>
          ))}
          {/* A connector that has been deleted, or one from another workspace.
              Listed so the step keeps showing what it actually names instead of
              silently snapping back to the default. */}
          {Boolean(value) && !options.some((connector) => connector.id === value) && (
            <option value={String(value)}>Missing connector</option>
          )}
        </select>
      );
    }
    case 'automation':
      // The other automations in the workspace -- the one being edited is
      // already excluded upstream, so the picker cannot express a self-call.
      // Unlike 'connector' there is no workspace default: calling nothing is
      // not a sensible run, so an empty pick stays a validation problem.
      return (
        <select value={String(value ?? '')} onChange={(event) => set(event.target.value)}>
          <option value="">Choose an automation…</option>
          {automations.map((automation) => (
            <option key={automation.id} value={automation.id}>{automation.name}</option>
          ))}
          {/* A callee that was deleted, or arrived by pasted JSON. Named as
              missing rather than snapped to empty, so the step keeps showing
              what it points at -- the run will refuse it with a sentence. */}
          {Boolean(value) && !automations.some((automation) => automation.id === value) && (
            <option value={String(value)}>Missing automation</option>
          )}
        </select>
      );
    default:
      return (
        <input
          value={String(value ?? '')}
          placeholder={field.placeholder}
          onChange={(event) => set(event.target.value)}
        />
      );
  }
}

export function StepFields({
  step, onChange, checkProfile, connectors = [], automations = [], varNames = [],
}: {
  step: AutomationStep;
  onChange: (next: AutomationStep) => void;
  // The automation's declared parameters, for the insert chips. Threaded from
  // the editor the same way connectors and automations are -- StepList is the
  // recursion, so a step inside a loop body offers the same chips as one at the
  // top level.
  varNames?: string[];
  // Threaded from the editor rather than read from context, exactly as
  // checkProfile is: StepList is also the recursion, and a branch's steps
  // choose from the same list.
  connectors?: {id: string; name: string; category: string; is_default?: boolean}[];
  // The workspace's other automations, for callAutomation's picker.
  automations?: {id: string; name: string}[];
  // The profile a Check tests against. See automations/target.ts -- the same
  // rule the Run button uses, so the page you check is the page you run on.
  checkProfile?: {id: string; name: string} | null;
}) {
  const spec = specFor(step.type);
  const values = step as unknown as Values;

  return (
    <div className="automation-step-fields">
      {spec.fields.map((field) => {
        if (!fieldVisible(field, values)) {
          return null;
        }
        // Nested lists are not fields. StepList renders them below the card,
        // outside this panel, so an `if` shows its Yes and No branches and a
        // `loop` shows its body whether or not the step is expanded. They used
        // to live in here, which meant a collapsed branch step displayed
        // nothing about its own shape -- the single most common complaint
        // about this editor.
        if (field.kind === 'steps') {
          return null;
        }
        const set = (next: unknown) => onChange({...step, [field.key]: next} as AutomationStep);
        // A checkbox already carries its own label, so wrapping it in a Field
        // would print the label twice.
        if (field.kind === 'boolean') {
          return (
            <div className="automation-field" key={field.key}>
              {control(field, values[field.key], set, connectors, automations)}
              {field.hint && <p className="field-hint">{field.hint}</p>}
            </div>
          );
        }
        return (
          <Field
            key={field.key}
            label={field.required ? `${field.label} *` : field.label}
            hint={field.hint}
          >
            {control(field, values[field.key], set, connectors, automations)}
            {/* Keyed on the selector's current value, so editing the input
                clears a stale verdict rather than leaving "1 match" sitting
                under a selector that has since been changed. */}
            {field.check === 'selector' && (
              <SelectorCheck
                key={String(values[field.key] ?? '')}
                selector={String(values[field.key] ?? '')}
                profileId={checkProfile?.id || null}
                profileName={checkProfile?.name || null}
              />
            )}
            {/* Only where substitution happens. Offering a chip on
                evaluate.script would be worse than offering none: that field
                is never interpolated, so the inserted template would sit in
                the source as literal text. */}
            {field.interpolate && (
              <InsertVarChips
                names={varNames}
                onInsert={(snippet, target) =>
                  set(spliceAtCaret(String(values[field.key] ?? ''), snippet, target))}
              />
            )}
          </Field>
        );
      })}

      {spec.note && <p className="automation-step-note">{spec.note}</p>}

      <details className="automation-step-advanced">
        <summary>On failure</summary>
        <div className="automation-step-advanced-body">
          <Field label="If this step fails">
            <select
              value={step.onError || 'stop'}
              onChange={(event) => onChange({
                ...step,
                onError: event.target.value as AutomationStep['onError'],
              })}
            >
              <option value="stop">Stop the run</option>
              <option value="continue">Carry on (the run ends "partial")</option>
              <option value="retry">Retry, then stop</option>
            </select>
          </Field>
          {step.onError === 'retry' && (
            <Field label="Retries" hint="At most 5.">
              <input
                type="number"
                min={1}
                max={5}
                value={step.retries ?? 1}
                onChange={(event) => onChange({...step, retries: Number(event.target.value)})}
              />
            </Field>
          )}
          <Field label="Timeout (ms)" hint="Leave empty for the default: 15s, or 30s for waits.">
            <input
              type="number"
              min={100}
              value={step.timeoutMs ?? ''}
              onChange={(event) => onChange({
                ...step,
                timeoutMs: event.target.value === '' ? undefined : Number(event.target.value),
              })}
            />
          </Field>
        </div>
      </details>
    </div>
  );
}
