import {Globe, Network, Radio, Signal, Waypoints} from 'lucide-react';
import brightdataLogo from '../assets/providers/brightdata.svg';
import decodoLogo from '../assets/providers/decodo.svg';
import iproyalLogo from '../assets/providers/iproyal.svg';
import webshareLogo from '../assets/providers/webshare.svg';

// The "where to buy" strip on an empty Proxies tab. Shaped like INTEGRATIONS in
// ./integrations.ts, with one difference that matters: what providers publish
// is a *wordmark*, not a square icon. So a provider with a logo shows the
// wordmark alone at a fixed height with the width left to the artwork, and the
// card drops its own name heading -- printing "Bright Data" beside a picture of
// the words "bright data" is the name twice. Providers without one keep the
// Lucide glyph and the heading.
export type ProxyProvider = {
  // Also the path segment: browserargus.com/go/<slug>.
  slug: string;
  name: string;
  // Pool types, in the vocabulary the providers themselves use.
  kinds: string;
  blurb: string;
  icon: typeof Globe;
  // Set this to a real brand SVG dropped into ../assets/providers to replace
  // the Lucide stand-in. Nothing else has to change.
  logo?: string;
  // How a mark that was drawn for one background survives the other. Same four
  // values and the same CSS as TagPreset.adapt -- invert-* for a mark that is
  // one colour, relight-* for dark ink carrying a brand colour that a plain
  // invert would send to its complement. A mid-tone mark names nothing.
  adapt?: 'invert-on-light' | 'invert-on-dark' | 'relight-on-dark' | 'relight-on-light';
};

export const PROXY_PROVIDERS: ProxyProvider[] = [
  {
    slug: 'iproyal',
    name: 'IPRoyal',
    kinds: 'Residential · Mobile · ISP',
    blurb: 'Pay-as-you-go residential traffic that never expires.',
    icon: Globe,
    logo: iproyalLogo,
    // Near-black wordmark beside a cyan mark. A plain invert would lift the
    // wordmark but take the cyan to red.
    adapt: 'relight-on-dark',
  },
  {
    slug: 'oxylabs',
    name: 'Oxylabs',
    kinds: 'Residential · Datacenter',
    blurb: 'Large vetted pool with per-city targeting.',
    icon: Network,
  },
  {
    slug: 'brightdata',
    name: 'Bright Data',
    kinds: 'Residential · Mobile · ISP',
    blurb: 'The widest coverage, priced per GB.',
    icon: Waypoints,
    logo: brightdataLogo,
    // No adapt: the cut is "bright" in #3D7FFC beside "data" in #C6DBFF, which
    // is drawn for a dark surface. The blue half carries on both themes, so it
    // stays legible on paper -- the pale half just goes quiet. Inverting would
    // fix that half and turn the blue orange, which is worse.
  },
  {
    slug: 'decodo',
    name: 'Decodo',
    kinds: 'Residential · ISP',
    blurb: 'Formerly Smartproxy. Cheap entry plans, quick setup.',
    icon: Signal,
    logo: decodoLogo,
    // White only -- invisible on paper until it is flipped.
    adapt: 'invert-on-light',
  },
  {
    slug: 'webshare',
    name: 'Webshare',
    kinds: 'Datacenter · Residential',
    blurb: 'Free tier to try, then flat monthly datacenter pricing.',
    icon: Radio,
    logo: webshareLogo,
    // #041E39 wordmark beside a #1BB394 mark: the same dark-ink-plus-colour
    // case as IPRoyal.
    adapt: 'relight-on-dark',
  },
];

// Purchase links are never sent to the OS as a third-party URL: the main
// process only opens hosts we own (externalUrlAllowed in electron/main.cjs), so
// every provider link goes through our own /go redirect. That also means the
// destination -- an affiliate URL, a changed provider -- can be edited on the
// site without shipping a new launcher build.
export function providerPath(slug: string) {
  return `/go/${slug}`;
}
