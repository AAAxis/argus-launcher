// Platform brand marks.
//
// lucide-react has no brand logos, which is why PlatformIcon used to collapse
// Windows 11, Windows 10 and Ubuntu into one <Monitor> and Android and iOS into
// one <Smartphone> -- five of the six presets were visually indistinguishable in
// the profiles table. These fill the gap, on the same 24x24 grid lucide uses so
// they line up with the lucide glyphs beside them.
//
// The six marks arrive by two different routes, because Vite has no SVGR here
// (a `.svg` import resolves to a URL, not a component) and an <img> cannot
// inherit colour:
//
//   - Windows and Ubuntu are brand-coloured and keep their own palette, so they
//     ship as files under assets/platform and render through <img> -- the same
//     route data/integrations.ts + IntegrationMark already use.
//   - Apple and Android are single-colour shapes, so their path data is inlined
//     here as currentColor. Apple in particular ships filled #fff, which would
//     be an invisible white silhouette on the light theme.
//
// Nothing in this file names a colour. Same reasoning as GoogleMark in
// ui/icons.tsx.
import ubuntuLogo from '../../assets/platform/ubuntu.svg';
import windowsLogo from '../../assets/platform/windows11.svg';
import type {SVGProps} from 'react';

type MarkProps = {size?: number} & Omit<SVGProps<SVGSVGElement>, 'width' | 'height'>;

function Mark({size = 16, viewBox = '0 0 24 24', children, ...rest}: MarkProps) {
  return (
    <svg
      aria-hidden="true"
      fill="currentColor"
      focusable="false"
      height={size}
      viewBox={viewBox}
      width={size}
      xmlns="http://www.w3.org/2000/svg"
      {...rest}
    >
      {children}
    </svg>
  );
}

// The brand-coloured pair. alt="" because PlatformIcon's wrapper already
// carries the role and accessible name -- an alt here would announce twice.
function LogoMark({src, size = 16}: {src: string; size?: number}) {
  return <img alt="" src={src} style={{height: size, width: size}} />;
}

// The four-pane flag, in Microsoft's #0078d4. Windows 11 and Windows 10 share
// it: downstream they are the same `windows` preset and the same
// `Windows NT 10.0` user agent, so drawing two different logos would claim a
// distinction the browser does not make. The version is carried by the label
// and the tooltip instead.
export function WindowsMark({size}: {size?: number}) {
  return <LogoMark src={windowsLogo} size={size} />;
}

// Ubuntu's circle of friends, in the distro's #f47421. Named for the preset it
// stands for -- the launcher offers "Ubuntu", not "Linux", and Tux would
// over-claim (the preset ships a Mesa/Intel GPU string and an X11 user agent,
// not a distro-neutral identity).
export function UbuntuMark({size}: {size?: number}) {
  return <LogoMark src={ubuntuLogo} size={size} />;
}

// The Apple silhouette, from docs/apple.svg but recoloured: shipped as
// fill="#fff", it is invisible against every surface in the light theme. As
// currentColor it takes the ink of whatever it sits in and inverts with theme.
//
// This replaces lucide's <Apple>, which draws a whole apple with a leaf rather
// than the logo -- next to five real brand marks it read as a piece of fruit.
//
// macOS and iOS share it, on the same terms as Windows 11 and Windows 10
// sharing the flag above: the label and the tooltip carry the distinction. The
// alternative was a hand-traced iPhone outline standing in for a logo Apple
// does not publish as one.
export function AppleMark(props: MarkProps) {
  return (
    <Mark viewBox="0 0 814 1000" {...props}>
      <path d="M788.1 340.9c-5.8 4.5-108.2 62.2-108.2 190.5 0 148.4 130.3 200.9 134.2 202.2-.6 3.2-20.7 71.9-68.7 141.9-42.8 61.6-87.5 123.1-155.5 123.1s-85.5-39.5-164-39.5c-76.5 0-103.7 40.8-165.9 40.8s-105.6-57-155.5-127C46.7 790.7 0 663 0 541.8c0-194.4 126.4-297.5 250.8-297.5 66.1 0 121.2 43.4 162.7 43.4 39.5 0 101.1-46 176.3-46 28.5 0 130.9 2.6 198.3 99.2zm-234-181.5c31.1-36.9 53.1-88.1 53.1-139.3 0-7.1-.6-14.3-1.9-20.1-50.6 1.9-110.8 33.7-147.1 75.8-28.5 32.4-55.1 83.6-55.1 135.5 0 7.8 1.3 15.6 1.9 18.1 3.2.6 8.4 1.3 13.6 1.3 45.4 0 102.5-30.4 135.5-71.3z" />
    </Mark>
  );
}

// The bugdroid, from docs/android-mono.svg -- the monochrome cut rather than
// the #3DDC84 one, so it sits beside the Apple mark as ink rather than being
// the only green thing in a column of six.
export function AndroidMark(props: MarkProps) {
  return (
    <Mark {...props}>
      <path d="M18.4395 5.5586c-.675 1.1664-1.352 2.3318-2.0274 3.498-.0366-.0155-.0742-.0286-.1113-.043-1.8249-.6957-3.484-.8-4.42-.787-1.8551.0185-3.3544.4643-4.2597.8203-.084-.1494-1.7526-3.021-2.0215-3.4864a1.1451 1.1451 0 0 0-.1406-.1914c-.3312-.364-.9054-.4859-1.379-.203-.475.282-.7136.9361-.3886 1.5019 1.9466 3.3696-.0966-.2158 1.9473 3.3593.0172.031-.4946.2642-1.3926 1.0177C2.8987 12.176.452 14.772 0 18.9902h24c-.119-1.1108-.3686-2.099-.7461-3.0683-.7438-1.9118-1.8435-3.2928-2.7402-4.1836a12.1048 12.1048 0 0 0-2.1309-1.6875c.6594-1.122 1.312-2.2559 1.9649-3.3848.2077-.3615.1886-.7956-.0079-1.1191a1.1001 1.1001 0 0 0-.8515-.5332c-.5225-.0536-.9392.3128-1.0488.5449zm-.0391 8.461c.3944.5926.324 1.3306-.1563 1.6503-.4799.3197-1.188.0985-1.582-.4941-.3944-.5927-.324-1.3307.1563-1.6504.4727-.315 1.1812-.1086 1.582.4941zM7.207 13.5273c.4803.3197.5506 1.0577.1563 1.6504-.394.5926-1.1038.8138-1.584.4941-.48-.3197-.5503-1.0577-.1563-1.6504.4008-.6021 1.1087-.8106 1.584-.4941z" />
    </Mark>
  );
}
