// Everything the Extensions tab draws: the three bundled extensions every
// install ships with, and the curated Web Store catalog the Discover view
// browses.
//
// Named extensionCatalog and not extensions because src/lib/extensions.ts
// already exists (it parses Web Store ids out of a pasted link).
//
// Shaped like data/integrations.ts on purpose -- a flat typed array of
// {name, tagline, logo} that a card component maps over. The two tabs sit next
// to each other in the rail and should read as the same kind of surface.
import type {BuiltInExtensionToggles} from '../types';

// Artwork comes in through import.meta.glob rather than one import per file,
// the same route data/tagPresets.ts takes for brand marks: a slug with no
// asset then costs a fallback glyph instead of a build error, so an entry can
// be added here before scripts/fetch-catalog-icons.cjs has run.
//
// These are full-colour store icons, so they render through <img> and keep
// their own palette. A CSS mask would flatten every one of them to the same
// grey blob.
const LOGO_FILES = import.meta.glob('../assets/extensions/*.png', {
  eager: true,
  import: 'default',
  query: '?url',
}) as Record<string, string>;

const LOGOS: Record<string, string> = Object.fromEntries(
    Object.entries(LOGO_FILES).map(([file, url]) => [
      file.slice(file.lastIndexOf('/') + 1, -'.png'.length),
      url,
    ]));

export function extensionLogo(slug?: string): string | undefined {
  return slug ? LOGOS[slug] : undefined;
}

export type BuiltInExtension = {
  key: keyof BuiltInExtensionToggles;
  name: string;
  // One line for the card. The long-form caveats that used to live in
  // `description` moved to `note`, which only the cards that need it render --
  // a three-line paragraph under every card made the grid unscannable.
  tagline: string;
  note?: string;
  // Basename under src/assets/extensions/, or omitted for `tint`.
  slug?: string;
  // Single-colour artwork, drawn as a CSS mask in the current ink colour
  // rather than as an <img>. The Argus mark is black-on-transparent, so as an
  // image it would vanish against the dark theme's raised surface.
  tint?: boolean;
};

// The bundled (non-removable) extensions every install ships with. Their
// toggles live on the organization, not on the individual user, so one worker
// cannot silently change what their colleagues' profiles launch with.
export const BUILT_IN_EXTENSIONS: BuiltInExtension[] = [
  {
    key: 'cookie_manager',
    name: 'Argus Cookie Manager',
    tagline: 'Export the session a profile is signed into, or import a cookie file straight into it.',
    note: 'Also seeds a profile with the cookie set assigned to it, once, on its first launch.',
    // Its icon is the Argus mark itself -- same winged helmet as
    // extensions/cookie-manager/icons/icon-128.png, reused from the copy the
    // sidebar already masks so there is one file to change if the mark does.
    tint: true,
  },
  {
    key: 'sms_activate',
    name: 'SMS Activate',
    tagline: 'Buy a phone number for a verification code, so a profile never signs up with yours.',
    note: 'Numbers are single-use: one number, one verification. Buy another for the next account.',
    slug: 'sms-activate',
  },
  {
    key: 'foxywall_free_proxy',
    name: 'FoxyWall Proxy',
    tagline: 'The free-proxy backend, bundled into every profile.',
    note: 'Only auto-connects for profiles set to Free Proxy mode. This switch stops it being bundled at all.',
    slug: 'foxywall',
  },
];

// ---------------------------------------------------------------------------
// The Discover catalog.
//
// Curated rather than searched: Google publishes no Web Store search API, and
// scraping the store's HTML would break on any markup change. The trade is
// that a new entry needs a release -- acceptable, because the escape hatch
// (paste any Web Store link) already covers everything not listed here.
//
// `id` is the 32-character Web Store id and is what actually gets installed,
// so a wrong one silently installs the wrong extension. scripts/
// fetch-catalog-icons.cjs downloads each CRX and asserts its manifest name
// matches `name` below, which turns that into a build-time failure. Run it
// after editing this list.
// ---------------------------------------------------------------------------

export type CatalogCategory =
  'captcha' | 'identity' | 'network' | 'privacy';

export type CatalogExtension = {
  id: string;
  // The file basename under src/assets/extensions/, and what the icon script
  // writes. Kept separate from the id so the assets are readable in a diff.
  slug: string;
  name: string;
  tagline: string;
  category: CatalogCategory;
};

export const CATALOG_CATEGORIES: Array<{id: CatalogCategory; label: string}> = [
  {id: 'captcha', label: 'Captcha & automation'},
  {id: 'identity', label: 'Cookies & identity'},
  {id: 'network', label: 'Proxy & network'},
  {id: 'privacy', label: 'Privacy & blocking'},
];

export const EXTENSION_CATALOG: CatalogExtension[] = [
  {
    id: 'ifibfemgeogfhoebkmokieepdoobkbpo',
    slug: '2captcha',
    // 2Captcha's own extension, under the name it is published as. Kept
    // verbatim so fetch-catalog-icons.cjs can assert the id resolves to it.
    name: 'Captcha Solver: Auto Recognition and Bypass',
    tagline: 'Hands captchas to the 2Captcha service and fills in the answer.',
    category: 'captcha',
  },
  {
    id: 'mpbjkejclgfgadiemmefgebjfooflfhl',
    slug: 'buster',
    name: 'Buster: Captcha Solver for Humans',
    tagline: 'Solves reCAPTCHA audio challenges in one click.',
    category: 'captcha',
  },
  {
    id: 'dhdgffkkebhmkfjojejmpbldmpobfkfo',
    slug: 'tampermonkey',
    name: 'Tampermonkey',
    tagline: 'Runs your own userscripts on any page.',
    category: 'captcha',
  },
  {
    id: 'mooikfkahbdckldjjndioackbalphokd',
    slug: 'selenium-ide',
    name: 'Selenium IDE',
    tagline: 'Record and replay a browser flow without writing code.',
    category: 'captcha',
  },
  {
    id: 'hlkenndednhfkekhgcdicdfddnkalmdm',
    slug: 'cookie-editor',
    name: 'Cookie-Editor',
    tagline: 'Read, edit and delete a site\'s cookies from the toolbar.',
    category: 'identity',
  },
  {
    id: 'edacconmaakjimmfgnblocblbcdcpbko',
    slug: 'session-buddy',
    name: 'Session Buddy',
    tagline: 'Saves and restores a window\'s open tabs as a named session.',
    category: 'identity',
  },
  {
    id: 'djflhoibgkdhkhhcedjiklpkjnoahfmg',
    slug: 'user-agent-switcher',
    name: 'User-Agent Switcher for Chrome',
    tagline: 'Overrides the UA string per site. Profile fingerprints override it back.',
    category: 'identity',
  },
  {
    id: 'padekgcemlokbadohgkifijomclgjgif',
    slug: 'switchyomega',
    name: 'Proxy SwitchyOmega',
    tagline: 'Per-site proxy rules, on top of the profile\'s own proxy.',
    category: 'network',
  },
  {
    id: 'lckanjgmijmafbedllaakclkaicjfmnk',
    slug: 'clearurls',
    name: 'ClearURLs',
    tagline: 'Strips tracking parameters out of every link you follow.',
    category: 'network',
  },
  {
    id: 'ddkjiahejlhfcafbddmgiahcphecmpfh',
    slug: 'ublock-origin-lite',
    name: 'uBlock Origin Lite',
    tagline: 'Content blocker. The MV3 build, since MV2 uBlock is delisted.',
    category: 'privacy',
  },
  {
    id: 'pkehgijcmpdhfbdbbnkijodmdjhbjlgp',
    slug: 'privacy-badger',
    name: 'Privacy Badger',
    tagline: 'Learns and blocks trackers as you browse.',
    category: 'privacy',
  },
  {
    id: 'eimadpbcbfnmbkopoojfekhnkhdbieeh',
    slug: 'dark-reader',
    name: 'Dark Reader',
    tagline: 'Generates a dark theme for any site.',
    category: 'privacy',
  },
];
