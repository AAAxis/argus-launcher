import {Globe, Network, Radio, Signal, Waypoints} from 'lucide-react';

// The "where to buy" strip on an empty Proxies tab. Shaped exactly like
// INTEGRATIONS in ./integrations.ts -- same optional-logo-with-Lucide-fallback
// contract -- so IntegrationMark's rendering rule carries over unchanged.
export type ProxyProvider = {
  // Also the path segment: browserargus.com/go/<slug>.
  slug: string;
  name: string;
  // Pool types, in the vocabulary the providers themselves use.
  kinds: string;
  blurb: string;
  icon: typeof Globe;
  // Set this to a real brand SVG dropped into ../assets to replace the Lucide
  // stand-in. Nothing else has to change.
  logo?: string;
  // Which theme a single-colour mark has to be inverted in. See the same field
  // on Integration for why one boolean could not express this.
  invertOn?: 'dark' | 'light';
};

export const PROXY_PROVIDERS: ProxyProvider[] = [
  {
    slug: 'iproyal',
    name: 'IPRoyal',
    kinds: 'Residential · Mobile · ISP',
    blurb: 'Pay-as-you-go residential traffic that never expires.',
    icon: Globe,
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
  },
  {
    slug: 'decodo',
    name: 'Decodo',
    kinds: 'Residential · ISP',
    blurb: 'Formerly Smartproxy. Cheap entry plans, quick setup.',
    icon: Signal,
  },
  {
    slug: 'webshare',
    name: 'Webshare',
    kinds: 'Datacenter · Residential',
    blurb: 'Free tier to try, then flat monthly datacenter pricing.',
    icon: Radio,
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
