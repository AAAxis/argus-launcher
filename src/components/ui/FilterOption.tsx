// One row of any popover list in the app.
//
// It lived inside TableFilters.tsx for as long as the only lists were the three
// dropdowns above a table. The Profiles table's cells now ask the same question
// eight more times -- status, folder, assignee, proxy, timezone, language,
// automation, cookie set -- and a second shape of popover row is a second
// widget to learn, which is the thing TableFilters' own header comment exists
// to prevent. Same markup and the same .filter-pop-* geometry it always had, so
// nothing about the three filters changes.
import {Check} from 'lucide-react';
import type {ReactNode} from 'react';

export function FilterOption({active, label, disabled, onPick, children}: {
  active: boolean;
  // The accessible name. The row's visible content is a chip or a glyph plus a
  // word, and for the tag rows the mark carries no text at all.
  label: string;
  disabled?: boolean;
  onPick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      aria-label={label}
      aria-selected={active}
      className={active ? 'filter-pop-option active' : 'filter-pop-option'}
      disabled={disabled}
      onClick={onPick}
      role="option"
      type="button"
    >
      {children}
      {active && <Check className="filter-pop-tick" size={13} strokeWidth={2.5} />}
    </button>
  );
}
