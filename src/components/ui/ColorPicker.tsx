// The six preset profile colours plus a custom one, as a radiogroup.
//
// Lifted out of the profile dialog, where it was fifteen inline lines with no
// selected-state affordance beyond a 2px border. The swatches are now filled
// with the token pair for the current theme (see lib/profileColors.ts) and the
// selected one carries a check drawn in that colour's own ink, so the state
// survives at a glance on both light and dark surfaces.
import {Check, Pipette} from 'lucide-react';
import {
  customHexFor, isCustomHex, PROFILE_COLORS, profileColorStyle, resolveProfileColor,
} from '../../lib/profileColors';

export function ColorPicker({value, onChange}: {
  value: string;
  onChange: (color: string) => void;
}) {
  const custom = isCustomHex(value) && !resolveProfileColor(value);

  return (
    <div className="color-row" role="radiogroup" aria-label="Profile colour">
      {PROFILE_COLORS.map((color) => {
        const active = resolveProfileColor(value) === color.key;
        return (
          <button
            aria-checked={active}
            aria-label={color.label}
            className={active ? 'swatch active' : 'swatch'}
            key={color.key}
            onClick={() => onChange(color.key)}
            role="radio"
            style={profileColorStyle(color.key)}
            title={color.label}
            type="button"
          >
            {active && <Check size={14} strokeWidth={3} />}
          </button>
        );
      })}

      {/* The escape hatch. Wrapped in a label so the whole chip opens the OS
        * colour panel -- a bare <input type="color"> is a 42px box the user has
        * to hit exactly, and it gives no hint that it is the "something else"
        * option rather than a seventh preset. */}
      <label
        className={custom ? 'swatch swatch-custom active' : 'swatch swatch-custom'}
        style={custom ? profileColorStyle(value) : undefined}
        title="Custom colour"
      >
        {custom ? <Check size={14} strokeWidth={3} /> : <Pipette size={14} />}
        <input
          aria-label="Custom colour"
          onChange={(event) => onChange(event.target.value)}
          type="color"
          value={customHexFor(value)}
        />
      </label>
    </div>
  );
}
