// The automation editor: an ordered step list, or the raw JSON behind it.
//
// The JSON view is not a debug affordance. It is the same shape an agent writes
// over MCP, so it is how a user checks what an agent built, and how they paste
// one in. It round-trips losslessly, and a parse or validation failure renders
// inline WITHOUT clobbering the step list -- you keep editing the text until it
// is right, rather than losing it the moment you mistype a brace.
import {useState} from 'react';
import {Modal} from '../ui/Modal';
import {Field} from '../ui/Field';
import {BusyButton} from '../ui/BusyButton';
import {StepList} from '../automations/StepList';
import {STEP_SCHEMA} from '../../automations/schema';
import type {ArgusAutomation} from '../../types';
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

export function AutomationModal({automation, exists, onClose, onSave, onRun}: {
  automation: ArgusAutomation;
  exists: boolean;
  onClose: () => void;
  onSave: (next: ArgusAutomation) => Promise<string | null>;
  onRun?: (next: ArgusAutomation) => void;
}) {
  const [draft, setDraft] = useState<ArgusAutomation>(automation);
  const [view, setView] = useState<'steps' | 'json'>('steps');
  const [json, setJson] = useState(() => JSON.stringify(automation.steps, null, 2));
  const [jsonError, setJsonError] = useState('');
  const [saveError, setSaveError] = useState('');
  const [saving, setSaving] = useState(false);

  const problems = validate(draft.steps);

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
      title={exists ? draft.name || 'Automation' : 'New automation'}
      subtitle={`${draft.steps.length} step${draft.steps.length === 1 ? '' : 's'}`}
      footer={
        <>
          {saveError && <p className="settings-error">{saveError}</p>}
          <button type="button" className="ghost" onClick={onClose}>Cancel</button>
          <BusyButton
            busy={saving}
            busyLabel="Saving"
            disabled={problems.length > 0 || !draft.name.trim()}
            onClick={() => void save()}
          >Save</BusyButton>
        </>
      }
    >
      <div className="profile-editor-layout">
        <div className="profile-editor-main">
          <div className="choice-chips" role="radiogroup" aria-label="Editor view">
            <button
              type="button"
              role="radio"
              aria-checked={view === 'steps'}
              className={view === 'steps' ? 'is-active' : ''}
              onClick={() => setView('steps')}
            >Steps</button>
            <button
              type="button"
              role="radio"
              aria-checked={view === 'json'}
              className={view === 'json' ? 'is-active' : ''}
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
          <Field label="Name">
            <input
              value={draft.name}
              onChange={(event) => setDraft({...draft, name: event.target.value})}
            />
          </Field>
          <Field label="Description">
            <textarea
              rows={2}
              value={draft.description || ''}
              onChange={(event) => setDraft({...draft, description: event.target.value})}
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
          </div>
          <Field label="Run timeout (ms)" hint="The whole run. Capped at 10 minutes.">
            <input
              type="number"
              min={1000}
              max={600000}
              value={draft.timeout_ms ?? 300000}
              onChange={(event) => setDraft({...draft, timeout_ms: Number(event.target.value)})}
            />
          </Field>
          {onRun && exists && (
            <button
              type="button"
              className="ghost"
              onClick={() => onRun(draft)}
              disabled={problems.length > 0}
            >Run now</button>
          )}
        </aside>
      </div>
    </Modal>
  );
}
