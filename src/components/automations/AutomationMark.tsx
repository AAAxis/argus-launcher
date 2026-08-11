// One automation's identity mark, drawn the same way on the grid card and in
// the editor's header.
//
// Two mutually exclusive shapes, which is the whole reason this is a component
// and not two copies of a ternary:
//
//   A brand logo is already a colour. It gets the box and nothing else -- no
//   plate, no hairline, no tint -- so Instagram reads as Instagram rather than
//   as an Instagram sticker on a violet chip. ProfileAvatar reached the same
//   conclusion for profiles and puts it better: a full-colour mark on a tinted
//   plate is two colours arguing.
//
//   The default glyph is line art with nothing of its own to say, so it keeps
//   the plate and takes the automation's colour. That tint is what makes a
//   grid of otherwise identical Workflow glyphs navigable at a glance.
//
// The colour is not wasted on the brand path. AutomationsTab moves it to the
// card's frame instead, so picking a colour always does something visible --
// see automationFrameStyle below.
import {Workflow} from 'lucide-react';
import {parseAvatar} from '../../lib/profileAvatar';
import {isCustomHex, profileColorStyle} from '../../lib/profileColors';
import {TagMark} from '../ui/TagChip';
import type {CSSProperties} from 'react';

// The glyph's share of the box: 20 in 34, the ratio the card has drawn since
// it existed. Kept as a ratio rather than a second constant so the header's
// smaller mark is the same drawing scaled, not a number someone picked twice.
const GLYPH_RATIO = 20 / 34;

export function AutomationMark({icon, color, size = 34}: {
  icon?: string | null;
  color?: string | null;
  size?: number;
}) {
  // .extension-mark fixes 34px in CSS, which is right for the grid and wrong
  // for the header, so the box comes inline and the class only shapes.
  const box: CSSProperties = {height: size, width: size};
  const avatar = parseAvatar(icon);

  if (avatar?.kind === 'brand') {
    // size, not size - 2: the logo IS the mark here, so it fills the box.
    // TagMark's inline maxWidth (size * 1.9, for wordmarks) would spill past
    // that; .extension-mark.is-brand .tag-logo caps it back to the box and
    // lets object-fit letterbox the wide cuts.
    return (
      <span aria-hidden="true" className="extension-mark is-brand" style={box}>
        <TagMark preset={avatar.preset} size={size} />
      </span>
    );
  }

  // 'image' parses but never reaches here from an automation -- the icon
  // grammar the local API accepts is brand: only -- and it falls through to
  // the default glyph exactly as it did before this component existed.
  const plate = color ? profileColorStyle(color) : undefined;
  return (
    <span
      aria-hidden="true"
      className={plate ? 'extension-mark automation-mark' : 'extension-mark is-fallback'}
      style={plate ? {...box, ...plate} : box}
    >
      <Workflow size={Math.round(size * GLYPH_RATIO)} strokeWidth={1.75} />
    </span>
  );
}

// Where the colour goes when the mark will not take it.
//
// The frame's fill, and only the frame's: it is the surround the card sits in,
// so washing it identifies the automation without putting a second colour
// anywhere near the logo. Applied whether or not there is a brand mark, so the
// two paths agree about what the colour means.
//
// This was the frame's border-color until the frame stopped having a border.
// A fill is the better home for it anyway -- a hairline is the one part of a
// card nothing else is measured against, so it carried the colour where it was
// least likely to be noticed.
export function automationFrameStyle(color?: string | null): CSSProperties | undefined {
  if (!color) {
    return undefined;
  }
  // The mix happens here rather than in the stylesheet because the two kinds of
  // colour arrive at wildly different strengths and one rule cannot serve both:
  // the six presets are already pale plates (--profile-violet-bg is #f0edfc in
  // light, #221c33 in dark), while a custom colour is whatever fully saturated
  // hex the user picked out of the swatch. Most of a pale plate reads as a
  // tint; most of a saturated hex reads as a mistake.
  const {background} = profileColorStyle(color);
  const strength = isCustomHex(color) ? 14 : 55;
  return {background: `color-mix(in srgb, ${background} ${strength}%, var(--frame))`};
}
