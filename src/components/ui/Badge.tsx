// A small labelled pill, in the app's five status tones.
//
// This exists because the Automations tab reached for `.status-pill` and got
// something else entirely: that class was the Integrations tab's connection
// indicator -- unconditionally --success green, with no background, no border
// and no radius despite the name. Three "badges" on every automation card
// rendered as three runs of bold green text jammed together.
//
// The real pill was already here as `.status-chip`, so this borrows its rule
// rather than adding a parallel set of colours. StatusChip stays the component
// for a profile's status specifically; Badge is the same shape for anything
// else that needs a labelled tone. Integrations and Extensions have since moved
// onto it too, and `.status-pill` is gone.
import type {ReactNode} from 'react';

// The tones are the ones styles.css already defines bg/border/ink triples for.
// Light tints die on the dark theme's charcoal, which is why each is three
// tokens rather than one hue with opacity -- see the note above .status-chip.
//
// The first five are the profile statuses. 'info' is the blue that was added
// for this component: a fact the app checked and is reporting (a tool found on
// this machine), as opposed to a state something is in.
export type BadgeTone = 'neutral' | 'active' | 'warmup' | 'ban' | 'review' | 'info';

export function Badge({tone = 'neutral', icon, title, children}: {
  tone?: BadgeTone;
  // A lucide glyph, sized to about 12px by the caller. Takes the place of
  // StatusChip's dot; a badge with neither gets even padding instead.
  icon?: ReactNode;
  title?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={`status-chip status-${tone}${icon ? '' : ' is-plain'}`}
      title={title}
    >
      {icon}
      {children}
    </span>
  );
}
