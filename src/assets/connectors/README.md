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

Four ship without a file here because `assets/brands` already holds the same
mark for the tag catalogue and `connectorLogo()` falls back to it: `telegram`,
`discord`, `whatsapp`, `google`. A file dropped here wins over that fallback.

They render through `<img>` (`ConnectorMark` in
`components/automations/ConnectorsView.tsx`) and keep their own colours — the
same route the tag marks take; see `assets/brands/README.md` for why a CSS
mask was rejected and what to check when a mark only reads on one theme.
Prefer the full-colour cut; keep files small.
