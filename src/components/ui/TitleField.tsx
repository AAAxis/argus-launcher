// The name of the thing being edited, as the dialog's heading.
//
// It was a labelled input in the automation editor's sidebar, below the
// Steps/JSON toggle and above four settings -- so the one thing that identifies
// what you are editing sat fifth in a column of equals, while the header said
// "New automation" no matter what you had typed. Same call as StatusChip: the
// name is the value, the pencil is the way to change it.
//
// Was local to AutomationModal. It moved here when the profile editor took the
// same header: two click-to-rename headings drifting on Escape handling or on
// whether an empty name is allowed through is exactly the failure that having
// one of them prevents.
import {useState} from 'react';
import {Pencil} from 'lucide-react';

export function TitleField({noun, value, onChange}: {
  // What is being renamed, lower case: "automation", "profile". One prop rather
  // than three strings because the three are one sentence in three moods -- the
  // heading's stand-in, the button's name and the input's prompt -- and a
  // caller that could set them separately is a caller that can make them
  // disagree about what it is editing.
  noun: string;
  value: string;
  onChange: (name: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  // Held locally while editing so Escape has something to revert to, and so an
  // empty box mid-retype does not disable Save on every keystroke.
  const [text, setText] = useState(value);

  if (!editing) {
    return (
      <span className="editor-title">
        <span className="editor-title-text">{value.trim() || `Untitled ${noun}`}</span>
        <button
          type="button"
          className="icon-button"
          aria-label={`Rename this ${noun}`}
          title="Rename"
          onClick={() => {
            setText(value);
            setEditing(true);
          }}
        ><Pencil size={14} /></button>
      </span>
    );
  }

  function commit() {
    setEditing(false);
    const next = text.trim();
    // An empty name blocks Save, and silently keeping the old one would hide
    // that the rename did not take. Empty is allowed through and the dialog
    // says why.
    onChange(next);
  }

  return (
    <span className="editor-title">
      <input
        type="text"
        className="editor-title-input"
        autoFocus
        value={text}
        placeholder={`Name this ${noun}`}
        onChange={(event) => setText(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            commit();
          }
          if (event.key === 'Escape') {
            // Stops the dialog closing as well -- Modal listens for Escape.
            event.stopPropagation();
            setText(value);
            setEditing(false);
          }
        }}
      />
    </span>
  );
}
