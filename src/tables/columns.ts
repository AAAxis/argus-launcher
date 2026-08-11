// What a table column is, and how a stored layout turns into a list of them.
//
// Before this, a column was three unrelated things spread across a tab: a
// literal <th> in the header, a literal <td> in the row map, and -- for the
// sortable ones -- an entry in the useTableSort array. Nothing tied them
// together, so "the Folder column" was not a value anything could hold, let
// alone one a picker or an API could switch off. `columnCount`, the colSpan the
// empty state needs, was a hand-maintained integer that had to be edited
// whenever any of the three changed, in each of the three tabs.
//
// A column is now one object. The tab renders <th>s from it, renders <td>s from
// it, hands the sortable ones to useTableSort, and counts them for the colSpan.
// Everything in this file is pure -- no React, no JSX -- because resolveColumns
// is the one place the UI, the stored preference and the local API have to
// agree, and the ways they could disagree are all silent.
import type {ReactNode} from 'react';
import type {SortColumn, SortDirection} from '../hooks/useTableSort';

// The tables a layout can be stored for. Deliberately not every <table> in the
// app: the Team tab's three tables have no selection, sorting or pagination and
// are read top to bottom rather than scanned by column, and Automations is a
// card grid, not a table at all. Neither is an oversight -- don't "finish the
// job" by adding them.
export type TableId = 'profiles' | 'proxies' | 'cookies';

export const TABLE_IDS: TableId[] = ['profiles', 'proxies', 'cookies'];

export function isTableId(value: unknown): value is TableId {
  return typeof value === 'string' && (TABLE_IDS as string[]).includes(value);
}

// A stored layout is the user's DEVIATIONS from the registry's defaults, not
// the list of columns they can see.
//
// A list cannot say why a column is absent. A solo user who hides Tags would
// store a list with no `assignee` in it either -- because a one-person
// workspace never offered that column -- and joining a team later would never
// bring Assigned back. A list also cannot tell "off because I hid it" from "off
// because it did not exist when I saved this", so every column shipped after
// today would arrive switched off for everyone who had ever opened the picker.
// With an override map, anything absent takes the registry's default and both
// problems stop existing.
export type ColumnOverrides = Record<string, boolean>;
export type TableLayouts = Partial<Record<TableId, ColumnOverrides>>;

export type TableColumn<Row, Ctx> = {
  // Stable, and the only part of a column that is persisted. Renaming a header
  // is free; renaming an id silently hides that column for everyone who had
  // already saved a layout mentioning it. To retire a column, drop it from the
  // registry and never reuse its id.
  id: string;
  label: string;
  // Present means sortable, and the function is what the column sorts BY,
  // which is not always what the cell renders -- Folder renders a name resolved
  // from an id, Platform renders a brand mark. Same contract as
  // SortColumn.value: undefined means "this row has no value here" and sinks
  // the row in both directions.
  sort?: (row: Row, context: Ctx) => string | number | null | undefined;
  // Dates open newest-first, as they did when this lived in the tab.
  firstDirection?: SortDirection;
  // The cell CONTENTS, not the <td>: the cell is drawn by the table so the two
  // properties below stay declarative rather than being re-implemented, and
  // forgotten, per cell.
  cell: (row: Row, context: Ctx) => ReactNode;
  cellClassName?: string;
  // The row is itself a click target, so a cell holding its own control has to
  // swallow the click -- picking a status should not also select the profile
  // underneath the picker.
  stopRowClick?: boolean;
  // Cannot be hidden. Name only: a table configured down to a column of dates
  // is a bug report rather than a preference, and there is no way back from it
  // through a picker whose rows have no names.
  locked?: boolean;
  // Off until the user asks for it. The default layout is the table as it
  // shipped, so nobody's table changes shape because they updated.
  hiddenByDefault?: boolean;
  // Offered only once there is more than one member -- on a one-person
  // workspace every row answers "you", which is a column of noise. This is the
  // `showAssignee` flag all three tabs used to keep their own copy of.
  teamOnly?: boolean;
  // One line, for the agent reading GET /v1/tables/columns. This is how a tool
  // learns what `fpScreen` is without reading our source.
  description?: string;
  // Which heading this sits under in the picker. Only Profiles uses them: it
  // offers eighteen columns, which is a wall to read as one list, where the
  // other two tables offer seven and eight and group into nothing useful.
  // Columns with no group render first, under no heading.
  group?: string;
};

// The picker's sections, in the order they appear. Derived from the registry
// rather than declared beside it, so a column added with a new group name shows
// up without a second edit -- and one added with a typo shows up as its own
// section, which is visible rather than silently misfiled.
export function columnGroups<Row, Ctx>(
    columns: Array<TableColumn<Row, Ctx>>,
): Array<{title: string; columns: Array<TableColumn<Row, Ctx>>}> {
  const groups: Array<{title: string; columns: Array<TableColumn<Row, Ctx>>}> = [];
  for (const column of columns) {
    const title = column.group || '';
    const found = groups.find((group) => group.title === title);
    if (found) {
      found.columns.push(column);
    } else {
      groups.push({title, columns: [column]});
    }
  }
  return groups;
}

export type ColumnContext = {isTeam: boolean};

// Which columns this workspace can see at all. The team-only ones are not
// merely hidden: they are not offered in the picker and not accepted by the API
// either, because "Assigned" on a solo workspace is a column that cannot say
// anything.
export function offeredColumns<Row, Ctx>(
    registry: Array<TableColumn<Row, Ctx>>,
    {isTeam}: ColumnContext,
): Array<TableColumn<Row, Ctx>> {
  return isTeam ? registry : registry.filter((column) => !column.teamOnly);
}

export function columnDefault<Row, Ctx>(column: TableColumn<Row, Ctx>): boolean {
  return Boolean(column.locked) || !column.hiddenByDefault;
}

// A stored (or agent-supplied) layout, as the list of columns to render.
//
// The rules are in this order and the order is the specification:
//
//  1. Built by walking the REGISTRY, never the stored keys, so an id left over
//     from a column we removed is inert. Nothing to migrate, nothing to clean.
//  2. teamOnly on a solo workspace is dropped whatever the override says -- but
//     the override itself is left in storage untouched, so it comes back
//     correctly the day a second member joins.
//  3. locked is kept whatever the override says. This is the guard against a
//     hand-edited user_metadata, or a buggy agent, leaving somebody with a
//     table they cannot read and no control to fix it with.
//  4. Otherwise the override, and failing that the registry default.
//  5. Registry order, always. The picker cannot reorder and neither can the
//     API, so there is no second thing to validate.
export function resolveColumns<Row, Ctx>(
    registry: Array<TableColumn<Row, Ctx>>,
    overrides: ColumnOverrides | undefined,
    context: ColumnContext,
): Array<TableColumn<Row, Ctx>> {
  return offeredColumns(registry, context).filter((column) =>
    Boolean(column.locked) || (overrides?.[column.id] ?? columnDefault(column)));
}

// The picker's rows: everything this workspace is offered, locked ones
// included. They are shown ticked and disabled rather than left out -- one
// disabled row answers "where did Name go?" where an absence raises it.
export function pickableColumns<Row, Ctx>(
    registry: Array<TableColumn<Row, Ctx>>,
    context: ColumnContext,
): Array<TableColumn<Row, Ctx>> {
  return offeredColumns(registry, context);
}

// A whole visible-column list -- what the API speaks -- as the override map we
// store. Only columns this workspace is offered are written, so a solo user's
// call cannot clear a teammate-only override they never saw.
export function overridesForVisible<Row, Ctx>(
    registry: Array<TableColumn<Row, Ctx>>,
    visibleIds: string[],
    overrides: ColumnOverrides | undefined,
    context: ColumnContext,
): ColumnOverrides {
  const wanted = new Set(visibleIds);
  const next: ColumnOverrides = {...overrides};
  for (const column of offeredColumns(registry, context)) {
    setOverride(next, column, wanted.has(column.id));
  }
  return next;
}

// One column toggled, leaving the rest of the map alone.
export function overridesWith<Row, Ctx>(
    registry: Array<TableColumn<Row, Ctx>>,
    changes: Array<{id: string; visible: boolean}>,
    overrides: ColumnOverrides | undefined,
): ColumnOverrides {
  const next: ColumnOverrides = {...overrides};
  for (const change of changes) {
    const column = registry.find((item) => item.id === change.id);
    if (column) {
      setOverride(next, column, change.visible);
    }
  }
  return next;
}

// An override equal to the default is deleted rather than written. It keeps the
// blob small -- it rides in the JWT -- and it keeps "I have not touched this"
// distinguishable from "I chose exactly the default", which is what lets a
// later change to a default reach the people who never had an opinion.
function setOverride<Row, Ctx>(
    into: ColumnOverrides, column: TableColumn<Row, Ctx>, visible: boolean) {
  const wanted = column.locked ? true : visible;
  if (wanted === columnDefault(column)) {
    delete into[column.id];
  } else {
    into[column.id] = wanted;
  }
}

// The registry, as useTableSort wants it. The context is bound here because a
// sort value can need the same lookups a cell does (the proxy behind a profile,
// the folder behind an id).
//
// Built from the WHOLE registry, not from the visible slice: useTableSort holds
// its sort key in state, and a key whose column has just been hidden would find
// no entry and quietly return the list unsorted while the header still claimed
// it was sorted. The tab clears the sort when that happens; this makes sure
// nothing is ever half-sorted in the meantime.
export function sortColumnsFrom<Row extends {id: string}, Ctx>(
    registry: Array<TableColumn<Row, Ctx>>,
    context: Ctx,
): Array<SortColumn<Row>> {
  const sortable: Array<SortColumn<Row>> = [];
  for (const column of registry) {
    const value = column.sort;
    if (value) {
      sortable.push({
        key: column.id,
        value: (row) => value(row, context),
        firstDirection: column.firstDirection,
      });
    }
  }
  return sortable;
}

// What GET /v1/tables/columns answers with. An agent that has to guess that
// "browser version" is `fpBrowser` gets one failed call and no way to learn;
// this says what exists, what is on, and what cannot be turned off.
export type ColumnDescription = {
  id: string;
  label: string;
  description?: string;
  visible: boolean;
  default: boolean;
  locked: boolean;
  sortable: boolean;
};

export function describeColumns<Row, Ctx>(
    registry: Array<TableColumn<Row, Ctx>>,
    overrides: ColumnOverrides | undefined,
    context: ColumnContext,
): {visible: string[]; available: ColumnDescription[]} {
  const visible = new Set(resolveColumns(registry, overrides, context).map((column) => column.id));
  return {
    visible: [...visible],
    // teamOnly columns are simply absent on a solo workspace: the reply
    // describes the workspace the agent is actually in, not the one it might
    // have been in.
    available: offeredColumns(registry, context).map((column) => ({
      id: column.id,
      label: column.label,
      description: column.description,
      visible: visible.has(column.id),
      default: columnDefault(column),
      locked: Boolean(column.locked),
      sortable: Boolean(column.sort),
    })),
  };
}

// A layout read back out of user_metadata, which came from a JWT and could be
// anything at all. Everything that is not a boolean under a string under a
// known table id is dropped rather than repaired.
export function readLayouts(raw: unknown): TableLayouts {
  const layouts: TableLayouts = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return layouts;
  }
  for (const [table, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!isTableId(table) || !value || typeof value !== 'object' || Array.isArray(value)) {
      continue;
    }
    const overrides: ColumnOverrides = {};
    for (const [id, visible] of Object.entries(value as Record<string, unknown>)) {
      if (typeof visible === 'boolean') {
        overrides[id] = visible;
      }
    }
    layouts[table] = overrides;
  }
  return layouts;
}
