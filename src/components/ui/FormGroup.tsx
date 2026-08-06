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
import type {ReactNode} from 'react';

export function FormGroup({title, hint, info, children}: {
  title: string;
  // Not optional. A section whose purpose cannot be said in a line is a section
  // that has been drawn around the wrong fields -- which is how the ungrouped
  // version of this form came to be ungrouped.
  hint: string;
  // An InfoHint beside the title, for a section whose caveats do not fit in the
  // line above -- where the cookies go, and what "plaintext" means. Same slot
  // Field.info fills for a single field.
  info?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="form-group">
      <div className="form-group-head">
        <h4>{title}{info}</h4>
        <p>{hint}</p>
      </div>
      {children}
    </section>
  );
}
