// An automation's card mark: the default workflow glyph, or one brand from the
// shared catalog. Same radiogroup shape as IconPicker and ColorPicker, so the
// "pick one of N" controls in the app's dialogs behave identically under the
// keyboard.
//
// Brands only, no upload -- the catalog is what lets an agent over MCP set an
// icon by name ('brand:facebook') and what keeps every card mark theme-safe.
// The list is TAG_PRESETS, the same catalog the Tags column and the profile
// avatar draw from, so a brand exists here exactly when it exists there.
import {Workflow} from 'lucide-react';
import {TagMark} from './TagChip';
import {TAG_PRESETS} from '../../data/tagPresets';
import {brandAvatar, parseAvatar} from '../../lib/profileAvatar';

export function BrandIconPicker({value, onChange, label = 'Icon'}: {
  // The stored tagged string ('brand:<slug>') or empty for the default glyph.
  value: string;
  onChange: (icon: string) => void;
  label?: string;
}) {
  const parsed = parseAvatar(value);
  const activeSlug = parsed?.kind === 'brand' ? parsed.preset.slug : '';

  return (
    <div className="icon-choices" role="radiogroup" aria-label={label}>
      <button
        aria-checked={!activeSlug}
        aria-label="Default"
        className={activeSlug ? 'icon-choice' : 'icon-choice active'}
        onClick={() => onChange('')}
        role="radio"
        title="Default"
        type="button"
      >
        <Workflow size={17} strokeWidth={1.75} />
      </button>
      {TAG_PRESETS.map((preset) => {
        const active = preset.slug === activeSlug;
        return (
          <button
            aria-checked={active}
            aria-label={preset.label}
            className={active ? 'icon-choice active' : 'icon-choice'}
            key={preset.slug}
            onClick={() => onChange(brandAvatar(preset.slug))}
            role="radio"
            title={preset.label}
            type="button"
          >
            <TagMark preset={preset} size={16} />
          </button>
        );
      })}
    </div>
  );
}
