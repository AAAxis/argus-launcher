// A form for answering one automation's declared parameters.
//
// One component, two callers: the profile editor (where the answers are saved
// on the profile) and the Run dialog (where they are edited for a single run).
// That is deliberate rather than convenient -- the two surfaces show the same
// values, and a second renderer would drift on exactly the details that matter,
// like whether a blank box means "empty" or "use the default".
//
// Values are held as STRINGS, matching the profile draft. Coercion to the
// declared type happens once, at run time, in resolveRunVars -- so a number
// parameter is still an <input type="number"> here without this component
// having to decide what 2 means.
import {Field} from '../ui/Field';
import {SecretInput} from '../ui/SecretInput';
import {hasValue, paramLabel} from '../../automations/parameters';
import type {AutomationParam} from '../../automations/parameters';

export type ParamValueMap = Record<string, string>;

// What the box shows when it is empty. The automation's default is the useful
// answer -- "leave this alone and you get Dortmund" -- and it is more use than
// a generic placeholder, so it wins when both exist.
function placeholderFor(param: AutomationParam): string | undefined {
  if (param.kind === 'boolean') {
    return undefined;
  }
  if (hasValue(param, param.default)) {
    const shown = Array.isArray(param.default) ?
      (param.default as string[]).join(', ') : String(param.default);
    return `Default: ${shown}`;
  }
  return param.placeholder;
}

function control(
    param: AutomationParam,
    value: string,
    set: (next: string) => void,
): JSX.Element {
  switch (param.kind) {
    case 'secret':
      return (
        <SecretInput
          value={value}
          placeholder={placeholderFor(param)}
          onChange={set}
        />
      );
    case 'number':
      return (
        <input
          type="number"
          value={value}
          placeholder={placeholderFor(param)}
          onChange={(event) => set(event.target.value)}
        />
      );
    case 'boolean':
      return (
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={value === 'true'}
            onChange={(event) => set(event.target.checked ? 'true' : 'false')}
          />
          <span>{paramLabel(param)}</span>
        </label>
      );
    case 'select':
      return (
        <select value={value} onChange={(event) => set(event.target.value)}>
          {/* Only when the parameter is optional. On a required one there is no
              honest label for the empty pick -- "nothing" is exactly what the
              run refuses -- so the list starts at the first real choice. */}
          {!param.required && (
            <option value="">
              {hasValue(param, param.default) ?
                `Default (${String(param.default)})` : 'Not set'}
            </option>
          )}
          {(param.options || []).map((option) => (
            <option key={option} value={option}>{option}</option>
          ))}
          {/* A value that is no longer one of the choices -- the parameter's
              options were edited after this profile answered. Shown rather than
              silently snapped to the first option, which would change what a
              profile runs with and never say so. */}
          {value !== '' && !(param.options || []).includes(value) && (
            <option value={value}>{value} (no longer offered)</option>
          )}
        </select>
      );
    case 'list':
      return (
        <textarea
          rows={3}
          value={value}
          placeholder={placeholderFor(param) || 'One per line'}
          onChange={(event) => set(event.target.value)}
        />
      );
    case 'textarea':
      return (
        <textarea
          rows={3}
          value={value}
          placeholder={placeholderFor(param)}
          onChange={(event) => set(event.target.value)}
        />
      );
    default:
      return (
        <input
          type="text"
          value={value}
          placeholder={placeholderFor(param)}
          onChange={(event) => set(event.target.value)}
        />
      );
  }
}

export function ParamValueFields({
  parameters, values, onChange, showMissing = true, compact = false,
}: {
  parameters: AutomationParam[];
  values: ParamValueMap;
  onChange: (next: ParamValueMap) => void;
  // Whether an unanswered required parameter is called out here. The Run dialog
  // turns it off on rows that are not ticked: a profile you are not running is
  // not missing anything.
  showMissing?: boolean;
  // Two columns and no hints, for the Run dialog. Five parameters at full
  // height push the second profile off the screen, and a dialog that can only
  // show one profile's values cannot do the thing it exists for -- running
  // Dortmund on one and Essen on the next. The profile editor keeps the full
  // form: there is one automation per block there and room to explain it.
  compact?: boolean;
}) {
  if (parameters.length === 0) {
    return null;
  }
  return (
    <div className={`param-values${compact ? ' is-compact' : ''}`}>
      {parameters.map((param) => {
        const value = values[param.name] ?? '';
        const set = (next: string) => onChange({...values, [param.name]: next});
        // Blank AND no default to fall back on. A required parameter with a
        // default can never be missing, so flagging one would be noise.
        const missing = showMissing && Boolean(param.required) &&
          value.trim() === '' && !hasValue(param, param.default);
        // A checkbox carries its own label, so a Field around it prints it
        // twice -- the same exception StepFields makes.
        if (param.kind === 'boolean') {
          return (
            <div className="param-value-field" key={param.name}>
              {control(param, value, set)}
              {param.hint && <p className="field-hint">{param.hint}</p>}
            </div>
          );
        }
        return (
          <Field
            key={param.name}
            label={param.required ? `${paramLabel(param)} *` : paramLabel(param)}
            hint={param.kind === 'secret' ?
              // Said at the point of use, because a masked box implies an
              // encryption that is not there. The same plaintext treatment
              // every proxy password and connector credential already gets.
              [param.hint, 'Hidden here, but stored as text like a proxy password.']
                  .filter(Boolean).join(' ') :
              param.hint}
          >
            {control(param, value, set)}
            {missing && (
              <p className="param-value-missing">
                Needed before this can run.
              </p>
            )}
          </Field>
        );
      })}
    </div>
  );
}
