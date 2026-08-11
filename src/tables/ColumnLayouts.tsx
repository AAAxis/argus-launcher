// Who owns the column layouts, and when they get written.
//
// The layouts themselves arrive with the user record (org.tableColumns, read
// out of user_metadata), so this holds a working copy on top of it: the picker
// has to feel instant, and a toggle that waited on a network round trip before
// the column moved would feel broken on a slow connection.
//
// A provider rather than a module-level store because the write needs
// useOrg().refreshUser -- updateUser() emits no auth event, so nothing else
// would tell the tree the metadata changed. It sits above WorkspaceProvider, so
// both the tabs and the local API's renderer bridge read the same value.
//
// Note the deliberate asymmetry with sorting, which useTableSort keeps in
// session state and never persists: a sort answers a question you have right
// now, and reopening the app into last week's click would be wrong. Which
// columns exist for you is not a question, it is a preference.
import {createContext, useCallback, useContext, useEffect, useMemo, useState} from 'react';
import type {ReactNode} from 'react';
import {updateTableColumns} from '../db/account';
import {useOrg} from '../org';
import {overridesForVisible, overridesWith, resolveColumns} from './columns';
import type {
  ColumnContext, ColumnOverrides, TableColumn, TableId, TableLayouts,
} from './columns';

type ColumnLayoutsValue = {
  layouts: TableLayouts;
  overridesFor: (table: TableId) => ColumnOverrides | undefined;
  // The two mutations the UI needs, and the one the API needs. All three are
  // whole-map replacements for one table; the provider merges them into the
  // layouts object and saves that.
  toggleColumn: (table: TableId, columnId: string, visible: boolean, registry: AnyRegistry) => void;
  setVisibleColumns: (
    table: TableId, visibleIds: string[], registry: AnyRegistry, context: ColumnContext) => void;
  resetTable: (table: TableId) => void;
  // The whole object at once, for the local API: its handler has already
  // validated the request and built the layout it wants, and re-deriving that
  // here would be the same rules written twice.
  setLayouts: (next: TableLayouts) => void;
  // Whether the last write failed. The tabs do not surface this -- the toast
  // does, from here -- but the API handler reports it back to its caller.
  error: string;
};

// The provider is generic over three different row types, and none of its
// operations touch a row: they read ids, `locked` and the default. Typing that
// honestly would mean threading two type parameters through the context for no
// checking that means anything at the call site.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRegistry = Array<TableColumn<any, any>>;

const ColumnLayoutsContext = createContext<ColumnLayoutsValue | null>(null);

export function useColumnLayouts(): ColumnLayoutsValue {
  const value = useContext(ColumnLayoutsContext);
  if (!value) {
    throw new Error('useColumnLayouts must be used inside <ColumnLayoutsProvider>');
  }
  return value;
}

export function ColumnLayoutsProvider({children}: {children: ReactNode}) {
  const org = useOrg();
  const stored = org.tableColumns;
  const userId = org.userId;
  const [layouts, setLayouts] = useState<TableLayouts>(stored);
  const [error, setError] = useState('');

  // Keyed on the account, not on the record.
  //
  // The record changes on every avatar edit, name edit and token refresh, and
  // -- more to the point -- on our own write: between updateUser() resolving
  // and refreshUser() landing, org.tableColumns is still the pre-write value,
  // so re-seeding from it would put the column the user just hid straight back.
  useEffect(() => {
    setLayouts(stored);
    setError('');
    // `stored` is deliberately not a dependency -- see above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const save = useCallback((next: TableLayouts) => {
    setLayouts(next);
    // Signed out, the picker still works for the session and writes nothing.
    // There is nowhere to put it and no user to put it against, and throwing
    // here would take out a tab for a preference.
    if (!userId) {
      return;
    }
    void (async () => {
      try {
        const user = await updateTableColumns(next);
        setError('');
        // updateUser() returns the new record and emits no auth event, so hand
        // it back rather than paying for a second round trip. Same call
        // Settings makes after a name or avatar edit.
        await org.refreshUser(user);
      } catch (problem) {
        // The local value stands. Rolling back would take the column away
        // under the cursor that just asked for it, and the layout is worth
        // less than the confusion that would cause -- but the failure is
        // reported, because a preference that silently does not persist is
        // how you get a bug report about a setting that resets itself.
        setError(problem instanceof Error ? problem.message : String(problem));
      }
    })();
  }, [org, userId]);

  const value = useMemo<ColumnLayoutsValue>(() => ({
    layouts,
    error,
    overridesFor: (table) => layouts[table],
    toggleColumn: (table, columnId, visible, registry) => {
      save({
        ...layouts,
        [table]: overridesWith(registry, [{id: columnId, visible}], layouts[table]),
      });
    },
    setVisibleColumns: (table, visibleIds, registry, context) => {
      save({
        ...layouts,
        [table]: overridesForVisible(registry, visibleIds, layouts[table], context),
      });
    },
    // An empty override map, not a deleted key: both mean "the defaults", and
    // writing the empty map keeps the shape uniform for anything reading the
    // blob back.
    resetTable: (table) => save({...layouts, [table]: {}}),
    setLayouts: save,
  }), [layouts, error, save]);

  return (
    <ColumnLayoutsContext.Provider value={value}>{children}</ColumnLayoutsContext.Provider>
  );
}

// What a tab needs: the columns to render, and the two calls the picker makes.
// `isTeam` is the old `showAssignee` flag -- on a one-person workspace the
// team-only columns are not hidden, they are not offered.
export function useTableColumns<Row, Ctx>(
    table: TableId,
    registry: Array<TableColumn<Row, Ctx>>,
    context: ColumnContext,
) {
  const layouts = useColumnLayouts();
  const overrides = layouts.overridesFor(table);
  // On isTeam rather than on `context`, which every caller builds inline and
  // which would therefore be a new object on every render.
  const isTeam = context.isTeam;
  const columns = useMemo(
      () => resolveColumns(registry, overrides, {isTeam}),
      [registry, overrides, isTeam]);

  return {
    columns,
    overrides,
    isVisible: (columnId: string) => columns.some((column) => column.id === columnId),
    setVisible: (columnId: string, visible: boolean) =>
      layouts.toggleColumn(table, columnId, visible, registry),
    reset: () => layouts.resetTable(table),
  };
}
