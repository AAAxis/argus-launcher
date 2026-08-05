// The platform, as a compact dropdown showing its logo.
//
// The import review table used a bare <select> of platform *names*, in a table
// whose every other column had already been given a real control -- a status
// chip, a proxy popover, a check chip. A column of native dropdowns reading
// "Windows 11" was both the widest thing in the row and the only place in the app
// where a platform appeared without its mark, while the Profiles table two clicks
// away showed the same value as a logo alone.
//
// So: the trigger is the logo, the panel is logo + name. Same Popover-and-listbox
// shape as StatusPicker, for the same reason -- the place a value is read and the
// place it is set should not be two different widgets.
//
// Not a replacement for PlatformPicker, which is the six-card radiogroup in the
// profile dialog. That one is a form where the platform is a decision worth
// spelling out; this one is a table cell.
import {Check} from 'lucide-react';
import {Popover} from './Popover';
import {PlatformIcon} from './icons';
import {osPresets} from '../../lib/fingerprintPresets';

// Kept in step with PlatformPicker's own caveat: argus_ua.cc has desktop presets
// only, so a mobile profile ships a mobile user agent while its Client Hints
// still report a desktop platform. Shown in the panel rather than swallowed,
// because this dropdown is now a place someone can pick Android without ever
// opening the dialog that used to warn them.
const MOBILE_CAVEAT = 'User agent only — Client Hints still report a desktop platform.';

export function PlatformSelect({value, onChange, fromFileLabel}: {
  value: string;
  onChange: (os: string) => void;
  // Given by the import table, whose cells have a third state: the row has not
  // been overridden, so whatever the file said stands. Omitted elsewhere, where
  // a platform is always set to something.
  fromFileLabel?: string;
}) {
  const empty = !value;
  const label = empty ? (fromFileLabel || 'Not set') : value;

  return (
    <Popover
      label={`Platform: ${label}`}
      panelClassName="platform-pop"
      triggerClassName="platform-select-trigger"
      width={220}
      trigger={
        <>
          {/* PlatformIcon already falls back to a dimmed monitor glyph for an
              unrecognised or absent value, so the empty state needs no branch. */}
          <PlatformIcon os={value} size={17} />
          {/* The name is not on screen -- the column is a logo column -- but it
              stays in the accessible tree rather than being dropped, so the
              control announces the platform and not just "Platform:" from the
              trigger's label. .visually-hidden is the app's existing utility. */}
          <span className="visually-hidden">{label}</span>
        </>
      }
    >
      {(close) => (
        <div className="platform-pop-list" role="listbox" aria-label="Platform">
          {fromFileLabel && (
            <button
              aria-selected={empty}
              className={empty ? 'platform-pop-option active' : 'platform-pop-option'}
              onClick={() => {
                onChange('');
                close();
              }}
              role="option"
              type="button"
            >
              <PlatformIcon os="" size={17} />
              <span>{fromFileLabel}</span>
              {empty && <Check size={13} strokeWidth={2.5} />}
            </button>
          )}
          {osPresets.map((os) => {
            const active = os === value;
            return (
              <button
                aria-selected={active}
                className={active ? 'platform-pop-option active' : 'platform-pop-option'}
                key={os}
                onClick={() => {
                  onChange(os);
                  close();
                }}
                role="option"
                type="button"
              >
                <PlatformIcon os={os} size={17} />
                <span>{os}</span>
                {active && <Check size={13} strokeWidth={2.5} />}
              </button>
            );
          })}
          {(value === 'Android' || value === 'iOS') && (
            <p className="platform-pop-hint">{MOBILE_CAVEAT}</p>
          )}
        </div>
      )}
    </Popover>
  );
}
