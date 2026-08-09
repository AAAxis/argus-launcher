// The little "i" beside a field label, explaining what the field expects.
//
// Some of these explanations are two sentences and a worked example -- as
// .field-hint text under the control they pushed the form around and were read
// once and then ignored. Behind an "i" they are there when wanted and out of
// the way otherwise.
import {Info} from 'lucide-react';
import {Popover} from './Popover';
import type {ReactNode} from 'react';

export function InfoHint({label, width = 300, children}: {
  // Names the field this explains, so the trigger reads as "About cookie
  // import" rather than an unlabelled icon repeated a dozen times down a form.
  label: string;
  // 300 suits the one- and two-sentence explanations these mostly are. A
  // longer one -- the parameters card explains a whole feature, not a field --
  // reads as a narrow column of six lines at that width, so it may ask for
  // more. Widen the panel rather than cutting the explanation short.
  width?: number;
  children: ReactNode;
}) {
  return (
    <Popover
      label={`About ${label.toLowerCase()}`}
      panelClassName="info-pop"
      trigger={<Info size={14} />}
      triggerClassName="info-hint-trigger"
      width={width}
    >
      {children}
    </Popover>
  );
}
