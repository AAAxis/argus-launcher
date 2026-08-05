// A column header you can click. Pairs with useTableSort, which owns the
// comparison rules; this owns only how the header looks and what it announces.
//
// The button fills the cell rather than wrapping just the words, so the whole
// header is the target -- a 12px uppercase label is a small thing to hit, and
// the padding around it is already the cell's.
//
// The arrow is drawn only on the active column. A permanent pair of faint
// chevrons on every header (the usual pattern) puts eight pieces of chrome on a
// row whose job is to name eight columns, and it says nothing the active
// arrow does not.
import {ChevronDown, ChevronUp} from 'lucide-react';
import type {SortDirection} from '../../hooks/useTableSort';

export function SortableTh({active, direction, label, onSort}: {
  active: boolean;
  direction: SortDirection;
  label: string;
  onSort: () => void;
}) {
  return (
    // aria-sort belongs on the cell, not on the button inside it -- a screen
    // reader reads it as a property of the column.
    <th aria-sort={active ? (direction === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button className="th-sort" onClick={onSort} type="button">
        {label}
        {active && (direction === 'asc' ?
          <ChevronUp size={13} strokeWidth={2.25} /> :
          <ChevronDown size={13} strokeWidth={2.25} />)}
      </button>
    </th>
  );
}
