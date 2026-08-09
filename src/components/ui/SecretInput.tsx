// A password input with its own reveal toggle.
//
// type="text" under the toggle rather than always-password: the value is pasted
// once and read back only to compare against the credential in hand, and a
// permanently hidden field makes the one check that matters impossible.
//
// Lived inside ConnectorModal until a `secret` automation parameter needed the
// same control. Two copies of a reveal toggle is two places for "is it shown?"
// to be answered differently, so it moved here rather than being duplicated;
// the `.connector-secret-input` class came with it, because the styling is the
// control's and renaming it would only churn the stylesheet.
import {useState} from 'react';
import {Eye, EyeOff} from 'lucide-react';

export function SecretInput({value, placeholder, onChange}: {
  value: string;
  placeholder?: string;
  onChange: (next: string) => void;
}) {
  const [shown, setShown] = useState(false);
  return (
    <div className="connector-secret-input">
      <input
        type={shown ? 'text' : 'password'}
        value={value}
        placeholder={placeholder}
        autoComplete="off"
        onChange={(event) => onChange(event.target.value)}
      />
      <button
        aria-label={shown ? 'Hide value' : 'Show value'}
        className="ghost icon-button"
        onClick={() => setShown((current) => !current)}
        title={shown ? 'Hide value' : 'Show value'}
        type="button"
      >
        {shown ? <EyeOff size={14} /> : <Eye size={14} />}
      </button>
    </div>
  );
}
