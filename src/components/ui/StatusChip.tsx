// A profile's status as a coloured chip, and the picker that changes it.
//
// It used to be a <select> in both places it appears -- the profiles table and
// the profile dialog. A select styled with a status colour is a strange object:
// it looks like a filled tag but behaves like a form control, so a row of them
// reads as a column of dropdowns rather than as the statuses themselves.
//
// For a while after that the chip was the value and a pencil beside it was the
// way to change it. In the table that pencil was wrong twice over. It taught
// that the chip -- the thing that says "Active" -- is not the thing to press;
// and because fifty always-visible pencils are a column of their own it was
// hidden with `opacity: 0`, which hides the paint and keeps the box, so every
// chip in the table carried ~30px of permanent blank to its right.
//
// So in the table the chip IS the trigger (StatusCell, on CellPicker). The
// dialog keeps the pencil: there the field is one row in a form rather than one
// cell in fifty, nothing is hidden, and a chip that silently opens a menu is
// less discoverable than an explicit control beside it.
import {Pencil, Plus} from 'lucide-react';
import {Popover} from './Popover';
import {statusToneClass} from '../../data/statuses';
import type {CellOption} from './CellControls';

export function StatusChip({status, className = ''}: {status: string; className?: string}) {
  return (
    <span className={`status-chip ${statusToneClass(status)} ${className}`.trim()}>
      <i className="status-chip-dot" />
      {status}
    </span>
  );
}

// The status options, as picker rows. Shared by both controls below so the set
// of statuses and the way they are drawn cannot diverge between the place a
// status is read and the place it is set.
export function statusOptionRows(options: string[]): CellOption[] {
  return options.map((option) => ({
    value: option,
    label: option,
    render: <StatusChip status={option} />,
  }));
}

// The chip plus its pencil, for the profile dialog.
export function StatusPicker({status, options, onChange, onNewStatus}: {
  status: string;
  options: string[];
  onChange: (status: string) => void;
  // Only the profile dialog offers this; the table's picker is a chooser, not
  // a place to define new statuses.
  onNewStatus?: () => void;
}) {
  return (
    <span className="status-picker">
      <StatusChip status={status} />
      <Popover
        label="Change status"
        panelClassName="status-pop"
        trigger={<Pencil size={13} />}
        triggerClassName="icon-button status-picker-edit"
        width={230}
      >
        {(close) => (
          <>
            <div className="status-pop-list" role="listbox" aria-label="Status">
              {options.map((option) => (
                <button
                  aria-selected={option === status}
                  className={option === status ? 'status-pop-option active' : 'status-pop-option'}
                  key={option}
                  onClick={() => {
                    onChange(option);
                    close();
                  }}
                  role="option"
                  type="button"
                >
                  <StatusChip status={option} />
                </button>
              ))}
            </div>
            {onNewStatus && (
              <button
                className="ghost status-pop-new"
                onClick={() => {
                  close();
                  onNewStatus();
                }}
                type="button"
              >
                <Plus size={15} /> New status
              </button>
            )}
          </>
        )}
      </Popover>
    </span>
  );
}
