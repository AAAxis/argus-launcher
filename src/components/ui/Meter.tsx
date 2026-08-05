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
// `compact` lays the numbers beside the track instead of above it. The stacked
// form is right in Settings, where a meter owns a row and vertical space is
// free. In a toolbar it is not: it makes a two-line block standing next to
// one-line controls, so the numbers ride above the track and nothing in the row
// shares a centre line with the button the meter exists to qualify.
export function Meter({used, limit, compact}: {
  used: number;
  limit: number | null;
  compact?: boolean;
}) {
  const className = compact ? 'settings-meter is-compact' : 'settings-meter';
  if (limit === null) {
    return (
      <div className={className}>
        <strong>{used}</strong>
        <span>of unlimited</span>
      </div>
    );
  }
  if (limit <= 0) {
    return (
      <div className={className}>
        <strong>{used}</strong>
        <span>not included on this plan</span>
      </div>
    );
  }
  const percent = Math.min(100, Math.round((used / limit) * 100));
  return (
    <div className={className}>
      <div className="settings-meter-numbers">
        <strong>{used}</strong>
        <span>of {limit}</span>
      </div>
      <div className="settings-meter-track" aria-hidden="true">
        <span className={percent >= 100 ? 'full' : ''} style={{width: `${percent}%`}} />
      </div>
    </div>
  );
}
