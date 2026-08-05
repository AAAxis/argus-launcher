import {describe, expect, it} from 'vitest';
import {
  columnDefault, describeColumns, overridesForVisible, overridesWith, readLayouts, resolveColumns,
} from './columns';
import type {TableColumn} from './columns';

// A stand-in registry rather than the real one: these tests are about the rules,
// and pinning them to PROFILE_COLUMNS would make every future column a failing
// test.
type Row = {id: string};
const REGISTRY: Array<TableColumn<Row, unknown>> = [
  {id: 'name', label: 'Name', locked: true, cell: () => null},
  {id: 'status', label: 'Status', cell: () => null},
  {id: 'assignee', label: 'Assigned', teamOnly: true, cell: () => null},
  {id: 'email', label: 'Login email', hiddenByDefault: true, cell: () => null},
];

const SOLO = {isTeam: false};
const TEAM = {isTeam: true};

function ids(columns: Array<TableColumn<Row, unknown>>) {
  return columns.map((column) => column.id);
}

describe('resolveColumns', () => {
  it('gives the defaults when nothing is stored', () => {
    expect(ids(resolveColumns(REGISTRY, undefined, TEAM))).toEqual(['name', 'status', 'assignee']);
  });

  it('leaves a hidden-by-default column off until it is asked for', () => {
    expect(ids(resolveColumns(REGISTRY, {email: true}, TEAM)))
        .toEqual(['name', 'status', 'assignee', 'email']);
  });

  // The whole reason a stored layout is an override map and not a list of
  // visible ids: a list saved on a solo workspace could not say whether
  // `assignee` was missing because it was hidden or because it was never
  // offered, and joining a team would never bring it back.
  it('drops a team-only column on a solo workspace but keeps its override', () => {
    expect(ids(resolveColumns(REGISTRY, {assignee: true}, SOLO))).toEqual(['name', 'status']);
    expect(ids(resolveColumns(REGISTRY, {assignee: true}, TEAM)))
        .toEqual(['name', 'status', 'assignee']);
  });

  // The guard against a hand-edited user_metadata, or a buggy agent, leaving
  // somebody with a table of dates and no control that can name a row.
  it('keeps a locked column even when the stored layout hides it', () => {
    expect(ids(resolveColumns(REGISTRY, {name: false}, TEAM)))
        .toEqual(['name', 'status', 'assignee']);
  });

  // A column retired in a later release. Built by walking the registry, so a
  // leftover id is simply never read -- nothing to migrate.
  it('ignores an id no column answers to', () => {
    expect(ids(resolveColumns(REGISTRY, {gone: true, status: false}, TEAM)))
        .toEqual(['name', 'assignee']);
  });

  it('renders in registry order whatever order the overrides are in', () => {
    expect(ids(resolveColumns(REGISTRY, {email: true, status: true}, SOLO)))
        .toEqual(['name', 'status', 'email']);
  });
});

describe('overridesForVisible', () => {
  it('writes only what differs from the default', () => {
    expect(overridesForVisible(REGISTRY, ['name', 'email'], undefined, TEAM))
        .toEqual({status: false, assignee: false, email: true});
  });

  it('drops an override that has come back to its default', () => {
    expect(overridesForVisible(REGISTRY, ['name', 'status', 'assignee'], {status: false}, TEAM))
        .toEqual({});
  });

  // A solo caller cannot clear an override on a column it was never shown.
  it('leaves a column this workspace is not offered alone', () => {
    expect(overridesForVisible(REGISTRY, ['name'], {assignee: true}, SOLO))
        .toEqual({assignee: true, status: false});
  });

  it('cannot switch off a locked column', () => {
    expect(overridesForVisible(REGISTRY, ['status'], undefined, TEAM).name).toBeUndefined();
  });
});

describe('overridesWith', () => {
  it('changes one column and leaves the rest of the map', () => {
    expect(overridesWith(REGISTRY, [{id: 'email', visible: true}], {status: false}))
        .toEqual({status: false, email: true});
  });

  it('ignores a column that does not exist', () => {
    expect(overridesWith(REGISTRY, [{id: 'gone', visible: true}], {})).toEqual({});
  });
});

describe('describeColumns', () => {
  it('reports every offered column with its state', () => {
    const {visible, available} = describeColumns(REGISTRY, {email: true}, SOLO);
    expect(visible).toEqual(['name', 'status', 'email']);
    // teamOnly is absent rather than listed-and-unavailable: the reply
    // describes the workspace the caller is actually in.
    expect(available.map((column) => column.id)).toEqual(['name', 'status', 'email']);
    expect(available[0]).toMatchObject({id: 'name', locked: true, visible: true, default: true});
    expect(available[2]).toMatchObject({id: 'email', locked: false, visible: true, default: false});
  });
});

describe('columnDefault', () => {
  it('is on unless the column says otherwise, and always on when locked', () => {
    expect(columnDefault(REGISTRY[0])).toBe(true);
    expect(columnDefault(REGISTRY[3])).toBe(false);
  });
});

describe('readLayouts', () => {
  it('keeps a well-formed layout', () => {
    expect(readLayouts({profiles: {email: true}})).toEqual({profiles: {email: true}});
  });

  // It was decoded from a JWT: anything at all could be in there, and none of
  // it is worth repairing.
  it('drops tables it does not know and values that are not booleans', () => {
    expect(readLayouts({profiles: {email: 'yes', tags: false}, nope: {a: true}}))
        .toEqual({profiles: {tags: false}});
  });

  it('answers with an empty layout for a non-object', () => {
    expect(readLayouts(undefined)).toEqual({});
    expect(readLayouts('profiles')).toEqual({});
    expect(readLayouts([1, 2])).toEqual({});
  });
});
