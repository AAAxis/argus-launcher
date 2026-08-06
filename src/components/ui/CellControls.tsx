// How a table cell becomes a control.
//
// One file for four components because they all answer one question, and split
// across four they would drift on the three things that actually matter here:
// the trigger's geometry, how a hover-revealed affordance is hidden, and who
// swallows the row's click.
//
// The shape all of these replace was "a value, and a pencil beside it". That
// had two faults, and only one of them was visible. The visible one: fifty
// pencils down a table are a column of their own, so the pencil was hidden with
// `opacity: 0` until its row was hovered -- and opacity hides the paint while
// keeping the box, so every status chip in the table carried ~30px of reserved
// blank to its right, on every row, forever. The invisible one: a pencil beside
// a chip teaches that the chip is not the thing to press, which is the opposite
// of what a chip reading "Active" should say.
//
// So the value IS the trigger, and nothing here is hidden by opacity while
// still occupying space. This table is `table-layout: auto` (styles.css), which
// recomputes every column's width from its content -- so a control that changes
// width on hover makes the browser redistribute across the whole table and the
// jitter is visible on all rows at once. Hover must be a paint-only change:
// either the affordance is always drawn (the caret, dimmed) or it is out of
// flow entirely (the copy button, absolutely positioned).
//
// Everything floating is a Popover, the app's one floating layer:
// outside-click, Escape, resize and scroll dismissal and the flip-above are
// solved there and must not be re-solved per cell.
import {useState} from 'react';
import {Search, Tag} from 'lucide-react';
import {CopyButton} from './CopyButton';
import {FilterOption} from './FilterOption';
import {Popover} from './Popover';
import {TagCell} from './TagChip';
import {TagInput} from './TagInput';
import type {TagUsage} from '../../lib/tags';
import type {ReactNode} from 'react';

// Above this many rows a picker grows a search box. Statuses (5) and languages
// (4) never do -- a search field over four rows is a control with nothing to
// do. Proxies, members, automations, cookie sets and timezones (~60) all cross
// it.
const SEARCH_THRESHOLD = 8;

export type CellOption = {
  // '' is reserved for the absence of a value -- Unassigned, Direct, None.
  value: string;
  // What the row is called: the accessible name, and what a search matches
  // unless `searchText` says otherwise.
  label: string;
  // The row's visible content, when a plain name is not enough (a status chip,
  // a folder glyph, an avatar). Defaults to the label.
  render?: ReactNode;
  // Everything a search should match beyond the label -- the proxy rows match
  // host, port, country and type through proxySearchText().
  searchText?: string;
  // Quiet, right-aligned secondary text: a proxy's type, a cookie set's count.
  hint?: string;
};

// The em dash every cell in this table uses for "none". A blank in a table of
// eighteen columns reads as a rendering fault; a dash reads as "this one has
// none".
function none() {
  return <span className="cell-muted">—</span>;
}

// ── The picker ───────────────────────────────────────────────────────────────

export function CellPicker({
  label,
  value,
  options,
  onPick,
  trigger,
  width = 244,
  searchPlaceholder = 'Search…',
  noneLabel,
  empty,
  footer,
  chip = false,
  disabled = false,
}: {
  // Accessible name for the trigger, e.g. "Change status for Acme". The value
  // inside it is a chip or a glyph, so the button needs its own words.
  label: string;
  value: string;
  options: CellOption[];
  onPick: (value: string) => void;
  // What the cell shows when the panel is shut.
  trigger: ReactNode;
  width?: number;
  searchPlaceholder?: string;
  // The row that clears the field, pinned above the list under its own name --
  // "Direct", "Unassigned", "None". Not part of `options` because it is not one
  // of them: it is the absence of one, and a search that does not match its
  // word must not be able to filter away the only way to clear a value.
  noneLabel?: string;
  // Shown when the library behind this picker is empty. "No proxies saved yet"
  // is a different message from a search that matched nothing.
  empty?: string;
  // Under the list: the actions that are not a choice -- "New status…",
  // "Open in Cookies", a Copy button.
  footer?: (close: () => void) => ReactNode;
  // The value is a chip -- something that already draws its own box. Suppresses
  // the trigger's hover plate, which behind a bordered pill is a second box
  // around the first, and moves the hover onto the chip's own border instead.
  // Status is the only cell that qualifies today.
  chip?: boolean;
  // Shown and greyed rather than turned back into plain text: the trigger is
  // how you learn the choice exists at all.
  disabled?: boolean;
}) {
  return (
    <Popover
      disabled={disabled}
      label={label}
      panelClassName="filter-pop cell-pop"
      trigger={<span className="cell-trigger-value">{trigger ?? none()}</span>}
      triggerClassName={chip ? 'cell-trigger cell-trigger-chip' : 'cell-trigger'}
      width={width}
    >
      {(close) => (
        <>
          {/* A nested component so its query state is minted fresh on every
              open: Popover mounts its children lazily, so there is nothing to
              reset and no effect to write. */}
          <CellPickerList
            empty={empty}
            noneLabel={noneLabel}
            onPick={(next) => {
              onPick(next);
              close();
            }}
            options={options}
            label={label}
            searchPlaceholder={searchPlaceholder}
            value={value}
          />
          {footer && <div className="cell-pop-footer">{footer(close)}</div>}
        </>
      )}
    </Popover>
  );
}

function CellPickerList({options, value, onPick, label, searchPlaceholder, noneLabel, empty}: {
  options: CellOption[];
  value: string;
  onPick: (value: string) => void;
  label: string;
  searchPlaceholder: string;
  noneLabel?: string;
  empty?: string;
}) {
  const [query, setQuery] = useState('');
  const searchable = options.length > SEARCH_THRESHOLD;
  const needle = query.trim().toLowerCase();
  const shown = needle ?
    options.filter((option) =>
      (option.searchText || option.label).toLowerCase().includes(needle)) :
    options;

  return (
    <>
      {searchable && (
        <div className="cell-pop-search">
          <Search size={14} strokeWidth={2} />
          <input
            aria-label={searchPlaceholder}
            autoFocus
            onChange={(event) => setQuery(event.target.value)}
            placeholder={searchPlaceholder}
            type="search"
            value={query}
          />
        </div>
      )}
      <div className="filter-pop-list cell-pop-list" role="listbox" aria-label={label}>
        {noneLabel && (
          <FilterOption active={!value} label={noneLabel} onPick={() => onPick('')}>
            <span className="filter-pop-name cell-muted">{noneLabel}</span>
          </FilterOption>
        )}
        {shown.map((option) => (
          <FilterOption
            active={option.value === value}
            key={option.value}
            label={option.label}
            onPick={() => onPick(option.value)}
          >
            {option.render || <span className="filter-pop-name">{option.label}</span>}
            {option.hint && <span className="filter-pop-count">{option.hint}</span>}
          </FilterOption>
        ))}
        {/* Two different silences: an empty library needs telling how to fill
            it, a search that matched nothing only needs saying so. */}
        {shown.length === 0 && !(noneLabel && !needle) && (
          <p className="cell-pop-empty">
            {options.length === 0 ? empty || 'Nothing to pick' : `No match for “${query.trim()}”`}
          </p>
        )}
      </div>
    </>
  );
}

// ── The set of tags ──────────────────────────────────────────────────────────

// Tags, edited where they are read.
//
// A set rather than a value, so it is not a CellPicker: picking one option and
// closing is exactly what this must not do. The panel holds the same TagInput
// the profile dialog uses -- chips with their own remove buttons, a box to type
// a new one, the workspace's most-used tags underneath and the whole catalog
// behind the +. Sharing it is the point: the table and the dialog disagreeing
// about what a tag is, or about the five-tag cap, is the failure worth
// designing out, and normalizeTags stays the single enforcement point either
// way.
//
// Every change is its own write, like every other cell here. Batching until the
// panel closes would mean a dismissal by outside-click or Escape silently
// dropping the edit, and Popover has no close hook to hang a commit on.
export function CellTags({label, tags, options, onChange}: {
  label: string;
  tags: string[];
  options: TagUsage[];
  onChange: (tags: string[]) => void;
}) {
  return (
    <Popover
      label={label}
      panelClassName="filter-pop cell-pop cell-tags-pop"
      trigger={
        <span className="cell-trigger-value">
          {tags.length ?
            <TagCell tags={tags} /> :
            // Not the em dash the other empty cells use. An empty tag set is
            // not a fact about the profile, it is a column waiting to be
            // useful -- the same argument the Notes cell makes.
            <span className="cell-tags-add"><Tag size={13} /> Add tags</span>}
        </span>
      }
      triggerClassName="cell-trigger cell-trigger-chip"
      width={300}
    >
      {/* The same placeholder the dialog's field carries. A cell opened from
          "Add tags" lands on an empty box, and an empty box with no example is
          the version of this control people close again. */}
      <TagInput
        onChange={onChange}
        options={options}
        placeholder="warmup, client-a"
        value={tags}
      />
    </Popover>
  );
}

// ── The value that can be copied ─────────────────────────────────────────────

// A read-only value with a copy glyph that appears on row hover.
//
// The button is absolutely positioned, out of flow, so the column's width never
// depends on whether a row is hovered -- see this file's header. The gutter it
// hangs into is reserved by constant padding on the <td> (.cell-copy-cell), not
// by the button's own box.
export function CellCopy({value, display, title, className = ''}: {
  // The whole string that lands on the clipboard, which is not always what the
  // cell shows -- the Profile ID cell shows eight characters of a uuid and
  // copies all thirty-six.
  value: string;
  display?: ReactNode;
  title?: string;
  className?: string;
}) {
  if (!value) {
    return none();
  }
  return (
    <span className={`cell-copy ${className}`.trim()}>
      <span className="cell-copy-value" title={title ?? value}>{display ?? value}</span>
      {/* Only the button swallows the click, not the cell: the text is still
          part of the row, and a row you cannot click anywhere is a row that
          cannot be selected. */}
      <span className="cell-copy-slot" onClick={(event) => event.stopPropagation()}>
        <CopyButton
          className="icon-button cell-copy-button"
          copiedLabel=""
          label=""
          value={value}
        />
      </span>
    </span>
  );
}

// ── The cell that goes somewhere ─────────────────────────────────────────────

// A value that is a link to the place it belongs: a folder that filters the
// table to itself, a fingerprint field that opens the editor it is set in.
export function CellLink({label, onClick, children}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      className="cell-trigger cell-link"
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      title={label}
      type="button"
    >
      {/* The same wrapper the pickers use, so the hover fill drawn behind it
          paints under the value rather than over it. */}
      <span className="cell-trigger-value">{children}</span>
    </button>
  );
}

// ── The value that can be typed ──────────────────────────────────────────────

// One editable string, in a panel rather than in the cell.
//
// In the cell it would be an <input> whose box changes the row's height and,
// under table-layout: auto, every column's width -- so opening the editor would
// visibly re-lay-out the table. In a panel the row never moves.
export function CellTextEdit({
  label,
  value,
  trigger,
  placeholder,
  validate,
  onSave,
  width = 320,
  allowClear = true,
}: {
  label: string;
  value: string;
  trigger: ReactNode;
  placeholder?: string;
  // The reason this string cannot be saved, or null. Shown under the field
  // rather than swallowed, so a refused save says why.
  validate?: (draft: string) => string | null;
  // '' means clear the field.
  onSave: (next: string) => void;
  width?: number;
  // Off for a field that has no empty state. A profile with no name is a row
  // there is no way to tell from any other, so Name offers no Clear -- and
  // because Clear writes '' straight past `validate`, hiding the button is the
  // only thing that actually stops it.
  allowClear?: boolean;
}) {
  return (
    <Popover
      label={label}
      panelClassName="cell-pop cell-edit-pop"
      trigger={<span className="cell-trigger-value">{trigger ?? none()}</span>}
      triggerClassName="cell-trigger"
      width={width}
    >
      {(close) => (
        // Nested for the same reason CellPickerList is: the draft is seeded
        // from `value` on open, and Popover mounts this lazily.
        <CellTextForm
          allowClear={allowClear}
          label={label}
          onCancel={close}
          onSave={(next) => {
            onSave(next);
            close();
          }}
          placeholder={placeholder}
          validate={validate}
          value={value}
        />
      )}
    </Popover>
  );
}

function CellTextForm({label, value, placeholder, validate, onSave, onCancel, allowClear}: {
  label: string;
  value: string;
  placeholder?: string;
  validate?: (draft: string) => string | null;
  onSave: (next: string) => void;
  onCancel: () => void;
  allowClear: boolean;
}) {
  const [draft, setDraft] = useState(value);
  const trimmed = draft.trim();
  // An empty field is always saveable -- that is how you clear one -- so the
  // validator is only asked about a value that is actually there.
  const problem = trimmed ? validate?.(trimmed) || null : null;
  const dirty = trimmed !== value.trim();

  function save() {
    if (!problem && dirty) {
      onSave(trimmed);
    }
  }

  return (
    <div className="cell-edit">
      <input
        aria-label={label}
        autoFocus
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            save();
          }
        }}
        placeholder={placeholder}
        type="text"
        value={draft}
      />
      {problem && <p className="cell-edit-problem">{problem}</p>}
      <div className="cell-edit-actions">
        <button className="primary" disabled={Boolean(problem) || !dirty} onClick={save} type="button">
          Save
        </button>
        <button className="ghost" onClick={onCancel} type="button">Dismiss</button>
        {/* Both act on the STORED value, not the draft: they are here to do
            something with the field as it stands, and offering to copy an
            unsaved edit would copy something no profile has. */}
        {value && <CopyButton className="ghost" value={value} />}
        {value && allowClear && (
          <button className="danger ghost" onClick={() => onSave('')} type="button">Clear</button>
        )}
      </div>
    </div>
  );
}
