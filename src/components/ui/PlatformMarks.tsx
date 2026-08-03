// Platform brand marks, inline.
//
// lucide-react has no brand logos, which is why PlatformIcon used to collapse
// Windows 11, Windows 10 and Ubuntu into one <Monitor> and Android and iOS into
// one <Smartphone> -- five of the six presets were visually indistinguishable in
// the profiles table. These fill the gap, on the same 24x24 grid lucide uses so
// they line up with the lucide glyphs beside them.
//
// Only shapes that are exactly describable in primitives live here: rectangles,
// circles and one arc. macOS deliberately keeps lucide's own <Apple> (see
// PlatformIcon) rather than a hand-traced Apple Inc. silhouette -- a logo that
// is a few bezier control points off is worse than an honest stand-in.
//
// Nothing here names a colour: every mark is currentColor, so it takes the ink
// of whatever it sits in and inverts with the theme. Same reasoning as
// GoogleMark in ui/icons.tsx.
import type {SVGProps} from 'react';

type MarkProps = {size?: number} & Omit<SVGProps<SVGSVGElement>, 'width' | 'height'>;

function Mark({size = 16, children, ...rest}: MarkProps) {
  return (
    <svg
      aria-hidden="true"
      fill="currentColor"
      focusable="false"
      height={size}
      viewBox="0 0 24 24"
      width={size}
      xmlns="http://www.w3.org/2000/svg"
      {...rest}
    >
      {children}
    </svg>
  );
}

// The four-pane flag. Windows 11 and Windows 10 share it: downstream they are
// the same `windows` preset and the same `Windows NT 10.0` user agent, so
// drawing two different logos would claim a distinction the browser does not
// make. The version is carried by the label and the tooltip instead.
export function WindowsMark(props: MarkProps) {
  return (
    <Mark {...props}>
      <rect x="3" y="4.4" width="8.4" height="7.1" rx="0.5" />
      <rect x="12.6" y="3" width="8.4" height="8.5" rx="0.5" />
      <rect x="3" y="12.5" width="8.4" height="7.1" rx="0.5" />
      <rect x="12.6" y="12.5" width="8.4" height="8.5" rx="0.5" />
    </Mark>
  );
}

// Ubuntu's circle of friends: a ring with three nodes at 0, 120 and 240
// degrees. Named for the preset it stands for -- the launcher offers "Ubuntu",
// not "Linux", and Tux would over-claim (the preset ships a Mesa/Intel GPU
// string and an X11 user agent, not a distro-neutral identity).
// The ring is deliberately thin (1.3) against fat nodes (r 1.85): at the 16px
// the profiles table uses, a heavier ring and the nodes merge into one lump
// instead of reading as a circle with three friends on it.
export function UbuntuMark(props: MarkProps) {
  return (
    <Mark {...props}>
      <circle cx="12" cy="12" r="6.3" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="18.3" cy="12" r="1.85" />
      <circle cx="8.85" cy="17.46" r="1.85" />
      <circle cx="8.85" cy="6.54" r="1.85" />
    </Mark>
  );
}

// The bugdroid head: two antennae, an outlined dome, two filled eyes. Head only
// -- the full robot loses its legs to antialiasing at 16px.
//
// The dome is stroked rather than filled, and the eyes are their own circles
// rather than holes punched with fill-rule="evenodd". A solid dome renders as an
// undifferentiated black lump below about 24px, because the eyes are the first
// thing the rasterizer loses.
export function AndroidMark(props: MarkProps) {
  return (
    <Mark {...props}>
      <path
        d="M7.6 5.1 9.2 7.7"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.5"
      />
      <path
        d="M16.4 5.1 14.8 7.7"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.5"
      />
      <path
        d="M4.9 16.4a7.1 7.1 0 0 1 14.2 0Z"
        fill="none"
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="1.6"
      />
      <circle cx="9.6" cy="12.3" r="1" />
      <circle cx="14.4" cy="12.3" r="1" />
    </Mark>
  );
}

// An iPhone silhouette, so iOS stops sharing Android's generic <Smartphone>.
export function IosMark(props: MarkProps) {
  return (
    <Mark {...props}>
      <rect
        x="6.9"
        y="2.4"
        width="10.2"
        height="19.2"
        rx="2.6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <rect x="10.2" y="2.4" width="3.6" height="1.7" rx="0.85" />
      <rect x="10" y="19" width="4" height="0.9" rx="0.45" />
    </Mark>
  );
}
