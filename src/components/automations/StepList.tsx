// The step flow: an ordered list of node cards joined by connectors, with
// if/loop opening out into labelled branches.
//
// Recursive: a step whose schema declares a field of kind 'steps' renders one
// nested flow per such field -- two for `if` (Yes/No), one for `loop`. Depth is
// capped at MAX_STEP_DEPTH; past three levels a linear editor stops being more
// readable than a graph, which is the entire reason it is linear.
//
// Nested flows are rendered HERE rather than inside StepFields, and are drawn
// whether or not the step is expanded. They are the step's shape, not its
// configuration. When they lived in the field panel a collapsed `loop` showed
// nothing at all, so the editor read as if branching had never been built --
// which it had, from the first commit.
//
// Which fields are nested is read off the schema, not hardcoded: nothing in
// this file knows that `if` is the branching one. Adding a composite step type
// means a JSON entry, a union member and an executor, exactly as before.
//
// Drag-and-drop is native HTML5, no library, and reordering is confined to one
// list: dragging a step out of a loop body and into the top level would have to
// answer what happens to {{loop.item}} references inside it, and the honest
// answer needs a rename pass nobody asked for. Cut and re-add instead.
import {useState} from 'react';
import {Copy, GripVertical, Pencil, Plus, Trash2} from 'lucide-react';
import {StepFields} from './StepFields';
import {STEP_TYPES, specFor} from '../../automations/schema';
import {stepIcon} from '../../automations/icons';
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

function AddStep({onAdd, subtle}: {
  onAdd: (step: AutomationStep) => void;
  // Inside a branch the button is the only thing in an otherwise empty box, so
  // it carries the affordance itself rather than sitting under a "No steps
  // yet" line that says the same thing twice.
  subtle?: boolean;
}) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <button
        type="button"
        className={`automation-add${subtle ? ' is-subtle' : ''}`}
        onClick={() => setOpen(true)}
      >
        <Plus size={15} /> Add step
      </button>
    );
  }
  return (
    <div className="automation-add-menu">
      {STEP_TYPES.map((type) => {
        const spec = specFor(type);
        const Icon = stepIcon(spec.icon);
        return (
          <button
            key={type}
            type="button"
            onClick={() => {
              onAdd(blankStep(type));
              setOpen(false);
            }}
          ><Icon size={13} /> {spec.label}</button>
        );
      })}
      <button type="button" className="automation-add-cancel" onClick={() => setOpen(false)}>
        Cancel
      </button>
    </div>
  );
}

export function StepList({steps, onChange, checkProfile, connectors = [], depth = 0}: {
  steps: AutomationStep[];
  onChange: (next: AutomationStep[]) => void;
  // Passed straight through to StepFields for the Check button. Threaded
  // rather than read from context because this component is also the
  // recursion, and a branch's steps check against the same profile.
  checkProfile?: {id: string; name: string} | null;
  // The workspace's connectors, for a step's connector dropdown. Threaded
  // for the same reason checkProfile is.
  connectors?: {id: string; name: string; category: string; is_default?: boolean}[];
  depth?: number;
}) {
  // A Set, not a single id. It used to be `string | null`, so opening one step
  // closed whichever was already open -- which makes comparing two steps, or
  // filling in a loop and the step that feeds it, a matter of clicking back and
  // forth. Nothing about the editor needs them to be mutually exclusive.
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const [dragging, setDragging] = useState<number | null>(null);

  function toggle(id: string) {
    setExpanded((current) => {
      const next = new Set(current);
      if (!next.delete(id)) {
        next.add(id);
      }
      return next;
    });
  }

  // A step is added because it is about to be configured, and every step type
  // except `screenshot` has at least one required field. Landing collapsed
  // meant the next action after "Add step" was always the same click, on a
  // 14px target, to reach the form you had just asked for.
  function add(step: AutomationStep) {
    onChange([...steps, step]);
    setExpanded((current) => new Set(current).add(step.id));
  }

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
    <div className={depth > 0 ? 'automation-flow is-nested' : 'automation-flow'}>
      {steps.length === 0 && depth === 0 && (
        <p className="automation-steps-empty">
          No steps yet. An automation runs these in order, top to bottom.
        </p>
      )}

      {steps.map((step, index) => {
        const isOpen = expanded.has(step.id);
        const spec = specFor(step.type);
        const Icon = stepIcon(spec.icon);
        // Every 'steps' field is a branch of this node: `then` and `else` for
        // an if, `body` for a loop. Read from the schema so this stays true of
        // whatever composite step is added next.
        const branches = spec.fields.filter((field) => field.kind === 'steps');
        const atDepthCap = depth >= MAX_STEP_DEPTH;

        return (
          <div className="automation-node" key={step.id}>
            <div
              className={`automation-node-card${step.enabled === false ? ' is-off' : ''}` +
                `${isOpen ? ' is-open' : ''}`}
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
              <div className="automation-node-row">
                <span className="automation-node-handle" aria-hidden="true">
                  <GripVertical size={14} />
                </span>
                <span className="automation-node-icon" aria-hidden="true">
                  <Icon size={15} strokeWidth={1.75} />
                </span>
                <span className="automation-node-index">{index + 1}</span>
                {/* Static, not a button. The chevron this replaces read as a
                    disclosure triangle on a row that is really a record you
                    edit, and the same call was already made for a profile's
                    status: the chip is the value, the pencil is the way to
                    change it. */}
                <span className="automation-node-label">
                  <span className="automation-node-title">{spec.label}</span>
                  <span className="automation-node-summary">{summarize(step)}</span>
                </span>
                <button
                  type="button"
                  className={`icon-button automation-node-edit${isOpen ? ' is-editing' : ''}`}
                  onClick={() => toggle(step.id)}
                  aria-expanded={isOpen}
                  aria-label={isOpen ? `Close ${spec.label} settings` : `Edit ${spec.label}`}
                  title={isOpen ? 'Close' : 'Edit this step'}
                ><Pencil size={14} /></button>
                <label
                  className="automation-node-enabled"
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
                <div className="automation-node-fields">
                  <StepFields
                    step={step}
                    onChange={(next) => replace(index, next)}
                    checkProfile={checkProfile}
                    connectors={connectors}
                  />
                </div>
              )}
            </div>

            {branches.length > 0 && (
              atDepthCap ? (
                <p className="automation-step-note">
                  Nesting stops at {MAX_STEP_DEPTH} levels. Move this into its own
                  automation and call it separately.
                </p>
              ) : (
                <div
                  className="automation-branches"
                  data-count={branches.length}
                >
                  {branches.map((field) => {
                    const nested = ((step as unknown as Record<string, unknown>)[field.key] as
                      AutomationStep[]) || [];
                    return (
                      <div className="automation-branch" data-branch={field.key} key={field.key}>
                        <span className="automation-branch-label">{field.label}</span>
                        <StepList
                          steps={nested}
                          checkProfile={checkProfile}
                          connectors={connectors}
                          depth={depth + 1}
                          onChange={(next) => replace(
                              index,
                              {...step, [field.key]: next} as unknown as AutomationStep)}
                        />
                      </div>
                    );
                  })}
                </div>
              )
            )}
          </div>
        );
      })}

      <AddStep subtle={depth > 0} onAdd={add} />
    </div>
  );
}
