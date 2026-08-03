// Tags as chips instead of one comma-separated line.
//
// The old control was a plain <input> holding "warmup, facebook-cookies", which
// gave no feedback about where one tag ended and the next began, and no way to
// remove the middle one without editing around the commas.
//
// It stays a list of strings at this boundary -- the profile draft still holds
// the joined string, so tagsFromDraft() and profileFromDraft() are untouched.
import {useState} from 'react';
import {X} from 'lucide-react';

export function TagInput({value, onChange, placeholder}: {
  value: string[];
  onChange: (tags: string[]) => void;
  placeholder?: string;
}) {
  const [text, setText] = useState('');

  function commit(raw: string) {
    const tag = raw.trim().replace(/,+$/, '').trim();
    setText('');
    // Silently ignoring a duplicate rather than warning: retyping a tag the
    // profile already has is a no-op the user meant, not a mistake.
    if (!tag || value.includes(tag)) {
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
    <div className="tag-input">
      {value.map((tag) => (
        <span className="tag-chip" key={tag}>
          {tag}
          <button
            aria-label={`Remove ${tag}`}
            onClick={() => onChange(value.filter((item) => item !== tag))}
            type="button"
          >
            <X size={12} strokeWidth={2.5} />
          </button>
        </span>
      ))}
      <input
        // Committed on blur as well as on Enter: a tag typed and then left by
        // clicking Save would otherwise be dropped without a word.
        onBlur={() => commit(text)}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={onKeyDown}
        placeholder={value.length ? '' : placeholder}
        value={text}
      />
    </div>
  );
}
