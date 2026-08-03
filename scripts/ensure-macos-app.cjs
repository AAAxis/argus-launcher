const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const sourceApp = path.join(root, 'node_modules/electron/dist/Electron.app');
const targetApp = path.join(os.homedir(), 'Applications/Argus Launcher.app');
const targetContents = path.join(targetApp, 'Contents');
const targetResources = path.join(targetContents, 'Resources');
const plistPath = path.join(targetContents, 'Info.plist');
const iconSource = path.join(root, 'assets/app.icns');
const iconTarget = path.join(targetResources, 'app.icns');

function xmlEscape(value) {
  return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
}

function replacePlistString(plist, key, value) {
  const escaped = xmlEscape(value);
  const pattern = new RegExp(`(<key>${key}</key>\\s*<string>)([^<]*)(</string>)`);
  if (pattern.test(plist)) {
    return plist.replace(pattern, `$1${escaped}$3`);
  }
  return plist.replace('</dict>', `<key>${key}</key><string>${escaped}</string>\n</dict>`);
}

// LaunchServices decides who handles argus:// from CFBundleURLTypes in the
// bundle's Info.plist -- app.setAsDefaultProtocolClient() alone does not
// register the scheme on macOS. Without this the deep link silently goes
// nowhere, which looks exactly like a broken button.
//
// This is an array of dicts, which replacePlistString cannot express, so it
// gets its own writer. Replaces any existing block so re-runs stay idempotent.
function setPlistUrlScheme(plist, {name, scheme}) {
  const block = [
    '<key>CFBundleURLTypes</key>',
    '<array>',
    '  <dict>',
    `    <key>CFBundleURLName</key><string>${xmlEscape(name)}</string>`,
    '    <key>CFBundleTypeRole</key><string>Viewer</string>',
    '    <key>CFBundleURLSchemes</key>',
    `    <array><string>${xmlEscape(scheme)}</string></array>`,
    '  </dict>',
    '</array>',
  ].join('\n');

  const existing = /<key>CFBundleURLTypes<\/key>\s*<array>[\s\S]*?<\/array>/;
  if (existing.test(plist)) {
    return plist.replace(existing, block);
  }
  // Append to the ROOT dict, which is the last </dict> before </plist>.
  // Electron's plist nests dicts inside CFBundleDocumentTypes, so a plain
  // replace('</dict>', ...) lands inside a child and LaunchServices never sees
  // the key. (replacePlistString has the same latent flaw, but every key it
  // writes already exists, so it never reaches its fallback.)
  const rootClose = /<\/dict>\s*<\/plist>\s*$/;
  if (!rootClose.test(plist)) {
    throw new Error('Info.plist does not end with </dict></plist> -- refusing to guess where the root dict ends');
  }
  return plist.replace(rootClose, `${block}\n</dict>\n</plist>\n`);
}

if (process.platform !== 'darwin') {
  process.exit(0);
}

if (!fs.existsSync(sourceApp)) {
  throw new Error(`Electron app not found at ${sourceApp}`);
}

fs.rmSync(targetApp, {recursive: true, force: true});
fs.mkdirSync(path.dirname(targetApp), {recursive: true});
fs.cpSync(sourceApp, targetApp, {recursive: true, verbatimSymlinks: true});

let plist = fs.readFileSync(plistPath, 'utf8');
plist = replacePlistString(plist, 'CFBundleName', 'Argus Launcher');
plist = replacePlistString(plist, 'CFBundleDisplayName', 'Argus Launcher');
plist = replacePlistString(plist, 'CFBundleIdentifier', 'com.argys.anty');
plist = replacePlistString(plist, 'CFBundleIconFile', 'app');
plist = setPlistUrlScheme(plist, {name: 'com.argys.anty.deeplink', scheme: 'argus'});
fs.writeFileSync(plistPath, plist);

if (fs.existsSync(iconSource)) {
  fs.mkdirSync(targetResources, {recursive: true});
  fs.copyFileSync(iconSource, iconTarget);
}

console.log(targetApp);
