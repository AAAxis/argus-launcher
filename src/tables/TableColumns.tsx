// The two halves of a configurable table: the header cells, and one row's data
// cells.
//
// Two fragments rather than a <DataTable> that owns the whole element. The
// three tables differ in exactly the places a generic table would have to take
// over -- the row's own click target and highlight classes, the trash rows in
// Profiles, the per-tab empty state, the actions column that closes over half
// the tab's handlers -- so a full abstraction would be a much larger change
// that bought nothing these two components do not.
//
// The selection checkbox and the row actions stay hand-written in each tab, on
// either side of these. They are not columns: nobody wants to hide the way to
// select a row, and putting them in the registry would mean two permanently
// disabled entries in every picker.
import type {TableColumn} from './columns';
import type {TableSort} from '../hooks/useTableSort';
import {SortableTh} from '../components/ui/SortableTh';

export function ColumnHeaders<Row extends {id: string}, Ctx>({columns, sorting}: {
  columns: Array<TableColumn<Row, Ctx>>;
  sorting: TableSort<Row>;
}) {
  return (
    <>
      {columns.map((column) => column.sort ? (
        <SortableTh key={column.id} label={column.label} {...sorting.thProps(column.id)} />
      ) : (
        <th key={column.id}>{column.label}</th>
      ))}
    </>
  );
}

export function ColumnCells<Row extends {id: string}, Ctx>({columns, context, row}: {
  columns: Array<TableColumn<Row, Ctx>>;
  context: Ctx;
  row: Row;
}) {
  return (
    <>
      {columns.map((column) => (
        <td
          className={column.cellClassName}
          key={column.id}
          // The row is a click target of its own, so a cell holding a control
          // has to swallow the click rather than let it select the row the
          // control sits in.
          onClick={column.stopRowClick ? (event) => event.stopPropagation() : undefined}
        >
          {column.cell(row, context)}
        </td>
      ))}
    </>
  );
}
