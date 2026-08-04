// A profile's status as a coloured chip, and the picker that changes it.
//
// It used to be a <select> in both places it appears -- the profiles table and
// the profile dialog. A select styled with a status colour is a strange object:
// it looks like a filled tag but behaves like a form control, so a row of them
// reads as a column of dropdowns rather than as the statuses themselves. The
// chip is the value; the pencil is the way to change it.
import {Pencil, Plus} from 'lucide-react';
import {Popover} from './Popover';
import {statusToneClass} from '../../data/statuses';

export function StatusChip({status, className = ''}: {status: string; className?: string}) {
  return (
    <span className={`status-chip ${statusToneClass(status)} ${className}`.trim()}>
      <i className="status-chip-dot" />
      {status}
    </span>
  );
}

// The chip plus its pencil. Both the table row and the profile dialog use this,
// so the set of statuses and the way they are drawn cannot diverge between the
// place a status is read and the place it is set.
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
