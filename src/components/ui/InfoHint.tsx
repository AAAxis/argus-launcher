// The little "i" beside a field label, explaining what the field expects.
//
// Some of these explanations are two sentences and a worked example -- as
// .field-hint text under the control they pushed the form around and were read
// once and then ignored. Behind an "i" they are there when wanted and out of
// the way otherwise.
import {Info} from 'lucide-react';
import {Popover} from './Popover';
import type {ReactNode} from 'react';

export function InfoHint({label, children}: {
  // Names the field this explains, so the trigger reads as "About cookie
  // import" rather than an unlabelled icon repeated a dozen times down a form.
  label: string;
  children: ReactNode;
}) {
  return (
    <Popover
      label={`About ${label.toLowerCase()}`}
      panelClassName="info-pop"
      trigger={<Info size={14} />}
      triggerClassName="info-hint-trigger"
      width={300}
    >
      {children}
    </Popover>
  );
}
