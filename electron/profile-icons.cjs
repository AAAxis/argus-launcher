// Which .icns a profile's Dock tile gets, and the palette those tiles are drawn
// from.
//
// Every profile used to hand its wrapper .app a copy of the browser's own
// app.icns -- which is byte-identical to the launcher's -- so the Dock showed
// the same Chromium tile for the launcher, the browser, and all N open
// profiles. The names underneath differed and nothing else did. Now each
// profile gets a tile tinted with the colour it already carries in the
// profiles table, and the launcher gets a mark of its own. The artwork itself
// is in scripts/icon-art.cjs; scripts/build-icons.cjs rasterizes it.
//
// This module is required by both the main process and scripts/build-icons.cjs,
// so it must stay free of any `electron` import.
const fs = require('node:fs');
const path = require('node:path');

/** @typedef {'slate'|'blue'|'green'|'violet'|'red'|'amber'} ProfileIconKey */

// The hue each preset is drawn in. Saturation is per-colour rather than shared
// because a single value can't serve both `slate` (a near-neutral, so almost
// none) and `amber` (which greys out into mud below ~60).
//
// Lightness is NOT here: it varies per ring segment and per theme, and lives in
// scripts/icon-art.cjs with the geometry it belongs to.
const PROFILE_HUES = {
  slate: {hue: 30, sat: 8},
  blue: {hue: 220, sat: 62},
  green: {hue: 152, sat: 50},
  violet: {hue: 262, sat: 55},
  red: {hue: 6, sat: 58},
  amber: {hue: 38, sat: 68},
};

/** @type {ProfileIconKey[]} */
const PROFILE_ICON_KEYS = Object.keys(PROFILE_HUES);

const DEFAULT_PROFILE_ICON_KEY = 'blue';

// Mirrors LEGACY_HEX_TO_KEY in src/lib/profileColors.ts. Profiles saved before
// the six colours became keys still hold one of these literals, and they must
// resolve to the same tile the app shows them in -- so if that table is ever
// edited, edit this one too.
const LEGACY_HEX_TO_KEY = {
  '#171613': 'slate',
  '#2563eb': 'blue',
  '#16a34a': 'green',
  '#a855f7': 'violet',
  '#dc2626': 'red',
  '#f59e0b': 'amber',
};

// Every icon exists in two formats, and which one a caller needs is decided by
// who consumes it, not by preference:
//
//   .icns  what a macOS bundle's Contents/Resources holds, and the only thing
//          electron-builder's `icon` field accepts.
//   .png   what nativeImage.createFromPath() can actually read. It returns an
//          EMPTY image for .icns and .ico, so app.dock.setIcon() and
//          BrowserWindow's `icon` silently do nothing when handed one.
//
// 512 covers the largest the Dock draws (256pt at 2x) with no room wasted.
const RUNTIME_PNG_SIZE = 512;

function iconsDir() {
  return path.join(__dirname, '..', 'assets', 'icons');
}

// A custom colour has no tile of its own -- generating one per launch would
// mean rasterizing and running iconutil on the launch path, for a difference
// nobody can see at 32px. So it borrows the preset nearest it in hue, which is
// what the user was reaching for when they picked the hex anyway.
function nearestPresetKey(hex) {
  const rgb = parseHex(hex);
  if (!rgb) {
    return null;
  }
  const {hue, sat, light} = rgbToHsl(rgb);
  // Anything this washed out or this close to the ends of the ramp has no
  // meaningful hue to match on -- comparing one would pick an arbitrary
  // winner, so send it to the neutral preset instead.
  if (sat < 12 || light < 12 || light > 92) {
    return 'slate';
  }
  let best = DEFAULT_PROFILE_ICON_KEY;
  let bestDistance = Infinity;
  for (const key of PROFILE_ICON_KEYS) {
    if (key === 'slate') {
      continue; // Neutral; it has a nominal hue but nothing should match on it.
    }
    const distance = hueDistance(hue, PROFILE_HUES[key].hue);
    if (distance < bestDistance) {
      best = key;
      bestDistance = distance;
    }
  }
  return best;
}

// The tile key for whatever `profiles.color` happens to hold: one of the six
// preset keys, one of the six legacy hexes, a custom hex, or nothing at all.
/** @returns {ProfileIconKey} */
function profileIconKey(color) {
  const trimmed = String(color || '').trim();
  if (PROFILE_HUES[trimmed]) {
    return trimmed;
  }
  const legacy = LEGACY_HEX_TO_KEY[trimmed.toLowerCase()];
  if (legacy) {
    return legacy;
  }
  return nearestPresetKey(trimmed) || DEFAULT_PROFILE_ICON_KEY;
}

// All four return null when the file is missing, so callers fall back instead
// of installing an icon that isn't there. That happens in a dev tree where
// scripts/build-icons.cjs has never been run; a packaged build always ships
// assets/icons.
function profileIconIcns(color, dark) {
  return existingIcon(`profile-${profileIconKey(color)}-${theme(dark)}`, 'icns');
}

function profileIconPng(color, dark) {
  return existingIcon(`profile-${profileIconKey(color)}-${theme(dark)}`, 'png');
}

function launcherIconIcns(dark) {
  return existingIcon(`launcher-${theme(dark)}`, 'icns');
}

function launcherIconPng(dark) {
  return existingIcon(`launcher-${theme(dark)}`, 'png');
}

function theme(dark) {
  return dark ? 'dark' : 'light';
}

function existingIcon(name, extension) {
  const file = path.join(iconsDir(), `${name}.${extension}`);
  return fs.existsSync(file) ? file : null;
}

function parseHex(value) {
  const match = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(value || '').trim());
  if (!match) {
    return null;
  }
  const raw = match[1];
  const full = raw.length === 3 ? raw.split('').map((char) => char + char).join('') : raw;
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  };
}

function rgbToHsl({r, g, b}) {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const delta = max - min;
  let hue = 0;
  if (delta !== 0) {
    if (max === rn) {
      hue = ((gn - bn) / delta) % 6;
    } else if (max === gn) {
      hue = (bn - rn) / delta + 2;
    } else {
      hue = (rn - gn) / delta + 4;
    }
    hue *= 60;
    if (hue < 0) {
      hue += 360;
    }
  }
  const light = (max + min) / 2;
  const sat = delta === 0 ? 0 : delta / (1 - Math.abs(2 * light - 1));
  return {hue, sat: sat * 100, light: light * 100};
}

function hueDistance(a, b) {
  const raw = Math.abs(a - b) % 360;
  return raw > 180 ? 360 - raw : raw;
}

module.exports = {
  DEFAULT_PROFILE_ICON_KEY,
  PROFILE_HUES,
  PROFILE_ICON_KEYS,
  RUNTIME_PNG_SIZE,
  iconsDir,
  launcherIconIcns,
  launcherIconPng,
  profileIconIcns,
  profileIconKey,
  profileIconPng,
};
