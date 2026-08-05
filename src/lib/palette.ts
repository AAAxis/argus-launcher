// The design tokens the generated browser start page carries.
//
// styles.css is the source of truth for every value here; this is the copy that
// travels inside home.html, which is written to disk and loaded from file://
// with no bundler and no stylesheet to link to. Same device as the
// looksLikeUrl/resolveQuery copy already living in homePage.ts: the logic has
// to be *in* the document, so it exists twice and the two must be kept level.
//
// Unlike that one, this copy is checked. scripts/verify-palette.mjs parses the
// :root and :root[data-theme="dark"] blocks out of styles.css and asserts every
// token below has the same value in both files. That check exists because this
// exact drift is what it is fixing: the start page was still painting the warm
// paper palette (#fbfaf8 / #1d1c18 / #e4ddd1) the launcher moved off months
// ago, so the two halves of one product no longer looked related.
//
// Only the subset the start page actually paints with. Adding a token here
// means adding it in styles.css first.

export type PaletteTokens = Record<string, string>;

export const LIGHT_TOKENS: PaletteTokens = {
  '--paper': '#f2f2f2',
  '--surface': '#f7f7f7',
  '--raised': '#ffffff',
  '--hover': '#ededed',
  '--ink': '#1f1f1f',
  '--ink-soft': '#676767',
  '--ink-faint': '#8c8c8c',
  '--border': '#e0e0e0',
  '--border-soft': '#ebebeb',
  '--accent': '#1a1a1a',
  '--accent-ink': '#ffffff',
  '--success': '#2e9e5b',
  '--danger': '#c5453c',
  '--danger-bg': '#fdf2f1',
  '--status-active-bg': '#eefaf1',
  '--status-active-border': '#37a862',
  '--status-active-ink': '#1e7a45',
  '--radius-xs': '6px',
  '--radius-sm': '9px',
  '--radius': '10px',
  '--radius-lg': '14px',
  '--ease': 'cubic-bezier(0.2, 0.7, 0.3, 1)',
  '--shadow-xs': '0 1px 2px rgba(24, 24, 24, 0.05)',
  '--shadow-md': '0 8px 24px rgba(24, 24, 24, 0.10), 0 2px 6px rgba(24, 24, 24, 0.05)',
};

export const DARK_TOKENS: PaletteTokens = {
  '--paper': '#161616',
  '--surface': '#1b1b1b',
  '--raised': '#222222',
  '--hover': '#1f1f1f',
  '--ink': '#e9e9e9',
  '--ink-soft': '#9e9e9e',
  '--ink-faint': '#858585',
  '--border': '#313131',
  '--border-soft': '#282828',
  '--accent': '#f0f0f0',
  '--accent-ink': '#171717',
  '--success': '#46c47c',
  '--danger': '#e2706a',
  '--danger-bg': '#2a1a18',
  '--status-active-bg': '#16281d',
  '--status-active-border': '#3d8f5e',
  '--status-active-ink': '#6cd396',
  // The radius scale and the easing curve are themeless -- declared once in
  // :root and never overridden in the dark block. Repeated here only so a theme
  // is one complete record rather than a base plus a patch, which is what the
  // generated CSS needs.
  '--radius-xs': '6px',
  '--radius-sm': '9px',
  '--radius': '10px',
  '--radius-lg': '14px',
  '--ease': 'cubic-bezier(0.2, 0.7, 0.3, 1)',
  '--shadow-xs': '0 1px 2px rgba(0, 0, 0, 0.35)',
  '--shadow-md': '0 8px 24px rgba(0, 0, 0, 0.50), 0 2px 6px rgba(0, 0, 0, 0.32)',
};

// Which of the above are declared once in :root rather than per theme, so
// verify-palette.mjs knows to check the dark record against the light block.
export const THEMELESS_TOKENS = [
  '--radius-xs', '--radius-sm', '--radius', '--radius-lg', '--ease',
];

// The one font stack the app uses, quoted from :root in styles.css. Inter is
// named there and never loaded -- there is no @font-face and no font file in
// the repo -- so in practice both surfaces render in the platform UI face.
// Keeping the stack identical anyway means that if Inter is ever bundled, the
// start page picks it up in the same step the launcher does.
export const FONT_STACK =
  'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

export const MONO_STACK = 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace';

function declarations(tokens: PaletteTokens) {
  return Object.entries(tokens)
      .map(([name, value]) => `${name}:${value}`)
      .join(';');
}

// The whole token layer as CSS, for a document that carries its own stylesheet.
//
// `preference` is the launcher's setting, not the resolved theme: 'system' has
// to stay 'system' so prefers-color-scheme keeps deciding inside the browser,
// which is a different process on a machine whose appearance can change while a
// session is open.
export function paletteCss() {
  return [
    `:root{color-scheme:light;${declarations(LIGHT_TOKENS)}}`,
    `:root[data-theme="dark"]{color-scheme:dark;${declarations(DARK_TOKENS)}}`,
    `@media (prefers-color-scheme:dark){:root[data-theme="system"]{color-scheme:dark;${declarations(DARK_TOKENS)}}}`,
  ].join('\n');
}
