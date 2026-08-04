// The ordered step list, and the nesting for if/loop.
//
// Recursive: `if` renders two child lists and `loop` renders one, at one indent
// each. Depth is capped at MAX_STEP_DEPTH -- past three levels a linear editor
// stops being more readable than a graph, which is the entire reason it is
// linear.
//
// Drag-and-drop is native HTML5, no library, and reordering is confined to one
// list: dragging a step out of a loop body and into the top level would have to
// answer what happens to {{loop.item}} references inside it, and the honest
// answer needs a rename pass nobody asked for. Cut and re-add instead.
import {useState} from 'react';
import {ChevronDown, ChevronRight, Copy, GripVertical, Plus, Trash2} from 'lucide-react';
import {StepFields} from './StepFields';
import {STEP_TYPES, specFor} from '../../automations/schema';
import {MAX_STEP_DEPTH} from '../../automations/types';
import {newRowId} from '../../lib/random';
import type {AutomationStep, StepType} from '../../automations/types';

// Renders the schema's summary template against a step: "Go to {url}" becomes
// "Go to example.com". Shared shape with the runner's own summarize(), which
// writes the same line into the run log -- so a row and its log entry read
// alike.
function summarize(step: AutomationStep): string {
  if (step.label) {
    return step.label;
  }
  const spec = specFor(step.type);
  const rendered = spec.summary.replace(/\{([A-Za-z0-9_.]+)\}/g, (_match, key: string) => {
    const value = key.split('.').reduce<unknown>(
        (acc, part) => (acc && typeof acc === 'object' ?
          (acc as Record<string, unknown>)[part] :
          undefined),
        step as unknown);
    return value === undefined || value === null ? '' : String(value);
  }).trim();
  return rendered || spec.label;
}

function blankStep(type: StepType): AutomationStep {
  const step = {id: newRowId(), type} as Record<string, unknown>;
  for (const field of specFor(type).fields) {
    if (field.default !== undefined) {
      step[field.key] = field.default;
    }
  }
  if (type === 'if') {
    step.condition = {left: '', op: 'equals', right: ''};
    step.then = [];
    step.else = [];
  }
  if (type === 'loop') {
    step.body = [];
  }
  return step as unknown as AutomationStep;
}

function AddStep({onAdd}: {onAdd: (step: AutomationStep) => void}) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <button type="button" className="ghost small automation-add" onClick={() => setOpen(true)}>
        <Plus size={14} /> Add step
      </button>
    );
  }
  return (
    <div className="automation-add-menu">
      {STEP_TYPES.map((type) => (
        <button
          key={type}
          type="button"
          onClick={() => {
            onAdd(blankStep(type));
            setOpen(false);
          }}
        >{specFor(type).label}</button>
      ))}
      <button type="button" className="automation-add-cancel" onClick={() => setOpen(false)}>
        Cancel
      </button>
    </div>
  );
}

export function StepList({steps, onChange, depth = 0}: {
  steps: AutomationStep[];
  onChange: (next: AutomationStep[]) => void;
  depth?: number;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [dragging, setDragging] = useState<number | null>(null);

  function replace(index: number, step: AutomationStep) {
    onChange(steps.map((item, i) => (i === index ? step : item)));
  }

  function move(from: number, to: number) {
    if (from === to || to < 0 || to >= steps.length) {
      return;
    }
    const next = [...steps];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    onChange(next);
  }

  return (
    <div className={depth > 0 ? 'automation-steps nested' : 'automation-steps'}>
      {steps.length === 0 && (
        <p className="automation-steps-empty">No steps yet.</p>
      )}
      {steps.map((step, index) => {
        const isOpen = expanded === step.id;
        const spec = specFor(step.type);
        return (
          <div
            className={`automation-step${step.enabled === false ? ' is-off' : ''}`}
            key={step.id}
            draggable
            onDragStart={() => setDragging(index)}
            onDragOver={(event) => event.preventDefault()}
            onDrop={() => {
              if (dragging !== null) {
                move(dragging, index);
              }
              setDragging(null);
            }}
          >
            <div className="automation-step-row">
              <span className="automation-step-handle" aria-hidden="true">
                <GripVertical size={14} />
              </span>
              <button
                type="button"
                className="automation-step-toggle"
                onClick={() => setExpanded(isOpen ? null : step.id)}
                aria-expanded={isOpen}
              >
                {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              </button>
              <span className="automation-step-index">{index + 1}</span>
              <span className="automation-step-kind">{spec.label}</span>
              <span className="automation-step-summary">{summarize(step)}</span>
              <label
                className="automation-step-enabled"
                title={step.enabled === false ? 'Disabled' : 'Enabled'}
              >
                <input
                  type="checkbox"
                  checked={step.enabled !== false}
                  onChange={(event) => replace(index, {...step, enabled: event.target.checked})}
                />
              </label>
              <button
                type="button"
                className="icon-button"
                aria-label="Duplicate step"
                onClick={() => {
                  const copy = {...step, id: newRowId()} as AutomationStep;
                  onChange([...steps.slice(0, index + 1), copy, ...steps.slice(index + 1)]);
                }}
              ><Copy size={14} /></button>
              <button
                type="button"
                className="icon-button row-action-danger"
                aria-label="Delete step"
                onClick={() => onChange(steps.filter((_item, i) => i !== index))}
              ><Trash2 size={14} /></button>
            </div>

            {isOpen && (
              <div className="automation-step-body">
                <StepFields
                  step={step}
                  onChange={(next) => replace(index, next)}
                  renderSteps={(key, label) => {
                    if (depth >= MAX_STEP_DEPTH) {
                      return (
                        <p className="automation-step-note">
                          Nesting stops at {MAX_STEP_DEPTH} levels. Move this into its own
                          automation and call it separately.
                        </p>
                      );
                    }
                    const nested =
                      ((step as unknown as Record<string, unknown>)[key] as AutomationStep[]) || [];
                    return (
                      <div className="automation-nested">
                        <span className="automation-nested-label">{label}</span>
                        <StepList
                          steps={nested}
                          depth={depth + 1}
                          onChange={(next) => replace(
                              index,
                              {...step, [key]: next} as unknown as AutomationStep)}
                        />
                      </div>
                    );
                  }}
                />
              </div>
            )}
          </div>
        );
      })}
      <AddStep onAdd={(step) => onChange([...steps, step])} />
    </div>
  );
}
