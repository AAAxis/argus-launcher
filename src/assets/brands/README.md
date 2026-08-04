# Tag brand marks

One SVG per tag preset, named `<slug>.svg` where the slug is the `slug` field in
`src/data/tagPresets.ts`. Nothing imports these by name — `TAG_PRESETS` picks
them up through `import.meta.glob`, so a file only has to be dropped here to
appear on its chip, and a missing one costs the preset's lucide fallback glyph
rather than a build error. All 21 are present.

## How they render

Through `<img>` (`TagMark` in `components/ui/TagChip.tsx`), keeping their own
colours — the same route `data/integrations.ts` and the Windows/Ubuntu platform
marks take. A CSS mask was tried first and reverted: it is tidier, but it
flattens a logo to a silhouette, which turns Instagram's gradient and Google's
four colours into the same grey blob.

Height is fixed and **width is left to the artwork** (`width: auto`,
`object-fit: contain`, `max-width` ≈ 1.9× the height). These are not all square
— YouTube is 256×180, eBay and Amazon are wordmarks — and forcing them into a
box would squash or crop them.

## Marks that need a theme fix

A mid-tone brand colour reads on both themes and needs nothing. Two cases do
not, and both are declared per-preset via `adapt` in `tagPresets.ts`:

| Mark | Ships as | `adapt` | Result |
|---|---|---|---|
| X, Threads | white only | `invert-on-light` | black on paper, white on charcoal |
| Snapchat | black only | `invert-on-dark` | the reverse |
| TikTok, Amazon | dark ink **plus** a brand colour | `relight-on-dark` | `invert(1) hue-rotate(180deg)` — lifts the ink without sending cyan to red |

If you swap a file for a different cut, check it in both themes and update
`adapt` to match. The CSS is beside `.tag-logo` in `styles.css`.

## Adding one

Drop `<slug>.svg` here and add the entry to `TAG_PRESETS`. Prefer the
full-colour brand cut; [simpleicons.org](https://simpleicons.org) is a fine
source but its monochrome cuts will need an `adapt` value. Keep files small —
Vite inlines anything under 4 KB as a `data:` URI instead of emitting it.
