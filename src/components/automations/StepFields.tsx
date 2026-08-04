// One step's inputs, rendered entirely from step-schema.json.
//
// Nothing here knows what a `goto` or an `extract` is. That is the payoff of
// keeping the catalogue in JSON: adding a step type means an entry in the JSON,
// a member of the StepType union and an executor -- and no change to this file
// or to any other component.
import {Field} from '../ui/Field';
import {fieldVisible, specFor} from '../../automations/schema';
import type {FieldSpec} from '../../automations/schema';
import type {AutomationStep, Condition} from '../../automations/types';
import type {ReactNode} from 'react';

type Values = Record<string, unknown>;

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

function control(
    field: FieldSpec,
    value: unknown,
    set: (next: unknown) => void,
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

export function StepFields({step, onChange, renderSteps}: {
  step: AutomationStep;
  onChange: (next: AutomationStep) => void;
  // Nested lists (if/loop) are rendered by the parent, which owns the
  // recursion and the depth cap.
  renderSteps: (key: string, label: string) => ReactNode;
}) {
  const spec = specFor(step.type);
  const values = step as unknown as Values;

  return (
    <div className="automation-step-fields">
      {spec.fields.map((field) => {
        if (!fieldVisible(field, values)) {
          return null;
        }
        if (field.kind === 'steps') {
          return <div key={field.key}>{renderSteps(field.key, field.label)}</div>;
        }
        const set = (next: unknown) => onChange({...step, [field.key]: next} as AutomationStep);
        // A checkbox already carries its own label, so wrapping it in a Field
        // would print the label twice.
        if (field.kind === 'boolean') {
          return (
            <div className="automation-field" key={field.key}>
              {control(field, values[field.key], set)}
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
            {control(field, values[field.key], set)}
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
