// "Columns" -- the control that decides what a table shows.
//
// Generic over any registry in src/tables, so the three tables share one picker
// rather than three that drift. What it toggles is a preference stored against
// the account (tables/ColumnLayouts.tsx), so a layout follows the person to
// whatever machine they sign in on.
//
// Built as switches in the app's existing popover-list shape -- the same rows
// the status and platform pickers use, label left and a tick at the far edge --
// rather than a column of round .selector checkboxes. Those are the row-picking
// control: eighteen of them in a menu reads as "select eighteen things", which
// is not what this panel does. It also stays open while you tick, where the
// other two close on pick: configuring six columns should not be six trips
// through the same button.
import {Check, Columns3, RotateCcw} from 'lucide-react';
import {Popover} from './Popover';
import {columnGroups, pickableColumns} from '../../tables/columns';
import type {ColumnContext, TableColumn} from '../../tables/columns';

export function ColumnsButton<Row, Ctx>({
  registry, context, isVisible, onToggle, onReset,
}: {
  registry: Array<TableColumn<Row, Ctx>>;
  context: ColumnContext;
  isVisible: (columnId: string) => boolean;
  onToggle: (columnId: string, visible: boolean) => void;
  onReset: () => void;
}) {
  const groups = columnGroups(pickableColumns(registry, context));
  const hidden = groups
      .flatMap((group) => group.columns)
      .filter((column) => !isVisible(column.id)).length;

  return (
    <Popover
      label="Columns"
      panelClassName="columns-pop"
      // The count, not a dot: "3 hidden" is the fact somebody wants when a
      // column they expected is missing, and it is the only way to tell a
      // configured table from a default one without opening the panel. Outside
      // the label span on purpose: the label goes quiet at rest and the badge
      // must not, or the one thing worth noticing here fades with it.
      trigger={
        <>
          <span className="filter-trigger-label">
            <Columns3 size={15} strokeWidth={1.9} /> Columns
          </span>
          {hidden > 0 && <span className="columns-trigger-count">{hidden} hidden</span>}
        </>
      }
      // Flat, like the status and tag filters it shares a toolbar with, rather
      // than the bordered ghost this used to be. See the .filter-trigger note in
      // styles.css: a row of boxes above a table whose own headers carry none
      // read as heavier than the thing it configures, and Columns was the last
      // box left in it.
      triggerClassName="filter-trigger columns-trigger"
      width={248}
    >
      <>
        <div className="columns-pop-scroll">
          {groups.map((group) => (
            <div className="columns-pop-group" key={group.title || 'ungrouped'}>
              {group.title && <p className="columns-pop-group-label">{group.title}</p>}
              {group.columns.map((column) => {
                const on = isVisible(column.id);
                return (
                  <button
                    aria-checked={on}
                    className={on ? 'columns-pop-option active' : 'columns-pop-option'}
                    // Name, which every table keeps. Disabled rather than left
                    // out: one greyed row answers "where did Name go?", where an
                    // absence raises the question instead.
                    disabled={column.locked}
                    key={column.id}
                    onClick={() => onToggle(column.id, !on)}
                    role="switch"
                    title={column.locked ? 'Always shown' : column.description}
                    type="button"
                  >
                    {column.label}
                    {on && <Check size={14} strokeWidth={2.5} />}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
        {/* The rule belongs to the footer, not to the button: a button carrying
          * its own square top border cannot also be a rounded control. */}
        <div className="columns-pop-footer">
          <button className="ghost columns-pop-reset" onClick={onReset} type="button">
            <RotateCcw size={14} /> Reset to default
          </button>
        </div>
      </>
    </Popover>
  );
}
