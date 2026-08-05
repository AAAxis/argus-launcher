// The selection control for every table and card grid in the app.
//
// It stays a real <input type="checkbox">: appearance:none plus a drawn tick is
// all this is, so the platform keeps the label association, the space-bar
// toggle, the focus ring behaviour and the indeterminate flag. A div with
// role="checkbox" would have meant reimplementing all four, and useSelection --
// which is the whole selection model -- needs no knowledge of this file.
//
// Round rather than square because these are *selectors*: they pick rows out of
// a set, which is radio-shaped work even though the choice is multiple. The
// squares they replaced were unstyled native controls, so they also ignored the
// theme and looked like a different app's widget in a dark table.
import {useEffect, useRef} from 'react';
import type {ChangeEvent} from 'react';

export function Checkbox({
  checked, onChange, label, indeterminate = false, disabled = false, className = '',
}: {
  checked: boolean;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
  // The accessible name, for the standalone case: a table header or a cell with
  // no room for text, where an unlabelled checkbox in a list of forty rows is
  // unusable with a screen reader.
  //
  // Omitted -- deliberately -- when this sits inside a <label> that already
  // names it, as the move and assign dialogs do. An aria-label there does not
  // supplement the visible text, it *replaces* it, so passing one would make the
  // control announce less than it does now.
  label?: string;
  // "Some but not all", for a select-all that is partly satisfied. The DOM
  // exposes this as a property and not an attribute, so React cannot set it
  // from JSX and it has to be written to the node.
  indeterminate?: boolean;
  // A row that exists but must not be picked -- the Run dialog's profiles whose
  // proxy failed its check. Native rather than a class, so the row cannot be
  // ticked by keyboard or by clicking the label either.
  disabled?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (ref.current) {
      ref.current.indeterminate = indeterminate && !checked;
    }
  }, [indeterminate, checked]);

  return (
    <input
      aria-label={label}
      checked={checked}
      className={`selector ${className}`.trim()}
      disabled={disabled}
      onChange={onChange}
      ref={ref}
      title={label}
      type="checkbox"
    />
  );
}
