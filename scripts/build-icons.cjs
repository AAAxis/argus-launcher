// Rasterizes scripts/icon-art.cjs into the .icns files in assets/icons.
//
//   npm run icons
//
// macOS only, and deliberately a build step rather than something the launch
// path does: generating a tile per launch would mean running a rasterizer and
// iconutil before the browser can start, to produce a file that only ever has
// fourteen possible values. The output is committed, so a normal checkout can
// build a DMG without ever running this.
//
// It renders through Electron because Electron is already a devDependency and
// Chromium is the only SVG rasterizer this repo can assume is present --
// rsvg-convert and friends are not installed on a stock Mac, and `sips` cannot
// read SVG at all.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');

const {app, BrowserWindow, screen} = require('electron');

const {CANVAS, iconSpecs} = require('./icon-art.cjs');
const {RUNTIME_PNG_SIZE, iconsDir} = require('../electron/profile-icons.cjs');

// The sizes an .iconset must contain. macOS picks from these by context: 16 in
// Finder list view, 32 in the sidebar, 128/256 in the Dock, 512 in Get Info.
const ICONSET = [
  {size: 16, names: ['icon_16x16.png']},
  {size: 32, names: ['icon_16x16@2x.png', 'icon_32x32.png']},
  {size: 64, names: ['icon_32x32@2x.png']},
  {size: 128, names: ['icon_128x128.png']},
  {size: 256, names: ['icon_128x128@2x.png', 'icon_256x256.png']},
  {size: 512, names: ['icon_256x256@2x.png', 'icon_512x512.png']},
  {size: 1024, names: ['icon_512x512@2x.png']},
];

async function main() {
  if (process.platform !== 'darwin') {
    throw new Error('build-icons is macOS-only: it shells out to iconutil');
  }
  const outDir = iconsDir();
  fs.mkdirSync(outDir, {recursive: true});

  const window = await openRenderWindow();
  const specs = iconSpecs();
  try {
    for (const spec of specs) {
      const master = await render(window, spec.svg());
      writeIcns(spec.name, master, outDir);
      writePng(spec.name, master, outDir);
      console.log(`  wrote ${spec.name}.icns + .png`);
    }
  } finally {
    window.destroy();
  }
  console.log(`${specs.length} icons -> ${outDir}`);
}

// A frameless transparent window sized to the artwork. `transparent` is what
// keeps the tile's rounded corners as alpha rather than compositing them onto
// white -- an opaque-cornered icns is visibly a square in the Dock.
async function openRenderWindow() {
  const window = new BrowserWindow({
    width: CANVAS,
    height: CANVAS,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    webPreferences: {offscreen: true},
  });
  await window.loadURL('data:text/html,<html><body></body></html>');
  return window;
}

// Renders one SVG at full canvas size and returns the PNG bytes.
//
// capturePage() reports its rect in CSS pixels but hands back device pixels, so
// on a Retina Mac a CANVAS-wide window captures 2*CANVAS. The page is therefore
// laid out at CANVAS/scaleFactor CSS pixels, which makes the SVG rasterize at
// exactly CANVAS device pixels -- vector-sharp, and the same file on any
// display.
async function render(window, svg) {
  const scale = screen.getPrimaryDisplay().scaleFactor || 1;
  const css = CANVAS / scale;
  const html =
    '<html><head><style>' +
    'html,body{margin:0;padding:0;background:transparent}' +
    `svg{display:block;width:${css}px;height:${css}px}` +
    '</style></head><body>' + svg + '</body></html>';
  await window.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  const image = await window.webContents.capturePage({x: 0, y: 0, width: css, height: css});
  const {width} = image.getSize();
  if (width !== CANVAS) {
    // Not fatal -- resizing still produces a usable icon -- but it means the
    // scale-factor compensation above missed, and every size below is a
    // resample of a resample. Worth knowing about rather than shipping quietly.
    console.warn(`  captured ${width}px, expected ${CANVAS}px; resizing`);
    return image.resize({width: CANVAS, height: CANVAS, quality: 'best'}).toPNG();
  }
  return image.toPNG();
}

// The master is downscaled with nativeImage rather than re-rendered per size:
// the artwork is flat shapes with no hairlines, so a high-quality resample and
// a fresh rasterization are indistinguishable, and this keeps the whole build
// to one render per icon.
// The same artwork again as a plain PNG, because .icns is a packaging format
// that Electron cannot read back: nativeImage.createFromPath() returns an empty
// image for every .icns (and .ico) handed to it, so anything set from JS at
// runtime -- app.dock.setIcon, BrowserWindow's `icon` -- needs this file
// instead. The .icns is still what a bundle on disk gets.
function writePng(name, masterPng, outDir) {
  const {nativeImage} = require('electron');
  const resized = nativeImage.createFromBuffer(masterPng)
      .resize({width: RUNTIME_PNG_SIZE, height: RUNTIME_PNG_SIZE, quality: 'best'});
  fs.writeFileSync(path.join(outDir, `${name}.png`), resized.toPNG());
}

function writeIcns(name, masterPng, outDir) {
  const {nativeImage} = require('electron');
  const master = nativeImage.createFromBuffer(masterPng);
  const iconset = fs.mkdtempSync(path.join(os.tmpdir(), `${name}-`)) + '.iconset';
  fs.mkdirSync(iconset, {recursive: true});
  try {
    for (const {size, names} of ICONSET) {
      const png = size === CANVAS ?
        masterPng :
        master.resize({width: size, height: size, quality: 'best'}).toPNG();
      for (const file of names) {
        fs.writeFileSync(path.join(iconset, file), png);
      }
    }
    const icns = path.join(outDir, `${name}.icns`);
    const result = spawnSync('/usr/bin/iconutil', ['-c', 'icns', iconset, '-o', icns], {
      encoding: 'utf8',
    });
    if (result.status !== 0) {
      throw new Error(`iconutil failed for ${name}: ${result.stderr || result.stdout}`);
    }
  } finally {
    fs.rmSync(iconset, {recursive: true, force: true});
  }
}

app.disableHardwareAcceleration();
app.whenReady()
    .then(main)
    .then(() => app.exit(0))
    .catch((error) => {
      console.error(error);
      app.exit(1);
    });
