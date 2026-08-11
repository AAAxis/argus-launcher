// Tags as chips instead of one comma-separated line, with the tags this
// workspace actually uses offered underneath.
//
// The old control was a plain <input> holding "warmup, facebook-cookies", which
// gave no feedback about where one tag ended and the next began, and no way to
// remove the middle one without editing around the commas. Typing was also the
// only way in: the catalog existed but you had to know a brand was in it to
// find out it was. The suggestion row is the answer to that -- the handful most
// of this workspace's profiles already carry, one click each, and a + chip for
// the rest of the list.
//
// It stays a list of strings at this boundary -- the profile draft still holds
// the joined string, so tagsFromDraft() and profileFromDraft() are untouched.
import {useState} from 'react';
import {Plus} from 'lucide-react';
import {TagChip} from './TagChip';
import {TagPicker} from './TagPicker';
import {MAX_PROFILE_TAGS, tagKey} from '../../lib/tags';
import {TAG_PRESETS} from '../../data/tagPresets';
import type {TagUsage} from '../../lib/tags';

// Enough to be worth scanning, few enough to stay on one line beside the +.
const SUGGESTION_LIMIT = 5;

export function TagInput({value, onChange, options = [], max = MAX_PROFILE_TAGS, placeholder}: {
  value: string[];
  onChange: (tags: string[]) => void;
  // Every tag in use across the workspace, from useWorkspace().tagOptions.
  options?: TagUsage[];
  max?: number;
  placeholder?: string;
}) {
  const [text, setText] = useState('');
  const full = value.length >= max;
  const suggestions = suggestedTags(value, options);

  function commit(raw: string) {
    const tag = raw.trim().replace(/,+$/, '').trim();
    setText('');
    // Silently ignoring a duplicate rather than warning: retyping a tag the
    // profile already has is a no-op the user meant, not a mistake. The cap is
    // checked on the same terms -- a tag typed past the limit is dropped here
    // rather than in profileFromDraft, so the user sees it not land.
    if (!tag || full || value.some((item) => tagKey(item) === tagKey(tag))) {
      return;
    }
    onChange([...value, tag]);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter' || event.key === ',') {
      // Enter would otherwise submit the dialog, and a comma would land in the
      // text as a character -- both of them the old separator, now the commit.
      event.preventDefault();
      commit(text);
      return;
    }
    if (event.key === 'Backspace' && !text && value.length) {
      onChange(value.slice(0, -1));
    }
  }

  return (
    <>
      <div className="tag-input">
        {value.map((tag) => (
          <TagChip
            key={tag}
            tag={tag}
            onRemove={() => onChange(value.filter((item) => item !== tag))}
          />
        ))}
        <input
          // Named here rather than by a wrapping <label>: the field is a
          // role="group" so the buttons in it stay clickable, which leaves this
          // input with no label element of its own.
          aria-label="Add a tag"
          // Committed on blur as well as on Enter: a tag typed and then left by
          // clicking Save would otherwise be dropped without a word.
          disabled={full}
          onBlur={() => commit(text)}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder={value.length ? '' : placeholder}
          value={text}
        />
        {/* The count only appears once it means something. Shown at the cap
          * whatever happens, because that is when the input goes dead and the
          * reason has to be visible next to it. */}
        {(full || value.length > 0) && (
          <span className={full ? 'tag-count full' : 'tag-count'}>{value.length} of {max}</span>
        )}
      </div>

      {/* Hidden at the cap rather than greyed out: every chip in it would be
        * dead, and a row of dead chips is a worse explanation than the counter
        * above already gives. */}
      {!full && (
        <div className="tag-suggest">
          <span className="tag-suggest-label">Suggested</span>
          {suggestions.map((tag) => (
            <button
              className="tag-suggest-chip"
              key={tag}
              onClick={() => onChange([...value, tag])}
              // Suppressing the default of mousedown, not of the click: it
              // stops the text input beside this from taking a blur (which
              // would run commit() on the way past) and stops the enclosing
              // field from treating the press as a press on that input. The
              // click handler above still fires.
              onMouseDown={(event) => event.preventDefault()}
              type="button"
            >
              <TagChip tag={tag} />
            </button>
          ))}
          <TagPicker
            max={max}
            onChange={onChange}
            options={options}
            trigger={<Plus size={13} strokeWidth={2.5} />}
            value={value}
          />
        </div>
      )}
    </>
  );
}

// What to offer, most used first. The workspace's own tags come before the
// catalog's -- a firm running forty Instagram profiles wants Instagram in the
// first slot, and a fresh install with no history still gets a starting
// vocabulary instead of an empty row.
function suggestedTags(applied: string[], options: TagUsage[]): string[] {
  const taken = new Set(applied.map(tagKey));
  const list: string[] = [];
  const push = (tag: string) => {
    const key = tagKey(tag);
    if (taken.has(key) || list.length >= SUGGESTION_LIMIT) {
      return;
    }
    taken.add(key);
    list.push(tag);
  };
  // Sorted by count here rather than reusing tagsInUse()'s order, which puts
  // the user's own words first for the picker's two groups. This row has no
  // groups, so popularity is the only thing that should decide it.
  [...options].sort((a, b) => b.count - a.count).forEach((option) => push(option.tag));
  TAG_PRESETS.forEach((preset) => push(preset.slug));
  return list;
}
