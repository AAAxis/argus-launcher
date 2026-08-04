# Proxy provider marks

One SVG per entry in `src/data/proxyProviders.ts`, named `<slug>.svg`. Unlike
the tag brand marks next door these are **imported by name**, so adding a file
also means adding the `logo:` line to `PROXY_PROVIDERS`. A provider with no file
keeps its Lucide stand-in and its written name, which is why the strip still
renders with only some of them present.

Missing: **oxylabs**. It is the one provider still on a Lucide glyph.

## They are wordmarks, not icons

Everything here runs 4.5:1 to 6.25:1 — vendors publish a logotype, not an app
icon. So a card with a logo shows the wordmark *instead of* its `<h4>`, at a
fixed 18px height with the width left to the artwork (`.provider-logo`).
Printing "Bright Data" beside a picture of the words "bright data" was the name
twice, and boxing a 6:1 wordmark into the glyph's 20×20 was an illegible smear.

## Theme fixes

Declared per-provider as `adapt`, the same four values and the same CSS as
`TagPreset.adapt`:

| Mark | Ships as | `adapt` |
|---|---|---|
| Decodo | white only | `invert-on-light` |
| IPRoyal | near-black wordmark + cyan glyph | `relight-on-dark` |
| Webshare | `#041E39` wordmark + teal glyph | `relight-on-dark` |
| Bright Data | `#3D7FFC` + `#C6DBFF`, drawn for dark | none — see below |

Bright Data is the awkward one. Its cut is "bright" in mid blue beside "data" in
a very pale blue. The blue half carries on both themes; on paper the pale half
just goes quiet. Inverting would rescue that half and turn the blue orange,
which is worse than a soft second word. If a light-background cut turns up,
swap the file and this row goes away.

## Gotcha: `xmlns`

`iproyal.svg` arrived without an `xmlns` (lifted out of an Astro page, which
supplied it from the parent document) and with `fill="currentColor"` on the
wordmark. Through `<img>` both are broken: no namespace means it is not an SVG
document at all and renders as nothing, and `currentColor` has nothing to
inherit. Both were fixed on the way in. **Check any new file renders on its own**
— open it directly in a browser — before trusting it.
