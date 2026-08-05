// The profile editor's Avatar control: a preview, and the two ways to fill it.
//
// Sits directly above the Colour picker because the two answer the same
// question -- how do I find this row again -- and setting one usually means not
// caring about the other. Colour stays the fallback rather than being replaced:
// a profile with no picture and no brand is still an initials plate, and that
// is what most profiles will always be.
//
// Two sources rather than one, because the two kinds of user asking for this
// want different things. Someone running five Instagram accounts wants the
// account's own photo, so they can tell those five apart; someone running fifty
// accounts across eight sites wants the site's mark, so they can tell the eight
// apart at a glance. A picture answers the first and a brand answers the
// second, and neither substitutes for the other.
//
// The brand list is TAG_PRESETS -- the same catalog the Tags column draws from,
// with the same alias matching -- so a brand exists here exactly when it exists
// there and adding one is still a drop into assets/brands.
import {useRef, useState} from 'react';
import {Check, ImagePlus, Shapes, X} from 'lucide-react';
import {Popover} from './Popover';
import {ProfileAvatar} from './ProfileAvatar';
import {TagMark} from './TagChip';
import {TAG_PRESETS} from '../../data/tagPresets';
import {brandAvatar, parseAvatar} from '../../lib/profileAvatar';

// What the hidden input will accept. No SVG: it is a document the browser will
// execute, and this one is rendered from a URL other members of the org load.
const IMAGE_TYPES = 'image/png,image/jpeg,image/webp,image/gif';

export function AvatarPicker({value, name, color, onChange, onUpload, onError}: {
  value: string;
  // The two inputs the initials fallback needs, so the preview here is the same
  // plate the table will draw rather than an approximation of it.
  name: string;
  color: string;
  onChange: (avatar: string) => void;
  // Returns the public URL of the stored picture. Throws with a sentence worth
  // showing if it could not.
  onUpload: (file: File) => Promise<string>;
  onError: (message: string) => void;
}) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const parsed = parseAvatar(value);
  const activeBrand = parsed?.kind === 'brand' ? parsed.preset.slug : '';

  async function pick(file: File | undefined) {
    if (!file) {
      return;
    }
    setBusy(true);
    try {
      onChange(await onUpload(file));
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
      // Same file twice in a row fires onChange only if the value is cleared --
      // otherwise a failed upload cannot be retried with the file that failed.
      // The same line, for the same reason, is in AccountSection.
      if (fileRef.current) {
        fileRef.current.value = '';
      }
    }
  }

  return (
    <div className="avatar-picker">
      <ProfileAvatar profile={{name, color, avatar: value}} />
      <div className="avatar-picker-actions">
        <input
          accept={IMAGE_TYPES}
          className="visually-hidden"
          onChange={(event) => void pick(event.target.files?.[0])}
          ref={fileRef}
          type="file"
        />
        <button
          className="ghost"
          disabled={busy}
          onClick={() => fileRef.current?.click()}
          type="button"
        >
          <ImagePlus size={14} /> {busy ? 'Uploading…' : 'Upload'}
        </button>

        <Popover
          label="Pick a brand"
          panelClassName="tag-pop"
          trigger={<><Shapes size={14} /> Brand</>}
          triggerClassName="ghost"
          width={260}
        >
          {(close) => (
            // The same rows-in-a-scroller shape TagPicker uses, and for the
            // same reason: twenty-two tinted pills in a 260px panel is a paint
            // chart, and a list needs a steady left edge more than it needs
            // colour. Single-select here -- a profile has one avatar.
            <div className="tag-pop-scroll">
              <p className="tag-pop-heading">Social networks</p>
              <div className="tag-pop-list" role="listbox" aria-label="Social networks">
                {TAG_PRESETS.map((preset) => {
                  const on = preset.slug === activeBrand;
                  return (
                    <button
                      aria-selected={on}
                      className={on ? 'tag-pop-option active' : 'tag-pop-option'}
                      key={preset.slug}
                      onClick={() => {
                        // Clicking the current brand clears it, so the panel is
                        // also the way back to the initials plate.
                        onChange(on ? '' : brandAvatar(preset.slug));
                        close();
                      }}
                      role="option"
                      type="button"
                    >
                      <span className="tag-pop-mark"><TagMark preset={preset} /></span>
                      <span className="tag-pop-name">{preset.label}</span>
                      {on && <Check size={13} strokeWidth={3} />}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </Popover>

        {/* Only once there is something to remove: a permanently visible Remove
          * beside an empty plate is a control for a state that cannot happen. */}
        {parsed && (
          <button className="ghost" onClick={() => onChange('')} type="button">
            <X size={14} /> Remove
          </button>
        )}
      </div>
    </div>
  );
}
