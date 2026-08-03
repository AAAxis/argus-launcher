// A folder's icon, as a grid of choices.
//
// Same radiogroup shape as ColorPicker and PlatformPicker, so the three
// "pick one of N" controls in the profile and folder dialogs behave identically
// under the keyboard and read identically when selected.
import {FOLDER_ICONS} from '../../data/folderIcons';

export function IconPicker({value, onChange, label = 'Folder icon'}: {
  value: string;
  onChange: (key: string) => void;
  label?: string;
}) {
  return (
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
  );
}
