// A folder's icon in its colour.
//
// The colour goes on the glyph rather than on the whole card: the folder row is
// navigation, and six filled cards side by side read as six buttons demanding
// attention instead of as a place to click. Tinting the mark is enough to tell
// them apart at a glance and leaves the row quiet.
//
// Shared by the folder row, the profiles table's Folder column and the move
// dialog, so a folder cannot be one colour in one place and another elsewhere.
import {flagCodeFromIcon, folderIcon} from '../../data/folderIcons';
import {profileColorStyle} from '../../lib/profileColors';
import {FlagIcon} from './icons';

export function FolderGlyph({icon, color, size = 17, small}: {
  icon?: string | null;
  // Undefined for folders saved before colours existed. They keep the plain
  // ink glyph rather than being assigned a colour nobody chose.
  color?: string | null;
  size?: number;
  small?: boolean;
}) {
  const base = small ? 'folder-glyph small' : 'folder-glyph';
  // A flag folder ignores the colour. The mark already carries two or three of
  // its own, and painting a red plate behind 🇫🇷 reads as a broken swatch
  // rather than as a tint -- the colour picker stays in the dialog because it
  // still applies the moment the icon is switched back to a glyph.
  const flag = flagCodeFromIcon(icon);
  if (flag) {
    return (
      <span className={`${base} flag`}>
        <FlagIcon countryCode={flag} />
      </span>
    );
  }
  const Icon = folderIcon(icon);
  return (
    <span className={base} style={color ? profileColorStyle(color) : undefined}>
      <Icon size={size} strokeWidth={1.75} />
    </span>
  );
}
