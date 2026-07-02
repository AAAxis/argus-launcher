const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const sourceApp = path.join(root, 'node_modules/electron/dist/Electron.app');
const targetApp = path.join(os.homedir(), 'Applications/Argys Anty.app');
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
plist = replacePlistString(plist, 'CFBundleName', 'Argys Anty');
plist = replacePlistString(plist, 'CFBundleDisplayName', 'Argys Anty');
plist = replacePlistString(plist, 'CFBundleIdentifier', 'com.argys.anty');
plist = replacePlistString(plist, 'CFBundleIconFile', 'app');
fs.writeFileSync(plistPath, plist);

if (fs.existsSync(iconSource)) {
  fs.mkdirSync(targetResources, {recursive: true});
  fs.copyFileSync(iconSource, iconTarget);
}

console.log(targetApp);
