// A used-of-limit bar. "3 of 10", with the track filled to match.
//
// Lifted out of settings/sections/PlanUsageSection.tsx when the Team tab needed
// exactly the same control for seats. Both of the distinctions below were
// learned there and would have had to be re-learned here:
//
//   - A null limit is unlimited. There is no denominator, so there is no bar --
//     drawing a full one would read as "at your limit", the opposite of what it
//     means.
//   - Zero is NOT unlimited. `limit <= 0` used to take the null branch, so an
//     org whose plan included no automations read "0 of unlimited" on the one
//     screen that exists to explain what the plan includes.
//
// The styles stay `.settings-meter*` in styles.css rather than being renamed:
// the class names are load-bearing in a 6,900-line stylesheet and the component
// moving does not make them wrong.
import type {ReactNode} from 'react';

// `label` names the thing being measured, on the numbers' own line and hard
// against the far edge from them: "Profiles ....... 0 of 5", track underneath.
// It belongs to the meter rather than to the caller because a caller that draws
// its own heading above one gets three stacked rows for a two-row control --
// name, then count, then track -- which is exactly what the Plans strip looked
// like before this existed. Callers that already have a heading (a Settings row
// label, a toolbar) pass nothing and are unchanged.
//
// `compact` lays the numbers beside the track instead of above it. The stacked
// form is right in Settings, where a meter owns a row and vertical space is
// free. In a toolbar it is not: it makes a two-line block standing next to
// one-line controls, so the numbers ride above the track and nothing in the row
// shares a centre line with the button the meter exists to qualify.
export function Meter({used, limit, label, compact}: {
  used: number;
  limit: number | null;
  label?: ReactNode;
  compact?: boolean;
}) {
  const className = [
    'settings-meter',
    compact ? 'is-compact' : '',
    label === undefined ? '' : 'has-label',
  ].filter(Boolean).join(' ');

  if (limit === null) {
    return (
      <div className={className}>
        <Numbers label={label} used={used} of="of unlimited" />
      </div>
    );
  }
  if (limit <= 0) {
    return (
      <div className={className}>
        <Numbers label={label} used={used} of="not included on this plan" />
      </div>
    );
  }
  const percent = Math.min(100, Math.round((used / limit) * 100));
  return (
    <div className={className}>
      <Numbers label={label} used={used} of={`of ${limit}`} />
      <div className="settings-meter-track" aria-hidden="true">
        <span className={percent >= 100 ? 'full' : ''} style={{width: `${percent}%`}} />
      </div>
    </div>
  );
}

// The one line every branch has. It is shared rather than inlined three times
// so the trackless branches keep the same shape as the one with a track: the
// unlimited case used to return a bare strong and span into a column flexbox,
// which stacked "0" above "of unlimited" for no reason anybody chose.
function Numbers({label, used, of}: {label?: ReactNode; used: number; of: string}) {
  return (
    <div className="settings-meter-numbers">
      {label !== undefined && <span className="settings-meter-label">{label}</span>}
      <strong>{used}</strong>
      <span>{of}</span>
    </div>
  );
}
