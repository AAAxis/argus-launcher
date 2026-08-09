// Declaring what an automation asks for, in the editor's right-hand column.
//
// This card is the difference between one workflow and twelve copies of it: a
// `city_name` parameter is what lets the same flat search run Dortmund on one
// profile and Essen on the next, instead of the city being a literal buried in
// a goto step.
//
// It sits ABOVE the settings card, not inside it. Parameters belong with the
// steps -- they are what the steps read -- while the card below is notification
// wiring, schedules and the timeout. Putting them together would bury the one
// thing you came here to change under five things you set once.
import {useState} from 'react';
import {ChevronDown, ChevronRight, Plus, Trash2} from 'lucide-react';
import {Field} from '../ui/Field';
import {
  MAX_PARAMETERS, PARAM_KINDS, paramLabel, paramSummary, validateParams,
} from '../../automations/parameters';
import type {AutomationParam, ParamKind} from '../../automations/parameters';

// What each kind is for, in the picker. The names alone are not enough: "list"
// and "long text" are the same box until you know one becomes an array.
const KIND_LABELS: Record<ParamKind, string> = {
  text: 'Text',
  textarea: 'Long text',
  number: 'Number',
  boolean: 'Yes / no',
  select: 'Dropdown',
  secret: 'Secret (hidden)',
  list: 'List of lines',
};

const KIND_HINTS: Partial<Record<ParamKind, string>> = {
  select: 'One choice per line, below.',
  secret: 'Hidden in every form, and masked in run history. Still stored as text.',
  list: 'One value per line. Becomes a real list, so a Loop step can run over it.',
  boolean: 'Always answered, so it is never required.',
};

// A name that is safe to address as {{vars.<name>}}. Applied as you type rather
// than on save: a space silently becoming an unreadable variable is worse than
// a character that will not go in.
function cleanName(raw: string): string {
  return raw.replace(/[^A-Za-z0-9_]/g, '_').replace(/^([0-9])/, '_$1');
}

function ParameterRow({param, expanded, onToggle, onChange, onRemove}: {
  param: AutomationParam;
  expanded: boolean;
  onToggle: () => void;
  onChange: (next: AutomationParam) => void;
  onRemove: () => void;
}) {
  const set = (patch: Partial<AutomationParam>) => onChange({...param, ...patch});
  return (
    <div className={`automation-param${expanded ? ' is-open' : ''}`}>
      <div className="automation-param-row">
        <button
          type="button"
          className="automation-param-toggle"
          aria-expanded={expanded}
          onClick={onToggle}
        >
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          <span className="automation-param-name">{paramSummary(param)}</span>
        </button>
        <button
          type="button"
          className="icon-button"
          aria-label={`Remove ${paramLabel(param)}`}
          title="Remove"
          onClick={onRemove}
        ><Trash2 size={14} /></button>
      </div>

      {expanded && (
        <div className="automation-param-body">
          <Field
            label="Name"
            hint={`Steps read it as {{vars.${param.name || 'name'}}}`}
          >
            <input
              value={param.name}
              placeholder="city_name"
              onChange={(event) => set({name: cleanName(event.target.value)})}
            />
          </Field>
          <Field label="Label" hint="What the form shows. Empty uses the name.">
            <input
              value={param.label || ''}
              placeholder={param.name}
              onChange={(event) => set({label: event.target.value})}
            />
          </Field>
          <Field label="Kind" hint={KIND_HINTS[param.kind]}>
            <select
              value={param.kind}
              onChange={(event) => {
                const kind = event.target.value as ParamKind;
                set({
                  kind,
                  // A yes/no is always answered, so `required` on one can never
                  // fail -- validateParams refuses the combination outright, and
                  // silently leaving it set would block Save with a problem the
                  // user cannot see a control for.
                  ...(kind === 'boolean' ? {required: false} : {}),
                  // Choices belong to a dropdown. Kept when switching between
                  // other kinds would leave a hidden list that reappears later.
                  ...(kind === 'select' ? {} : {options: undefined}),
                });
              }}
            >
              {PARAM_KINDS.map((kind) => (
                <option key={kind} value={kind}>{KIND_LABELS[kind]}</option>
              ))}
            </select>
          </Field>
          {param.kind === 'select' && (
            <Field label="Choices" hint="One per line.">
              <textarea
                rows={3}
                value={(param.options || []).join('\n')}
                placeholder={'Dortmund\nEssen\nBochum'}
                onChange={(event) => set({
                  options: event.target.value.split('\n').map((line) => line.trim())
                      .filter(Boolean),
                })}
              />
            </Field>
          )}
          <Field
            label="Default"
            hint="Used when a profile has no value of its own. Leave empty for none."
          >
            {param.kind === 'boolean' ? (
              <select
                value={param.default === true ? 'true' : 'false'}
                onChange={(event) => set({default: event.target.value === 'true'})}
              >
                <option value="false">No</option>
                <option value="true">Yes</option>
              </select>
            ) : (
              <input
                value={param.default === undefined || param.default === null ?
                  '' : String(param.default)}
                placeholder="Dortmund"
                onChange={(event) => set({
                  default: event.target.value === '' ? undefined : event.target.value,
                })}
              />
            )}
          </Field>
          <Field label="Hint" hint="Shown under the box, wherever it is answered.">
            <input
              value={param.hint || ''}
              placeholder="Which city to search"
              onChange={(event) => set({hint: event.target.value})}
            />
          </Field>
          {param.kind !== 'boolean' && (
            <div className="automation-field">
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={Boolean(param.required)}
                  onChange={(event) => set({required: event.target.checked})}
                />
                <span>Required</span>
              </label>
              <p className="field-hint">
                A profile with no value for it — and no default above — cannot run
                this automation.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function ParametersCard({parameters, onChange}: {
  parameters: AutomationParam[];
  onChange: (next: AutomationParam[]) => void;
}) {
  // Which rows are open, by position. Positions rather than names because the
  // name is the thing being edited -- keying expansion on it would collapse the
  // row on the first keystroke of a rename.
  const [open, setOpen] = useState<Set<number>>(new Set());
  const problems = validateParams(parameters);

  function toggle(index: number) {
    setOpen((current) => {
      const next = new Set(current);
      if (!next.delete(index)) {
        next.add(index);
      }
      return next;
    });
  }

  // Removing a row shifts everything below it up, so the open positions have to
  // shift with it -- otherwise deleting the first of three collapses the second
  // and expands the third.
  function remove(index: number) {
    onChange(parameters.filter((_entry, i) => i !== index));
    setOpen((current) => new Set([...current]
        .filter((i) => i !== index)
        .map((i) => (i > index ? i - 1 : i))));
  }

  function add() {
    // Named on arrival rather than left blank. An unnamed parameter is invalid
    // the moment it exists, so Save would go grey with no explanation of what
    // the user is supposed to do about a row they just created.
    const taken = new Set(parameters.map((param) => param.name));
    let name = 'value';
    for (let i = 2; taken.has(name); i++) {
      name = `value${i}`;
    }
    onChange([...parameters, {name, kind: 'text'}]);
    setOpen((current) => new Set(current).add(parameters.length));
  }

  return (
    <div className="automation-settings-card automation-parameters">
      <div className="automation-parameters-head">
        <h3>Parameters</h3>
        <p className="field-hint">
          What this automation asks for. Steps read them as{' '}
          <code>{'{{vars.name}}'}</code>, and every profile can hold its own answers.
        </p>
      </div>

      {parameters.map((param, index) => (
        <ParameterRow
          // Indexed, not keyed on the name: the name is what the user is
          // editing, and a key that changes on every keystroke remounts the
          // input and loses focus after one character.
          key={index}
          param={param}
          expanded={open.has(index)}
          onToggle={() => toggle(index)}
          onChange={(nextParam) => onChange(
              parameters.map((entry, i) => (i === index ? nextParam : entry)))}
          onRemove={() => remove(index)}
        />
      ))}

      {problems.length > 0 && (
        <ul className="automation-problems">
          {problems.slice(0, 3).map((problem) => <li key={problem}>{problem}</li>)}
        </ul>
      )}

      <button
        type="button"
        className="ghost small automation-param-add"
        disabled={parameters.length >= MAX_PARAMETERS}
        title={parameters.length >= MAX_PARAMETERS ?
          `${MAX_PARAMETERS} is the limit.` : 'Add a parameter'}
        onClick={add}
      ><Plus size={14} /> Add a parameter</button>
    </div>
  );
}
