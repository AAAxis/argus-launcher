// A folder's icon, as a grid of choices.
//
// Same radiogroup shape as ColorPicker and PlatformPicker, so the three
// "pick one of N" controls in the profile and folder dialogs behave identically
// under the keyboard and read identically when selected.
//
// Proxy folders get a second group underneath: the country flags. They are a
// searched list rather than a grid of all 250-odd, and the countries this
// workspace actually has proxies in float to the front -- someone running US
// and German proxies should not have to type past Andorra to file them.
import {useMemo, useState} from 'react';
import {Search} from 'lucide-react';
import {countryChoices, flagCodeFromIcon, flagIconKey, FOLDER_ICONS} from '../../data/folderIcons';
import {FlagIcon} from './icons';

export function IconPicker({value, onChange, label = 'Folder icon', preferredCountries}: {
  value: string;
  onChange: (key: string) => void;
  label?: string;
  // ISO codes to list first, in the order given. Undefined hides the country
  // group entirely -- profile folders have no use for it.
  preferredCountries?: string[];
}) {
  return (
    <>
      <div className="icon-choices" role="radiogroup" aria-label={label}>
        {FOLDER_ICONS.map((entry) => {
          const active = entry.key === value;
          return (
            <button
              aria-checked={active}
              aria-label={entry.label}
              className={active ? 'icon-choice active' : 'icon-choice'}
              key={entry.key}
              onClick={() => onChange(entry.key)}
              role="radio"
              title={entry.label}
              type="button"
            >
              <entry.icon size={17} strokeWidth={1.75} />
            </button>
          );
        })}
      </div>
      {preferredCountries && (
        <FlagChoices
          onChange={onChange}
          preferred={preferredCountries}
          value={value}
        />
      )}
    </>
  );
}

// How many flags are shown before the user narrows the list. Enough to cover
// the countries a workspace realistically runs in plus a few, and short enough
// that the folder dialog does not turn into a scrolling atlas.
const FLAG_LIMIT = 24;

function FlagChoices({value, onChange, preferred}: {
  value: string;
  onChange: (key: string) => void;
  preferred: string[];
}) {
  const [search, setSearch] = useState('');
  const selected = flagCodeFromIcon(value);

  // Keyed on the joined codes, not the array: the caller rebuilds it every
  // render, so depending on identity would re-sort 265 countries on every
  // keystroke in the folder's name field.
  const front = [...new Set([...(selected ? [selected] : []), ...preferred])].join(',');
  const ordered = useMemo(() => {
    // The currently selected flag is pinned alongside the preferred ones, or
    // reopening the dialog on a folder whose country is not in the first two
    // dozen would show the picker with nothing marked.
    const rank = new Map(front.split(',').map((code, index) => [code, index]));
    return [...countryChoices()].sort((left, right) =>
      (rank.get(left.code) ?? Number.MAX_SAFE_INTEGER) -
      (rank.get(right.code) ?? Number.MAX_SAFE_INTEGER));
  }, [front]);

  const query = search.trim().toLowerCase();
  const matches = query ?
    ordered.filter((entry) =>
      entry.name.toLowerCase().includes(query) || entry.code.toLowerCase() === query) :
    ordered;
  const shown = matches.slice(0, FLAG_LIMIT);

  return (
    <div className="flag-choices">
      <label className="flag-search">
        <Search size={14} />
        <input
          type="text"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Or search for a country"
        />
      </label>
      <div className="icon-choices" role="radiogroup" aria-label="Country flag">
        {shown.map((entry) => {
          const key = flagIconKey(entry.code);
          const active = key === value;
          return (
            <button
              aria-checked={active}
              aria-label={entry.name}
              className={active ? 'icon-choice flag active' : 'icon-choice flag'}
              key={entry.code}
              onClick={() => onChange(key)}
              role="radio"
              title={entry.name}
              type="button"
            >
              <FlagIcon countryCode={entry.code} />
            </button>
          );
        })}
      </div>
      {shown.length === 0 && (
        <p className="flag-choices-note">No country matches “{search.trim()}”.</p>
      )}
      {/* Silence about the cut-off would read as "these are all the countries
        * there are", and someone looking for Uruguay would give up. */}
      {matches.length > shown.length && (
        <p className="flag-choices-note">
          Showing {shown.length} of {matches.length} — keep typing to narrow it down.
        </p>
      )}
    </div>
  );
}
