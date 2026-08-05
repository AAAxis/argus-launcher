// The column layouts as the local API sees them: three registries behind one
// table id, a description an agent can read before it writes, and one place
// that decides whether a request is valid.
//
// Separate from ColumnLayouts.tsx because none of this is React, and separate
// from columns.ts because that file knows nothing about which three registries
// exist -- it is the shape, this is the roster.
import {COOKIE_COLUMNS} from './cookieColumns';
import {PROFILE_COLUMNS} from './profileColumns';
import {PROXY_COLUMNS} from './proxyColumns';
import {
  describeColumns, offeredColumns, overridesForVisible, overridesWith, resolveColumns,
} from './columns';
import type {
  ColumnContext, ColumnDescription, TableColumn, TableId, TableLayouts,
} from './columns';

// Three row types and three contexts, and nothing here touches a row: this
// file reads ids, labels and flags only. Threading two type parameters through
// for that would buy no checking at any call site.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRegistry = Array<TableColumn<any, any>>;

const REGISTRIES: Record<TableId, AnyRegistry> = {
  profiles: PROFILE_COLUMNS,
  proxies: PROXY_COLUMNS,
  cookies: COOKIE_COLUMNS,
};

export function registryFor(table: TableId): AnyRegistry {
  return REGISTRIES[table];
}

export type TableColumnsReport = {
  table: TableId;
  visible: string[];
  available: ColumnDescription[];
};

export function describeTable(
    table: TableId, layouts: TableLayouts, context: ColumnContext): TableColumnsReport {
  return {table, ...describeColumns(registryFor(table), layouts[table], context)};
}

export function describeAllTables(
    layouts: TableLayouts, context: ColumnContext): TableColumnsReport[] {
  return (Object.keys(REGISTRIES) as TableId[])
      .map((table) => describeTable(table, layouts, context));
}

// What POST /v1/tables/columns accepts. `columns` states the whole set;
// `show`/`hide` change a few and leave the rest alone, which is what an agent
// adding one column wants and what stops it from having to restate a layout it
// did not choose.
export type ColumnChange = {
  columns?: string[];
  show?: string[];
  hide?: string[];
  reset?: boolean;
};

// The reason this request cannot be honoured, or '' if it can.
//
// Refused rather than partially applied: an agent whose typo is silently
// dropped cannot tell that half its request did nothing, and the message names
// what it could have sent instead so the next call is right.
export function columnChangeProblem(
    table: TableId, change: ColumnChange, context: ColumnContext): string {
  const registry = registryFor(table);
  const offered = offeredColumns(registry, context);
  const named = [...(change.columns || []), ...(change.show || []), ...(change.hide || [])];
  const unknown = named.filter((id) => !offered.some((column) => column.id === id));
  if (unknown.length) {
    return `No column ${unknown.join(', ')} on the ${table} table. ` +
      `It has: ${offered.map((column) => column.id).join(', ')}.`;
  }
  // Only `hide` is refused for naming a locked column, because only `hide` says
  // so on purpose. A `columns` list that omits Name is far more likely to be an
  // agent stating the set it cares about than one trying to lose the names, so
  // that case is honoured with the locked columns added back -- which is what
  // the route's own description promises.
  const locked = offered
      .filter((column) => column.locked && change.hide?.includes(column.id))
      .map((column) => column.id);
  if (locked.length) {
    return `${locked.join(', ')} cannot be hidden on the ${table} table.`;
  }
  return '';
}

// reset, then the whole set, then the individual toggles -- so a call can put a
// table back to its defaults and then adjust one column in a single request.
export function applyColumnChange(
    table: TableId,
    change: ColumnChange,
    layouts: TableLayouts,
    context: ColumnContext,
): TableLayouts {
  const registry = registryFor(table);
  let overrides = change.reset ? {} : layouts[table];
  if (change.columns) {
    overrides = overridesForVisible(registry, change.columns, overrides, context);
  }
  const toggles = [
    ...(change.show || []).map((id) => ({id, visible: true})),
    ...(change.hide || []).map((id) => ({id, visible: false})),
  ];
  if (toggles.length) {
    overrides = overridesWith(registry, toggles, overrides);
  }
  return {...layouts, [table]: overrides || {}};
}

// Whether a table's stored layout would actually render the given column. Used
// by nothing in the UI -- the tabs resolve their own -- but it keeps the API's
// answer honest about a column that `columns` left out and `locked` put back.
export function visibleIdsFor(
    table: TableId, layouts: TableLayouts, context: ColumnContext): string[] {
  return resolveColumns(registryFor(table), layouts[table], context)
      .map((column) => column.id);
}
