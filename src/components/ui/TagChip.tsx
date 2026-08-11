// A tag, drawn. One component so the editor, the table and the folder
// suggestions cannot disagree about what a tag looks like -- the same reason
// StatusChip is shared by the table and the profile dialog.
//
// A catalogued tag takes its brand mark and one of the six --profile-* token
// triples; anything else is the user's own word and stays neutral, because
// inventing a colour for it would say something the user did not.
import {Hash, X} from 'lucide-react';
import {profileColorStyle} from '../../lib/profileColors';
import {tagLabel, tagPresetFor} from '../../lib/tags';
import type {CSSProperties} from 'react';
import type {TagPresetWithLogo, TagTone} from '../../data/tagPresets';

// The chip's fill, border and ink. Five of the six tones defer to
// profileColorStyle, which already resolves a key to the right triple for the
// current theme. 'ink' is the app's accent pair instead -- the darkest chip the
// light theme can draw, and it inverts with the theme like everything else.
function toneStyle(tone: TagTone): CSSProperties {
  if (tone === 'ink') {
    return {
      background: 'var(--accent)',
      borderColor: 'var(--accent)',
      color: 'var(--accent-ink)',
    };
  }
  return profileColorStyle(tone);
}

// Marks the one chip whose fill runs *opposite* to the page.
//
// The five colour tones are tints: pale in the light theme, deep in the dark
// one -- the same direction as the surface behind them, so a brand mark that
// reads on the page reads on the chip. 'ink' is --accent, which is the darkest
// thing the light theme draws and the lightest thing the dark theme draws. A
// single-colour mark on it therefore needs the opposite lightness flip to the
// one it needs anywhere else, and CSS cannot see the tone because it arrives as
// an inline style. Hence the class -- see .tag-on-ink in styles.css.
function onInk(tone: TagTone): string {
  return tone === 'ink' ? ' tag-on-ink' : '';
}

// The brand mark, in the brand's own colours, through <img> -- the route
// IntegrationMark and the Windows/Ubuntu platform marks already take. Sized by
// height with the width left to the artwork, because these are not all square:
// eBay and Amazon are wordmarks and YouTube is 256x180, and forcing them into a
// box would either squash them or crop them. max-width stops a wordmark from
// making its chip twice as wide as its neighbours'.
//
// Falls back to the preset's lucide glyph while assets/brands/<slug>.svg is
// missing, which is what lets the catalog name a brand before the file exists.
export function TagMark({preset, size = 14}: {preset: TagPresetWithLogo; size?: number}) {
  if (!preset.logo) {
    const Fallback = preset.fallback;
    return <Fallback size={size - 2} strokeWidth={2.25} />;
  }
  return (
    <img
      alt=""
      className={preset.adapt ? `tag-logo ${preset.adapt}` : 'tag-logo'}
      src={preset.logo}
      style={{height: size, maxWidth: size * 1.9}}
    />
  );
}

export function TagChip({tag, count, onRemove}: {
  tag: string;
  // Shown by the folder suggestions, which need "Instagram 12" rather than
  // "Instagram" to be worth clicking.
  count?: number;
  onRemove?: () => void;
}) {
  const preset = tagPresetFor(tag);
  const label = preset?.label || tag;
  return (
    <span
      className={preset ? `tag-chip tag-chip-preset${onInk(preset.tone)}` : 'tag-chip'}
      style={preset ? toneStyle(preset.tone) : undefined}
      title={label}
    >
      {preset ? <TagMark preset={preset} /> : <Hash size={12} strokeWidth={2.5} />}
      <span className="tag-chip-label">{label}</span>
      {count !== undefined && <em className="tag-chip-count">{count}</em>}
      {onRemove && (
        <button aria-label={`Remove ${label}`} onClick={onRemove} type="button">
          <X size={12} strokeWidth={2.5} />
        </button>
      )}
    </span>
  );
}

// The same tag with the word dropped -- just the mark, or the first letter for
// a tag the catalog does not know.
//
// For the profiles table, where a row carrying four tags spent more width on
// them than on the profile's name and pushed Launch off the edge of a laptop
// screen. A single tag still gets its full chip there: one word costs nothing
// and is easier to read than a glyph you have to hover. The name is on the
// title either way.
export function TagBadge({tag}: {tag: string}) {
  const preset = tagPresetFor(tag);
  const label = tagLabel(tag);
  return (
    <span
      className={preset ? `tag-badge tag-badge-preset${onInk(preset.tone)}` : 'tag-badge'}
      style={preset ? toneStyle(preset.tone) : undefined}
      title={label}
    >
      {preset ?
        <TagMark preset={preset} size={13} /> :
        // Upper-cased rather than shown as typed: a column of badges reading
        // "c w I" is a stutter, and the tag's own casing is one hover away.
        <b>{label.trim().charAt(0).toUpperCase()}</b>}
    </span>
  );
}

// A whole table cell's worth: one tag reads as a word, several read as marks.
//
// Five full chips in a table cell take more width than the row's own name and
// push the action buttons off the right of a laptop screen. Dropping to marks
// keeps a tagged row scannable at a glance -- which is the whole point of the
// column -- and the names are on the badges' titles and in the editor. A row
// with a single tag keeps the word, because one of them costs nothing.
//
// Lives here rather than in a tab so the profiles table and the cookie-sets
// table cannot drift apart on the one thing they most obviously share.
export function TagCell({tags}: {tags?: string[]}) {
  if (!tags?.length) {
    return <>-</>;
  }
  if (tags.length === 1) {
    return <span className="tag-cell"><TagChip tag={tags[0]} /></span>;
  }
  return (
    <span className="tag-cell" title={tags.map(tagLabel).join(', ')}>
      {tags.map((tag) => <TagBadge key={tag} tag={tag} />)}
    </span>
  );
}
