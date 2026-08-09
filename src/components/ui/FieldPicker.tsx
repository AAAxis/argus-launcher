// A form's dropdown: the cell picker's list behind a control that looks like
// the select it replaces.
//
// The three pickers in the profile editor -- who is on the hook for a profile,
// which folder it lives in, what runs when it launches -- each pick a thing the
// app draws a mark for, and a native <select> can hold nothing but text. So the
// assignee read as a name in the form and as an avatar in the table, the folder
// lost its glyph, and the automation lost its brand mark, in the one dialog
// where you are choosing between them.
//
// Deliberately NOT in CellControls.tsx, whose subject is "how a table cell
// becomes a control" -- a cell trigger is borderless on purpose, because a
// table of fifty rows should not read as a form. This is the opposite case and
// the opposite trigger; only the list is shared, and that is imported.
//
// Callers must pass `group` to the wrapping <Field>: the trigger is a <button>,
// and a <label> around it fires its implicit activation on the wrong control.
// See Field.tsx.
import {Popover} from './Popover';
import {CellPickerList} from './CellControls';
import type {CellOption} from './CellControls';
import type {ReactNode} from 'react';

export function FieldPicker({
  label,
  value,
  options,
  onPick,
  trigger,
  width = 300,
  searchPlaceholder = 'Search…',
  noneLabel,
  empty,
  footer,
  disabled = false,
}: {
  // Accessible name for the trigger, e.g. "Assign this profile". The value
  // inside it is a glyph and a name, so the button needs words of its own.
  label: string;
  value: string;
  options: CellOption[];
  onPick: (value: string) => void;
  // What the closed control shows. The same component the option rows use, so
  // the thing you picked looks like the thing you picked it from.
  trigger: ReactNode;
  width?: number;
  searchPlaceholder?: string;
  // The row that clears the field, pinned above the list under its own name --
  // "Unassigned", "All profiles", "Nothing". Not one of `options`: it is the
  // absence of one, and a search that does not match its word must not be able
  // to filter away the only way to clear the value.
  noneLabel?: string;
  empty?: string;
  // Under the list: what is not a choice among the options -- "Upload new…",
  // which is how the cookie picker keeps its path to the file dialog now that
  // the library itself is a dropdown.
  footer?: (close: () => void) => ReactNode;
  disabled?: boolean;
}) {
  return (
    <Popover
      disabled={disabled}
      label={label}
      panelClassName="filter-pop cell-pop"
      trigger={<span className="field-picker-value">{trigger}</span>}
      triggerClassName="field-picker"
      width={width}
    >
      {(close) => (
        <>
          <CellPickerList
            empty={empty}
            label={label}
            noneLabel={noneLabel}
            onPick={(next) => {
              onPick(next);
              close();
            }}
            options={options}
            searchPlaceholder={searchPlaceholder}
            value={value}
          />
          {footer && <div className="cell-pop-footer">{footer(close)}</div>}
        </>
      )}
    </Popover>
  );
}
