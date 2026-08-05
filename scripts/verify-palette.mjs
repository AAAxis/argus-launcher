#!/usr/bin/env node
// Asserts the browser start page and the launcher paint the same colours.
//
// src/styles.css is the source of truth. src/lib/palette.ts is the copy that
// travels inside the generated home.html, which is a file:// document with no
// stylesheet to link to -- so the values necessarily exist twice. They had
// already drifted once, and badly: the start page was still on the warm paper
// palette (#fbfaf8 / #1d1c18 / #e4ddd1) the launcher replaced with an
// achromatic ramp, so the two halves of one product did not look related.
//
//   node scripts/verify-palette.mjs
//
// No Electron, no Supabase, no running launcher -- it reads two files. Exits
// non-zero on the first failure so it can sit in the verification checklist
// beside verify-api-routes.
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

const cssSource = readFileSync(join(root, 'src/styles.css'), 'utf8');
const paletteSource = readFileSync(join(root, 'src/lib/palette.ts'), 'utf8');

let failures = 0;

function check(ok, message) {
  if (ok) {
    return;
  }
  failures += 1;
  console.error(`FAIL  ${message}`);
}

let reported = 0;

function pass(message) {
  if (failures > reported) {
    console.log(`FAIL  ${message}`);
    reported = failures;
    return;
  }
  console.log(`ok    ${message}`);
}

// ── Parsing ──────────────────────────────────────────────────────────────────
// Both parsers are deliberately dumb line scanners rather than a CSS or TS
// parser. A dependency for this would be worse than the drift it catches, and
// both files are hand-written in one house style: one declaration per line.

// Everything between `selector {` and the first line that is a bare `}`.
function cssBlock(selector) {
  const start = cssSource.indexOf(`${selector} {`);
  if (start === -1) {
    return null;
  }
  const end = cssSource.indexOf('\n}', start);
  return cssSource.slice(start, end === -1 ? undefined : end);
}

function cssTokens(selector) {
  const block = cssBlock(selector);
  if (block === null) {
    return null;
  }
  const tokens = new Map();
  for (const match of block.matchAll(/^\s*(--[a-z0-9-]+):\s*(.+?);\s*$/gm)) {
    tokens.set(match[1], match[2].trim());
  }
  return tokens;
}

// `'--name': 'value',` out of one exported record.
function tsTokens(name) {
  const start = paletteSource.indexOf(`export const ${name}: PaletteTokens = {`);
  if (start === -1) {
    return null;
  }
  const end = paletteSource.indexOf('\n};', start);
  const block = paletteSource.slice(start, end === -1 ? undefined : end);
  const tokens = new Map();
  for (const match of block.matchAll(/^\s*'(--[a-z0-9-]+)':\s*'(.*?)',\s*$/gm)) {
    tokens.set(match[1], match[2]);
  }
  return tokens;
}

function tsList(name) {
  const start = paletteSource.indexOf(`export const ${name} = [`);
  if (start === -1) {
    return [];
  }
  const block = paletteSource.slice(start, paletteSource.indexOf('\n];', start));
  return [...block.matchAll(/'(--[a-z0-9-]+)'/g)].map((match) => match[1]);
}

const cssLight = cssTokens(':root');
const cssDark = cssTokens(':root[data-theme="dark"]');
const tsLight = tsTokens('LIGHT_TOKENS');
const tsDark = tsTokens('DARK_TOKENS');
const themeless = new Set(tsList('THEMELESS_TOKENS'));

check(cssLight && cssLight.size > 0, 'styles.css has a :root token block');
check(cssDark && cssDark.size > 0, 'styles.css has a :root[data-theme="dark"] token block');
check(tsLight && tsLight.size > 0, 'palette.ts exports LIGHT_TOKENS');
check(tsDark && tsDark.size > 0, 'palette.ts exports DARK_TOKENS');
if (failures > 0) {
  console.error('\nCould not parse both files -- nothing else can be checked.');
  process.exit(1);
}
pass(`parsed ${cssLight.size} light and ${cssDark.size} dark tokens from styles.css`);

// ── 1. Light ─────────────────────────────────────────────────────────────────
for (const [name, value] of tsLight) {
  const css = cssLight.get(name);
  check(css !== undefined, `${name} is in palette.ts but not in styles.css :root`);
  check(css === undefined || css === value,
      `${name} is ${value} in palette.ts and ${css} in styles.css :root`);
}
pass(`${tsLight.size} light tokens match styles.css`);

// ── 2. Dark ──────────────────────────────────────────────────────────────────
// A themeless token (the radius scale) is declared once, in :root, and never
// overridden -- so the dark record's copy of it is checked against the light
// block. Anything else must appear in the dark block or the start page would be
// painting a value the app does not have.
for (const [name, value] of tsDark) {
  const source = themeless.has(name) ? cssLight : cssDark;
  const where = themeless.has(name) ? ':root' : ':root[data-theme="dark"]';
  const css = source.get(name);
  check(css !== undefined, `${name} is in palette.ts but not in styles.css ${where}`);
  check(css === undefined || css === value,
      `${name} is ${value} in palette.ts and ${css} in styles.css ${where}`);
}
pass(`${tsDark.size} dark tokens match styles.css`);

// ── 3. The two records describe the same theme ───────────────────────────────
// A token in one and not the other means one theme paints something the other
// leaves at the browser default, which is the kind of bug that only shows up
// for whichever theme the person reviewing it was not using.
for (const name of tsLight.keys()) {
  check(tsDark.has(name), `${name} is in LIGHT_TOKENS but not in DARK_TOKENS`);
}
for (const name of tsDark.keys()) {
  check(tsLight.has(name), `${name} is in DARK_TOKENS but not in LIGHT_TOKENS`);
}
pass('both palette.ts records declare the same token set');

// ── 4. The start page paints with tokens and nothing else ────────────────────
// The failure being guarded against is not a wrong hex -- it is a hex at all.
// Every colour in the generated document has to resolve through a var(), or the
// theme it is under stops applying to that one rule and only that one rule.
const homeSource = readFileSync(join(root, 'src/lib/homePage.ts'), 'utf8');
// The palette import itself is where the literals legitimately live; the style
// block in homePage.ts must contain none.
// The lookbehind rejects HTML numeric entities (&#9654;), which are glyphs
// rather than colours and would otherwise read as a four-digit hex.
const literals = [...homeSource.matchAll(/(?<!&)#[0-9a-fA-F]{3,8}\b/g)]
    .map((match) => match[0]);
check(literals.length === 0,
    `homePage.ts still hardcodes ${literals.length} colour(s): ${[...new Set(literals)].join(', ')}`);
pass('homePage.ts paints only through var() tokens');

if (failures > 0) {
  console.error(`\n${failures} failure(s).`);
  process.exit(1);
}
console.log('\nStart page palette matches styles.css.');
