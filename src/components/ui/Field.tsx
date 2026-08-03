// A labelled form control: the `<label class="field"><span>…</span>{control}`
// shape every dialog in this app already used, with an icon slot and a hint.
//
// It adds no styling of its own -- the canonical input/select/textarea rules
// near the top of styles.css still do all the work. What it centralizes is the
// three things that were being retyped and drifting: the .wide modifier, where
// the hint paragraph goes, and now the label icon.
//
// The raw markup still works everywhere it is used today; this is a place to
// migrate to, not a rewrite the other dialogs are blocked on.
import type {ReactNode} from 'react';

export function Field({label, icon, hint, wide, compact, group, children}: {
  label: ReactNode;
  // A lucide glyph or a platform mark, sized 14. Sits inside the label, so it
  // takes the label's --ink-soft rather than needing a colour of its own.
  icon?: ReactNode;
  // Explanatory line under the control. Not a placeholder: it stays visible
  // once the field has a value, which is the whole point of it.
  hint?: ReactNode;
  wide?: boolean;
  compact?: boolean;
  // True when the control is a radiogroup of buttons rather than one input.
  // Wrapping those in a <label> would make every card also fire the label's
  // implicit activation of the first control inside it, so they get a
  // <div role="group"> with the same visual shape instead.
  group?: boolean;
  children: ReactNode;
}) {
  const className = ['field', wide ? 'wide' : '', compact ? 'compact' : ''].filter(Boolean).join(' ');
  const content = (
    <>
      <span>{icon}{label}</span>
      {children}
      {hint && <p className="field-hint">{hint}</p>}
    </>
  );

  if (group) {
    return <div className={className} role="group" aria-label={typeof label === 'string' ? label : undefined}>{content}</div>;
  }
  return <label className={className}>{content}</label>;
}
