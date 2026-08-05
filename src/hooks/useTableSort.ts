// Column sorting for the three hand-rolled tables (Profiles, Proxies,
// Cookies). One hook rather than three copies, because the comparison rules
// below are the part that is easy to get subtly different per table and
// impossible to notice once you have.
//
// It slots between the existing filter and the pager -- visibleX(state, filters)
// -> sort() -> paginate() -- so neither of those changes shape. The rows arrive
// from Postgres in `created_at` ascending order (db/profiles.ts, db/proxies.ts,
// db/cookieSets.ts all say `.order('created_at')`), and nothing re-ordered them
// before this.
//
// In-session state on purpose. A sort is a thing you do to answer a question
// you have right now, not a preference; persisting it would mean opening the
// app to a list ordered by a click you made last week and have forgotten.
import {useState} from 'react';

// `value` returns what the column is sorted BY, which is not always what the
// cell renders: Folder renders a name resolved from an id, Assigned-to renders
// avatars but sorts on how many. Returning undefined means "this row has no
// value for this column" and is handled explicitly below -- it is not the same
// as an empty string.
export type SortColumn<T> = {
  key: string;
  value: (row: T) => string | number | null | undefined;
  // Dates sort newest-first on the first click. Ascending is the right default
  // for a name and the wrong one for "Created": nobody clicks that header
  // wanting to see the oldest profile in the workspace.
  firstDirection?: SortDirection;
};

export type SortDirection = 'asc' | 'desc';

export type TableSort<T> = {
  sortKey: string;
  direction: SortDirection;
  sort: (list: T[]) => T[];
  toggle: (key: string) => void;
  // What SortableTh needs to draw and announce itself.
  thProps: (key: string) => {
    active: boolean;
    direction: SortDirection;
    onSort: () => void;
  };
};

// Locale-aware and digit-aware: without `numeric` "Profile 10" sorts before
// "Profile 2", and without the base sensitivity a lowercase name splits away
// from its own column.
const collator = new Intl.Collator(undefined, {numeric: true, sensitivity: 'base'});

// A row with nothing in this column ranks after every row that has something,
// in BOTH directions -- which is why this is a separate rank rather than a
// value the comparison below could handle. Fold it in and the direction flips
// it too: descending "Last check" would open on the proxies that have never
// been checked, which are exactly the rows the question is not about.
// null as well as undefined: several of these columns come straight off a
// Postgres row where an absent value is null, not missing.
function missingRank(value: string | number | null | undefined) {
  return value === undefined || value === null || value === '' ? 1 : 0;
}

function compareValues(a: string | number, b: string | number) {
  if (typeof a === 'number' && typeof b === 'number') {
    return a - b;
  }
  return collator.compare(String(a), String(b));
}

export function useTableSort<T extends {id: string}>(
    columns: Array<SortColumn<T>>,
    options: {
      // No initial sort by default: the table opens in the order the database
      // returned, and nothing moves until a header is clicked.
      initial?: {key: string; direction: SortDirection};
      // Every caller pages its table, and re-ordering under a reader who is on
      // page 4 leaves them looking at rows they did not ask for. paginate()
      // clamps out of range but cannot know the list means something different
      // now, so the tabs use this to go back to the first page.
      onSortChange?: () => void;
    } = {},
): TableSort<T> {
  const [sortKey, setSortKey] = useState(options.initial?.key || '');
  const [direction, setDirection] = useState<SortDirection>(
      options.initial?.direction || 'asc');

  function toggle(key: string) {
    options.onSortChange?.();
    if (key === sortKey) {
      setDirection((current) => current === 'asc' ? 'desc' : 'asc');
      return;
    }
    setSortKey(key);
    setDirection(columns.find((column) => column.key === key)?.firstDirection || 'asc');
  }

  function sort(list: T[]): T[] {
    const column = columns.find((item) => item.key === sortKey);
    if (!column) {
      return list;
    }
    const sign = direction === 'asc' ? 1 : -1;
    // A copy: `list` is derived from workspace state and sorting it in place
    // would reorder the array the rest of the tab is reading.
    return [...list].sort((a, b) => {
      const aValue = column.value(a);
      const bValue = column.value(b);
      const rank = missingRank(aValue) - missingRank(bValue);
      if (rank !== 0) {
        return rank;
      }
      // Ties -- including two rows that are both missing -- break on id, so the
      // order is stable across re-renders. Array.sort is specified stable, but
      // the input here is rebuilt by visibleX() on every keystroke, so that
      // only helps if the tie-break is total.
      const compared = aValue === undefined || aValue === null ||
          bValue === undefined || bValue === null ?
        0 :
        compareValues(aValue, bValue);
      return compared === 0 ? collator.compare(a.id, b.id) : compared * sign;
    });
  }

  return {
    sortKey,
    direction,
    sort,
    toggle,
    thProps: (key: string) => ({
      active: key === sortKey,
      direction,
      onSort: () => toggle(key),
    }),
  };
}
