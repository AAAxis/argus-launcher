// The catalog, as a panel hanging off the suggestion row.
//
// Same Popover-with-a-listbox shape as StatusPicker. The user's own tags come
// first -- they are the ones this workspace actually runs on, and the brands
// below them are only a starting vocabulary.
//
// Rows here, not the coloured chips the field and the table use. Twenty-one
// tinted pills stacked in a 260px panel is a paint chart: every row shouts a
// different colour, and the one thing a list needs -- a steady left edge and an
// even rhythm so the eye can run down it -- is the first thing lost. The mark
// already says which brand a row is; the tone is what the tag becomes once it
// is on a profile.
import {Check, Hash} from 'lucide-react';
import {Popover} from './Popover';
import {TagMark} from './TagChip';
import {TAG_PRESETS} from '../../data/tagPresets';
import {tagKey, tagLabel, tagPresetFor} from '../../lib/tags';
import type {ReactNode} from 'react';
import type {TagUsage} from '../../lib/tags';

export function TagPicker({value, options, max, trigger, onChange}: {
  value: string[];
  // Every tag in use across the workspace, from useWorkspace().tagOptions. The
  // "Your tags" group is the half of it the catalog does not know about.
  options: TagUsage[];
  max: number;
  trigger: ReactNode;
  onChange: (tags: string[]) => void;
}) {
  const applied = new Set(value.map(tagKey));
  const full = value.length >= max;
  const own = options.filter((option) => !option.preset);

  function toggle(tag: string) {
    const key = tagKey(tag);
    if (applied.has(key)) {
      onChange(value.filter((item) => tagKey(item) !== key));
      return;
    }
    if (full) {
      return;
    }
    onChange([...value, tag]);
  }

  return (
    <Popover
      label="All tags"
      panelClassName="tag-pop"
      trigger={trigger}
      triggerClassName="tag-suggest-chip tag-suggest-more"
      width={260}
    >
      {() => (
        <>
          {/* One scroll container around both groups rather than one per
            * group: two independent scrollbars in a 260px panel means half the
            * list is reachable and half is not, depending on where the pointer
            * happens to be. */}
          <div className="tag-pop-scroll">
            {own.length > 0 && (
              <TagGroup
                heading="Your tags"
                tags={own.map((option) => option.tag)}
                applied={applied}
                full={full}
                onToggle={toggle}
              />
            )}
            <TagGroup
              heading="Social networks"
              tags={TAG_PRESETS.map((preset) => preset.slug)}
              applied={applied}
              full={full}
              onToggle={toggle}
            />
          </div>
          {/* Outside the scroller, so the reason half the list went grey does
            * not itself have to be scrolled to. */}
          {full && <p className="tag-pop-note">{max} tags is the limit. Remove one to add another.</p>}
        </>
      )}
    </Popover>
  );
}

function TagGroup({heading, tags, applied, full, onToggle}: {
  heading: string;
  tags: string[];
  applied: Set<string>;
  full: boolean;
  onToggle: (tag: string) => void;
}) {
  return (
    <>
      <p className="tag-pop-heading">{heading}</p>
      <div className="tag-pop-list" role="listbox" aria-label={heading}>
        {tags.map((tag) => {
          const on = applied.has(tagKey(tag));
          const preset = tagPresetFor(tag);
          return (
            <button
              aria-selected={on}
              className={on ? 'tag-pop-option active' : 'tag-pop-option'}
              disabled={full && !on}
              key={tag}
              onClick={() => onToggle(tag)}
              // Same reason as the suggestion chips: keep the press off the
              // text input this panel is anchored beside.
              onMouseDown={(event) => event.preventDefault()}
              role="option"
              type="button"
            >
              <span className="tag-pop-mark">
                {preset ? <TagMark preset={preset} /> : <Hash size={12} strokeWidth={2.5} />}
              </span>
              <span className="tag-pop-name">{tagLabel(tag)}</span>
              {on && <Check size={13} strokeWidth={3} />}
            </button>
          );
        })}
      </div>
    </>
  );
}
