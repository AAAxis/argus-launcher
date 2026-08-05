# Connector brand marks

One image per connector kind, named `<kind>.svg` or `<kind>.png` where the kind
is the preset id in `src/data/connectors.ts`. Nothing imports these by name —
`connectorLogo()` picks them up through `import.meta.glob`, so a file only has
to be dropped here to appear on the kind's card and picker tile, and a missing
one costs the preset's lucide fallback glyph rather than a build error.

Kinds this catalogue currently names:

    openai  anthropic  deepseek  google  mistral  xai  openrouter
    together  huggingface  lmstudio  ollama  custom
    telegram  slack  discord  whatsapp  smtp

All are present except `custom` and `smtp`, which deliberately keep their
lucide glyphs — neither is a brand. `connectorLogo()` also falls back to
`assets/brands/<slug>.svg` for the services both catalogues know (telegram,
discord, whatsapp, google); a file here wins over that fallback.

They render through `<img>` (`ConnectorMark` in
`components/automations/ConnectorsView.tsx`) and keep their own colours — the
same route the tag marks take; see `assets/brands/README.md` for why a CSS
mask was rejected. Five of these cuts are single-colour and only read on one
theme; which ones, and the fix, is `LOGO_ADAPT` in `src/data/connectors.ts`
(`invert-on-light` for the white cuts — openai, openrouter, ollama —
`invert-on-dark` for the currentColor-turned-black ones — xai, lmstudio).
Check both themes when swapping a file for a different cut and update that
map to match. Prefer the full-colour cut; keep files small.
