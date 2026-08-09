// One titled block of a form: a heading, a line saying what the block is for,
// and the two-column field grid the rest of the app uses.
//
// This was `FpGroup`, local to FingerprintFields, where it did the same job for
// the three fingerprint blocks. It moved here when the profile editor grew
// sections of its own: a dialog of seventeen fields in one undifferentiated run
// gives no answer to "where do I change the proxy", and the pattern that fixes
// that already existed one file over.
//
// The heading is deliberately quiet -- 13px/800, not an h3 -- because these
// head a block inside a dialog that already carries a title, so they are
// subordinate to it rather than peers of it. Spans its host `.profile-form`
// grid, so groups stack rather than sitting side by side.
//
// A group is two objects, not one box: a frame carrying the heading, and the
// field grid inset in it. That is the automations grid's card drawn at form
// scale (.automation-card-framed / .automation-card-body), and it is here for
// the same reason it is there -- what the app says ABOUT a block sits outside
// the block, so the sections read as sections at a glance instead of as one
// undifferentiated run of boxes. See styles/controls/form-groups.css.
import type {ReactNode} from 'react';

export function FormGroup({title, icon, hint, info, id, children}: {
  title: string;
  // A lucide glyph sized 14, on the heading's line. Same size and the same
  // --ink-soft the field labels' icons take, so a section's mark and its
  // fields' marks are one family rather than two.
  icon?: ReactNode;
  // Not optional. A section whose purpose cannot be said in a line is a section
  // that has been drawn around the wrong fields -- which is how the ungrouped
  // version of this form came to be ungrouped.
  hint: string;
  // An InfoHint beside the title, for a section whose caveats do not fit in the
  // line above -- where the cookies go, and what "plaintext" means. Same slot
  // Field.info fills for a single field.
  info?: ReactNode;
  // A scroll target, for a caller that needs to send the reader back to this
  // block -- the profile summary's per-group Edit does exactly that.
  id?: string;
  children: ReactNode;
}) {
  return (
    <section className="form-group" id={id}>
      <div className="form-group-head">
        <h4>{icon}{title}{info}</h4>
        <p>{hint}</p>
      </div>
      {/* The fields' own surface. The frame above is the section's chrome and
          draws no border of its own; this is the card inside it. */}
      <div className="form-group-body">{children}</div>
    </section>
  );
}
