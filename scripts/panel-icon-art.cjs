// The Argus Panel's toolbar icon, as SVG strings.
//
// Separate from icon-art.cjs next door, which draws macOS app tiles: those are
// 1024px Dock icons inside Apple's rounded-square grid, and this is a 16pt
// browser toolbar button. Nothing about the two problems is the same.
//
// Two constraints shape it:
//
//   1. Chrome neither inverts nor re-tints an extension's action icon, and the
//      toolbar is near-white in the light theme and near-charcoal in the dark
//      one. The mark is black line art, so drawn on transparency it disappears
//      on half of them. It sits on a plate instead, which carries its own
//      contrast the way a real toolbar button does -- and gets a hairline rim,
//      because a near-black plate on a near-charcoal toolbar is technically
//      visible and practically a hole.
//   2. The mark is drawn once, from src/assets/argus-mark.svg, and never
//      redrawn by hand. It is the product's logo; a simplified "version of it"
//      authored to survive 16px is a different logo. Where the detail cannot
//      survive, the answer is to give it more room on the plate, not to trace
//      it again.
const fs = require('node:fs');
const path = require('node:path');

// Literals rather than var(), because this is rasterized standalone with no
// cascade to read tokens from -- the same reason sidepanel.css carries its own
// copy of the palette. Values are --ink / --border in styles.css's dark block:
// the plate is a dark control, so it takes dark-theme tokens in both themes.
const PLATE = '#1f1f1f';
const RIM = '#4a4a4a';
const MARK = '#ffffff';

// The canonical mark's inner drawing, lifted out of its <svg> wrapper so it can
// be re-wrapped at another size. The embeddable cut in src/assets is the right
// one to read: it paints with currentColor (so `color` below tints it) and its
// clipPath id is namespaced, which matters the moment two of these end up in
// one document. See src/assets/README.md before swapping the file.
function markInner() {
  const source = fs.readFileSync(path.join(__dirname, '../src/assets/argus-mark.svg'), 'utf8');
  const open = source.indexOf('>', source.indexOf('<svg')) + 1;
  const close = source.lastIndexOf('</svg>');
  return source.slice(open, close);
}

// The mark's own viewBox, from that file. Taller than it is wide, so the plate
// centres it on width and lets height decide the scale.
const MARK_BOX = {width: 874, height: 1124};

// One entry per size Chrome asks for: 16 and 32 are the toolbar at 1x and 2x,
// 48 is chrome://extensions, 128 is the install dialog.
//
// `pad` is the share of the plate left empty around the mark. It grows as the
// icon shrinks: at 128px the logo can sit in a comfortable tile, but at 16px
// every pixel of margin is a pixel the helmet does not get, so the small sizes
// crop closer.
const SIZES = [
  {size: 16, pad: 0.10, radius: 0.26},
  {size: 32, pad: 0.14, radius: 0.24},
  {size: 48, pad: 0.16, radius: 0.23},
  {size: 128, pad: 0.18, radius: 0.22},
];

function iconSpecs() {
  const inner = markInner();
  return SIZES.map(({size, pad, radius}) => ({
    size,
    svg: () => {
      // The rim is drawn inside the plate's edge (hence the half-stroke inset),
      // so a 1px stroke stays 1px instead of straddling the boundary and
      // rendering as two half-lit rows.
      const stroke = size <= 32 ? 1 : Math.round(size / 32);
      const inset = stroke / 2;
      const box = size - stroke;
      const room = size * (1 - pad * 2);
      const scale = room / MARK_BOX.height;
      const markWidth = MARK_BOX.width * scale;
      const left = (size - markWidth) / 2;
      const top = size * pad;
      return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" ` +
        `viewBox="0 0 ${size} ${size}">` +
        `<rect x="${inset}" y="${inset}" width="${box}" height="${box}" ` +
        `rx="${(size * radius).toFixed(2)}" fill="${PLATE}" stroke="${RIM}" ` +
        `stroke-width="${stroke}"/>` +
        `<g transform="translate(${left.toFixed(2)} ${top.toFixed(2)}) ` +
        `scale(${scale.toFixed(5)})" color="${MARK}">${inner}</g>` +
        '</svg>';
    },
  }));
}

module.exports = {MARK, PLATE, RIM, iconSpecs};
