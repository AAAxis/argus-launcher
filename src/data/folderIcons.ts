// The icons a folder can be given, keyed by a short stable name.
//
// The key is what goes in folders.icon, not an SVG or a URL -- so the stored
// value stays a dozen bytes, survives an icon-library swap, and can never carry
// markup. Anything unrecognized resolves to the plain folder glyph, which means
// dropping an entry from this list downgrades old folders instead of crashing
// them.
import {countries} from 'country-flag-icons';
import {
  Bot, Briefcase, Building2, Flame, Folder, Globe, Megaphone, Rocket,
  ShoppingCart, Star, Users, Wallet,
} from 'lucide-react';
import type {LucideIcon} from 'lucide-react';

export const FOLDER_ICONS: {key: string; label: string; icon: LucideIcon}[] = [
  {key: 'folder', label: 'Folder', icon: Folder},
  {key: 'users', label: 'Team', icon: Users},
  {key: 'briefcase', label: 'Work', icon: Briefcase},
  {key: 'cart', label: 'Commerce', icon: ShoppingCart},
  {key: 'megaphone', label: 'Ads', icon: Megaphone},
  {key: 'rocket', label: 'Launch', icon: Rocket},
  {key: 'star', label: 'Priority', icon: Star},
  {key: 'flame', label: 'Warmup', icon: Flame},
  {key: 'building', label: 'Client', icon: Building2},
  {key: 'wallet', label: 'Finance', icon: Wallet},
  {key: 'bot', label: 'Automation', icon: Bot},
  {key: 'globe', label: 'Region', icon: Globe},
];

export const DEFAULT_FOLDER_ICON = 'folder';

export function folderIcon(key?: string | null): LucideIcon {
  return FOLDER_ICONS.find((entry) => entry.key === key)?.icon || Folder;
}

// A folder can wear a country flag instead of a glyph -- "flag:US", not an SVG
// and not an emoji.
//
// Not an emoji because the flag emoji are Regional Indicator pairs, and this
// user's Windows build renders those as two boxed letters even with an explicit
// emoji font; FlagIcon's bundled SVGs are already how proxies show their
// country, so a folder and the proxies inside it show the same mark.
//
// The key keeps the same contract as the glyph keys above: a few bytes, no
// markup, and anything unrecognized falls back to the plain folder rather than
// breaking the row.
export const FLAG_ICON_PREFIX = 'flag:';

export function flagIconKey(code: string) {
  return `${FLAG_ICON_PREFIX}${code.trim().toUpperCase()}`;
}

// The ISO code inside a flag key, or null for a glyph key. Two letters only --
// FlagIcon has no component for anything else and would print the raw text.
export function flagCodeFromIcon(key?: string | null): string | null {
  if (!key?.startsWith(FLAG_ICON_PREFIX)) {
    return null;
  }
  const code = key.slice(FLAG_ICON_PREFIX.length).toUpperCase();
  return /^[A-Z]{2}$/.test(code) ? code : null;
}

// Every country the flag set can draw, with a readable name.
//
// `countries` is country-flag-icons' own list, so the picker can never offer a
// flag it cannot render. The names come from Intl rather than a table we would
// have to maintain -- 265 of them, and Chromium has had DisplayNames since 81.
// Built once: this walks the whole list and the picker re-filters it on every
// keystroke.
let countryCache: {code: string; name: string}[] | null = null;

export function countryChoices() {
  if (countryCache) {
    return countryCache;
  }
  let display: Intl.DisplayNames | null = null;
  try {
    display = new Intl.DisplayNames(['en'], {type: 'region'});
  } catch {
    // Not worth failing the picker over -- the codes alone are still usable.
    display = null;
  }
  countryCache = countries
      .filter((code) => /^[A-Z]{2}$/.test(code))
      .map((code) => ({code, name: safeRegionName(display, code)}))
      .sort((left, right) => left.name.localeCompare(right.name));
  return countryCache;
}

function safeRegionName(display: Intl.DisplayNames | null, code: string) {
  try {
    return display?.of(code) || code;
  } catch {
    return code;
  }
}

export function countryName(code: string) {
  const upper = code.trim().toUpperCase();
  return countryChoices().find((entry) => entry.code === upper)?.name || upper;
}
