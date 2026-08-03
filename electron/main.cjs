const {app, BrowserWindow, dialog, ipcMain, nativeImage, shell} = require('electron');
const {autoUpdater} = require('electron-updater');
const {spawn, spawnSync} = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const https = require('node:https');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const {pathToFileURL} = require('node:url');

app.setName('Argus Launcher');
app.setAboutPanelOptions({
  applicationName: 'Argus Launcher',
  applicationVersion: app.getVersion(),
  credits: 'Developed by Dmitry Polskoy\nhttps://www.linkedin.com/in/dmitry-polskoy-a46103177/',
  website: 'https://www.linkedin.com/in/dmitry-polskoy-a46103177/',
});

// Mirrors chrome/browser/argus/argus_fingerprint.cc's kDefaults table so a
// proxy's country resolves to the same timezone/language/geo the in-app
// fingerprint system would pick. Keyed by lowercase ISO-3166-1 alpha-2 code.
const COUNTRY_DEFAULTS = {
  us: {timezone: 'America/New_York', language: 'en-US', latitude: 40.7128, longitude: -74.0060},
  ca: {timezone: 'America/Toronto', language: 'en-CA', latitude: 43.6532, longitude: -79.3832},
  gb: {timezone: 'Europe/London', language: 'en-GB', latitude: 51.5074, longitude: -0.1278},
  ie: {timezone: 'Europe/Dublin', language: 'en-IE', latitude: 53.3498, longitude: -6.2603},
  au: {timezone: 'Australia/Sydney', language: 'en-AU', latitude: -33.8688, longitude: 151.2093},
  nz: {timezone: 'Pacific/Auckland', language: 'en-NZ', latitude: -36.8485, longitude: 174.7633},
  es: {timezone: 'Europe/Madrid', language: 'es-ES', latitude: 40.4168, longitude: -3.7038},
  mx: {timezone: 'America/Mexico_City', language: 'es-MX', latitude: 19.4326, longitude: -99.1332},
  ar: {timezone: 'America/Argentina/Buenos_Aires', language: 'es-AR', latitude: -34.6037, longitude: -58.3816},
  co: {timezone: 'America/Bogota', language: 'es-CO', latitude: 4.7110, longitude: -74.0721},
  br: {timezone: 'America/Sao_Paulo', language: 'pt-BR', latitude: -23.5558, longitude: -46.6396},
  pt: {timezone: 'Europe/Lisbon', language: 'pt-PT', latitude: 38.7223, longitude: -9.1393},
  fr: {timezone: 'Europe/Paris', language: 'fr-FR', latitude: 48.8566, longitude: 2.3522},
  de: {timezone: 'Europe/Berlin', language: 'de-DE', latitude: 52.5200, longitude: 13.4050},
  at: {timezone: 'Europe/Vienna', language: 'de-AT', latitude: 48.2082, longitude: 16.3738},
  ch: {timezone: 'Europe/Zurich', language: 'de-CH', latitude: 47.3769, longitude: 8.5417},
  nl: {timezone: 'Europe/Amsterdam', language: 'nl-NL', latitude: 52.3676, longitude: 4.9041},
  be: {timezone: 'Europe/Brussels', language: 'nl-BE', latitude: 50.8503, longitude: 4.3517},
  it: {timezone: 'Europe/Rome', language: 'it-IT', latitude: 41.9028, longitude: 12.4964},
  pl: {timezone: 'Europe/Warsaw', language: 'pl-PL', latitude: 52.2297, longitude: 21.0122},
  cz: {timezone: 'Europe/Prague', language: 'cs-CZ', latitude: 50.0755, longitude: 14.4378},
  se: {timezone: 'Europe/Stockholm', language: 'sv-SE', latitude: 59.3293, longitude: 18.0686},
  no: {timezone: 'Europe/Oslo', language: 'nb-NO', latitude: 59.9139, longitude: 10.7522},
  dk: {timezone: 'Europe/Copenhagen', language: 'da-DK', latitude: 55.6761, longitude: 12.5683},
  fi: {timezone: 'Europe/Helsinki', language: 'fi-FI', latitude: 60.1699, longitude: 24.9384},
  ru: {timezone: 'Europe/Moscow', language: 'ru-RU', latitude: 55.7558, longitude: 37.6173},
  ua: {timezone: 'Europe/Kyiv', language: 'uk-UA', latitude: 50.4501, longitude: 30.5234},
  tr: {timezone: 'Europe/Istanbul', language: 'tr-TR', latitude: 41.0082, longitude: 28.9784},
  il: {timezone: 'Asia/Jerusalem', language: 'he-IL', latitude: 31.7683, longitude: 35.2137},
  ae: {timezone: 'Asia/Dubai', language: 'ar-AE', latitude: 25.2048, longitude: 55.2708},
  in: {timezone: 'Asia/Kolkata', language: 'en-IN', latitude: 28.6139, longitude: 77.2090},
  sg: {timezone: 'Asia/Singapore', language: 'en-SG', latitude: 1.3521, longitude: 103.8198},
  jp: {timezone: 'Asia/Tokyo', language: 'ja-JP', latitude: 35.6762, longitude: 139.6503},
  kr: {timezone: 'Asia/Seoul', language: 'ko-KR', latitude: 37.5665, longitude: 126.9780},
  hk: {timezone: 'Asia/Hong_Kong', language: 'zh-HK', latitude: 22.3193, longitude: 114.1694},
  tw: {timezone: 'Asia/Taipei', language: 'zh-TW', latitude: 25.0330, longitude: 121.5654},
  th: {timezone: 'Asia/Bangkok', language: 'th-TH', latitude: 13.7563, longitude: 100.5018},
  vn: {timezone: 'Asia/Ho_Chi_Minh', language: 'vi-VN', latitude: 10.8231, longitude: 106.6297},
  id: {timezone: 'Asia/Jakarta', language: 'id-ID', latitude: -6.2088, longitude: 106.8456},
  ph: {timezone: 'Asia/Manila', language: 'en-PH', latitude: 14.5995, longitude: 120.9842},
  za: {timezone: 'Africa/Johannesburg', language: 'en-ZA', latitude: -26.2041, longitude: 28.0473},
};

// Resolves a profile's effective timezone: an explicit non-"Auto" preset wins,
// otherwise it's derived from the assigned proxy's country so the reported
// timezone always matches the proxy's apparent location.
function resolveTimezone(fingerprintTimezone, proxy) {
  if (fingerprintTimezone && fingerprintTimezone !== 'Auto from proxy') {
    return fingerprintTimezone;
  }
  const code = (proxy?.country_code || '').toLowerCase();
  return COUNTRY_DEFAULTS[code]?.timezone || null;
}

function resolveLanguage(fingerprintLanguage, proxy) {
  if (fingerprintLanguage && fingerprintLanguage !== 'Auto from proxy') {
    return fingerprintLanguage;
  }
  const code = (proxy?.country_code || '').toLowerCase();
  return COUNTRY_DEFAULTS[code]?.language || null;
}

function appIconPath() {
  const candidates = [
    path.join(__dirname, '../assets/app.icns'),
    '/Applications/Argys Browser.app/Contents/Resources/app.icns',
    '/Applications/Argus.app/Contents/Resources/app.icns',
    path.join(app.getPath('home'), 'argus-browser/out/Release-dmg/Argus.app/Contents/Resources/app.icns'),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) || '';
}

function settingsPath() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function readSettings() {
  try {
    return JSON.parse(fs.readFileSync(settingsPath(), 'utf8'));
  } catch {
    return {};
  }
}

function writeSettings(settings) {
  fs.mkdirSync(path.dirname(settingsPath()), {recursive: true});
  fs.writeFileSync(settingsPath(), JSON.stringify(settings, null, 2));
}

function browserAppPath() {
  const storedBrowserAppPath = readSettings().browserAppPath || process.env.ARGUS_BROWSER_APP || '';
  if (process.platform === 'win32') {
    // Windows should prefer the rebuilt managed browser resource over any
    // stale saved browser path so older Argus builds do not keep overriding
    // the current anonymous browser package forever.
    return managedBrowserAppPath() ||
      bundledBrowserAppPath() ||
      storedBrowserAppPath;
  }
  return storedBrowserAppPath ||
    managedBrowserAppPath() ||
    bundledBrowserAppPath() ||
    '/Applications/Argys Browser.app';
}

function managedBrowserRoot() {
  return path.join(app.getPath('userData'), 'Browser');
}

// The active managed-browser build lives in its own "v-<buildId>" directory
// rather than being extracted directly into managedBrowserRoot(). A user
// routinely has dozens of profile chrome.exe processes running out of that
// install at once, and Windows will not let an in-place delete-and-overwrite
// touch DLLs/EXEs those processes still have open -- the previous direct-
// overwrite approach silently failed under load and left old, unpatched
// binaries running with no visible error (see ensureBrowserResource's catch
// block). A fresh build now gets its own directory instead, so installing it
// never has to touch files a running process might be holding.
function managedBrowserCurrentPointerPath() {
  return path.join(managedBrowserRoot(), '.argus-browser-current');
}

function managedBrowserVersionedDir(buildId) {
  const safeId = String(buildId || 'build').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40) || 'build';
  return path.join(managedBrowserRoot(), `v-${safeId}`);
}

function readManagedBrowserCurrentDir() {
  try {
    const name = fs.readFileSync(managedBrowserCurrentPointerPath(), 'utf8').trim();
    return name ? path.join(managedBrowserRoot(), name) : '';
  } catch {
    return '';
  }
}

function writeManagedBrowserCurrentDir(dir) {
  try {
    fs.writeFileSync(managedBrowserCurrentPointerPath(), path.basename(dir));
  } catch {
    // Best effort -- worst case the next resolve falls back to scanning
    // managedBrowserRoot() directly instead of the versioned directory.
  }
}

// Removes every managed-browser build directory except the current one.
// Best-effort per directory: one still backing a running profile window has
// its files locked by Windows and rmSync throws for just that entry, which is
// caught and skipped -- it gets swept on a later call once nothing running
// still references it, instead of blocking or corrupting today's install.
function pruneStaleManagedBrowserDirs() {
  const root = managedBrowserRoot();
  const currentDir = readManagedBrowserCurrentDir();
  let entries;
  try {
    entries = fs.readdirSync(root, {withFileTypes: true});
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith('v-')) {
      continue;
    }
    const fullPath = path.join(root, entry.name);
    if (fullPath === currentDir) {
      continue;
    }
    try {
      fs.rmSync(fullPath, {recursive: true, force: true});
    } catch {
      // Still in use by a running profile process -- try again next time.
    }
  }
}

function findFirstMatching(root, predicate, maxDepth = 4) {
  if (!root || maxDepth < 0 || !fs.existsSync(root)) {
    return '';
  }
  let entries = [];
  try {
    entries = fs.readdirSync(root, {withFileTypes: true});
  } catch {
    return '';
  }
  for (const entry of entries) {
    const entryPath = path.join(root, entry.name);
    if (predicate(entryPath, entry)) {
      return entryPath;
    }
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.endsWith('.app')) {
      continue;
    }
    const found = findFirstMatching(path.join(root, entry.name), predicate, maxDepth - 1);
    if (found) {
      return found;
    }
  }
  return '';
}

function managedBrowserAppPath() {
  // Prefer the versioned directory the last successful install pointed at;
  // fall back to scanning managedBrowserRoot() directly for installs made
  // before this directory-per-build scheme existed.
  const currentDir = readManagedBrowserCurrentDir();
  const root = currentDir && fs.existsSync(currentDir) ? currentDir : managedBrowserRoot();
  const candidates = process.platform === 'darwin' ? [
    path.join(root, 'Argys Browser.app'),
    path.join(root, 'Argus.app'),
  ] : process.platform === 'win32' ? [
    path.join(root, 'Argys Browser.exe'),
    path.join(root, 'Argus.exe'),
    path.join(root, 'chrome.exe'),
  ] : [
    path.join(root, 'argys-browser'),
  ];
  const directMatch = candidates.find((candidate) => fs.existsSync(appExecutable(candidate)));
  if (directMatch) {
    return directMatch;
  }
  if (process.platform === 'darwin') {
    return findFirstMatching(root, (entryPath, entry) =>
      entry.isDirectory() && entry.name.endsWith('.app') && fs.existsSync(appExecutable(entryPath)));
  }
  if (process.platform === 'win32') {
    return findFirstMatching(root, (entryPath, entry) =>
      entry.isFile() && /^(arg(us|ys).*browser|chrome)\.exe$/i.test(entry.name));
  }
  return findFirstMatching(root, (entryPath, entry) =>
    entry.isFile() && /arg(us|ys).*browser/i.test(entry.name) && fs.existsSync(entryPath));
}

function bundledBrowserRoot() {
  return app.isPackaged ?
    path.join(process.resourcesPath, 'browser') :
    path.join(__dirname, '../bundled-browser');
}

function bundledBrowserAppPath() {
  const root = bundledBrowserRoot();
  const candidates = process.platform === 'darwin' ? [
    path.join(root, 'mac', 'Argys Browser.app'),
    path.join(root, 'mac', 'Argus.app'),
    path.join(root, 'Argys Browser.app'),
    path.join(root, 'Argus.app'),
  ] : process.platform === 'win32' ? [
    path.join(root, 'win', 'Argys Browser.exe'),
    path.join(root, 'win', 'Argus.exe'),
    path.join(root, 'Argys Browser.exe'),
    path.join(root, 'Argus.exe'),
  ] : [
    path.join(root, 'linux', 'argys-browser'),
    path.join(root, 'argys-browser'),
  ];
  return candidates.find((candidate) => fs.existsSync(appExecutable(candidate))) || '';
}

function browserAppCandidates(preferredAppPath) {
  const candidates = [
    managedBrowserAppPath(),
    bundledBrowserAppPath(),
    preferredAppPath,
    '/Applications/Argys Browser.app',
    // The DMG's staged bundle is named "Argus.app" (matches its internal
    // CFBundleName), so a drag-to-Applications install lands here instead of
    // the "Argys Browser" name the launcher defaulted to.
    '/Applications/Argus.app',
  ];
  return [...new Set(candidates.filter(Boolean))];
}

let mainWindow = null;

const UPDATE_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;
const RESOURCE_BASE_URL = (process.env.ARGUS_RESOURCE_BASE_URL ||
  'https://pub-a6c0e96f900b4b698762591fddd497aa.r2.dev/resources').replace(/\/$/, '');
const allowUpdaterInDev = process.env.ARGUS_FORCE_UPDATER === '1';
const updateProvider = app.isPackaged || allowUpdaterInDev || process.env.ARGUS_UPDATE_FEED_URL ?
  'generic' :
  'disabled';
const updateState = {
  status: app.isPackaged || allowUpdaterInDev ? 'idle' : 'disabled',
  currentVersion: app.getVersion(),
  updateInfo: null,
  progress: null,
  downloaded: false,
  error: null,
};
const resourceState = {
  browserStatus: 'idle',
  browserVersion: '',
  browserPath: managedBrowserAppPath(),
  progress: null,
  error: null,
};
const apiState = {
  status: 'starting',
  port: 39219,
  url: 'http://127.0.0.1:39219',
  error: null,
};

function serializableUpdateInfo(info) {
  if (!info) {
    return null;
  }
  return {
    version: info.version || '',
    releaseName: info.releaseName || '',
    releaseDate: info.releaseDate || '',
    releaseNotes: info.releaseNotes || '',
  };
}

function publicUpdateState() {
  return {
    ...updateState,
    canCheck: app.isPackaged || allowUpdaterInDev,
    provider: updateProvider,
  };
}

function errorDetail(error) {
  if (!(error instanceof Error)) {
    return String(error);
  }
  const pathPart = error.path ? ` (${error.path})` : '';
  return `${error.message}${pathPart}${error.stack ? `\n\n${error.stack}` : ''}`;
}

function isMissingUpdateFeedError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return /(404|not_found|object not found)/i.test(message) &&
    (/latest-(mac|linux)\.yml|latest\.yml/i.test(message) ||
      /releases\.atom|\/releases\/latest/i.test(message));
}

function applyUpdateError(error, {manual = false} = {}) {
  if (isMissingUpdateFeedError(error)) {
    updateState.status = 'not-available';
    updateState.updateInfo = null;
    updateState.downloaded = false;
    updateState.progress = null;
    updateState.error = 'No update has been published yet.';
    return;
  }
  updateState.status = manual ? 'error' : 'idle';
  updateState.error = error instanceof Error ? error.message : String(error);
}

function broadcastUpdateState() {
  const snapshot = publicUpdateState();
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('argus:update-state', snapshot);
  }
  return snapshot;
}

function publicResourceState() {
  return {
    ...resourceState,
    browserPath: managedBrowserAppPath() || bundledBrowserAppPath() || '',
  };
}

function broadcastResourceState() {
  const snapshot = publicResourceState();
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('argus:resource-state', snapshot);
  }
  return snapshot;
}

function publicApiState() {
  return {...apiState};
}

function broadcastApiState() {
  const snapshot = publicApiState();
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('argus:api-state', snapshot);
  }
  return snapshot;
}

function browserResourceKey() {
  const platform = process.platform === 'darwin' ? 'mac' :
    process.platform === 'win32' ? 'win' :
    'linux';
  return `${platform}-${process.arch}`;
}

function browserResourceManifestUrl() {
  return `${RESOURCE_BASE_URL}/browser/latest-${browserResourceKey()}.json`;
}

function parseJsonWithBom(raw) {
  return JSON.parse(raw.replace(/^\uFEFF/, ''));
}

function downloadJson(url) {
  return new Promise((resolve, reject) => {
    let raw = '';
    https.get(url, {headers: {'User-Agent': 'ArgysAnty/1.0'}}, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`HTTP ${res.statusCode} fetching ${url}`));
        return;
      }
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        raw += chunk;
      });
      res.on('end', () => {
        try {
          resolve(parseJsonWithBom(raw));
        } catch (error) {
          reject(error);
        }
      });
      res.on('error', reject);
    }).on('error', reject);
  });
}

function downloadFile(url, destinationPath) {
  return new Promise((resolve, reject) => {
    ensureDirectoryPath(path.dirname(destinationPath));
    const file = fs.createWriteStream(destinationPath);
    const request = https.get(url, {headers: {'User-Agent': 'ArgysAnty/1.0'}}, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        file.close(() => fs.rmSync(destinationPath, {force: true}));
        resolve(downloadFile(new URL(res.headers.location, url).toString(), destinationPath));
        return;
      }
      if (res.statusCode !== 200) {
        file.close(() => fs.rmSync(destinationPath, {force: true}));
        res.resume();
        reject(new Error(`HTTP ${res.statusCode} fetching ${url}`));
        return;
      }
      const total = Number(res.headers['content-length']) || 0;
      let transferred = 0;
      res.on('data', (chunk) => {
        transferred += chunk.length;
        resourceState.progress = {
          percent: total ? Math.round((transferred / total) * 1000) / 10 : 0,
          transferred,
          total,
        };
        broadcastResourceState();
      });
      res.pipe(file);
      file.on('finish', () => file.close(resolve));
      res.on('error', reject);
    });
    request.on('error', reject);
    file.on('error', reject);
  });
}

function fileSha512Base64(filePath) {
  return crypto.createHash('sha512').update(fs.readFileSync(filePath)).digest('base64');
}

// Marks which build is currently installed under managedBrowserRoot() --
// resolveBrowserExecutable() alone can only tell us *some* browser exists
// there, never whether it's the build currently published, so a stale
// managed install from months ago would otherwise be treated as "ready"
// forever and never get replaced.
//
// This is keyed on the manifest's sha512, not its version: every published
// manifest observed so far (mac-arm64 and win-x64, built hours apart) reports
// the same literal "1.0.0" -- whatever publishes these manifests doesn't
// actually bump the version field per build. sha512 is the only field that
// reliably changes when the archive's contents change, so it's the only safe
// staleness signal here.
function managedBrowserVersionPath() {
  return path.join(managedBrowserRoot(), '.argus-browser-build');
}

function readManagedBrowserVersion() {
  try {
    return fs.readFileSync(managedBrowserVersionPath(), 'utf8').trim();
  } catch {
    return '';
  }
}

function writeManagedBrowserVersion(manifest) {
  try {
    fs.writeFileSync(managedBrowserVersionPath(), String(manifest?.sha512 || manifest?.version || ''));
  } catch {
    // Best effort -- a missing/unwritable marker just means the next check
    // re-verifies against the manifest instead of trusting a cached build.
  }
}

function extractBrowserArchive(archivePath, destinationDir) {
  fs.rmSync(destinationDir, {recursive: true, force: true});
  ensureDirectoryPath(destinationDir);
  if (process.platform === 'darwin') {
    const result = spawnSync('/usr/bin/ditto', ['-x', '-k', archivePath, destinationDir], {encoding: 'utf8'});
    if (result.status !== 0) {
      throw new Error(result.stderr || result.stdout || `ditto exited ${result.status}`);
    }
    return;
  }
  if (process.platform === 'win32') {
    const result = spawnSync('powershell.exe', [
      '-NoProfile',
      '-Command',
      `Expand-Archive -LiteralPath ${JSON.stringify(archivePath)} -DestinationPath ${JSON.stringify(destinationDir)} -Force`,
    ], {encoding: 'utf8'});
    if (result.status !== 0) {
      throw new Error(result.stderr || result.stdout || `Expand-Archive exited ${result.status}`);
    }
    return;
  }
  unzipBufferTo(fs.readFileSync(archivePath), destinationDir);
}

async function ensureBrowserResource({manual = false} = {}) {
  if (['checking', 'downloading', 'installing'].includes(resourceState.browserStatus)) {
    return publicResourceState();
  }
  const resolved = resolveBrowserExecutable();
  const managedPath = managedBrowserAppPath();
  const usingManaged = Boolean(resolved && managedPath && resolved.appPath === managedPath);
  // A bundled browser proves the launcher can start offline, but it does not
  // prove the browser is current. Always check the published browser manifest
  // when possible and install the managed copy when its build marker differs.
  // If the network/manifest check fails, the catch block below falls back to
  // any resolved browser so existing installs still launch offline.
  try {
    resourceState.browserStatus = 'checking';
    resourceState.error = null;
    resourceState.progress = null;
    broadcastResourceState();
    const manifest = await downloadJson(browserResourceManifestUrl());
    const manifestBuildId = String(manifest.sha512 || manifest.version || '');
    if (usingManaged && manifestBuildId && readManagedBrowserVersion() === manifestBuildId) {
      // Already installed and matches the latest published build -- nothing to do.
      resourceState.browserStatus = 'ready';
      resourceState.browserPath = resolved.appPath;
      resourceState.browserVersion = manifest.version || '';
      resourceState.error = null;
      resourceState.progress = null;
      return broadcastResourceState();
    }
    const archiveUrl = new URL(manifest.url, browserResourceManifestUrl()).toString();
    const archivePath = path.join(app.getPath('temp'), `argys-browser-${browserResourceKey()}-${Date.now()}.zip`);
    resourceState.browserStatus = 'downloading';
    resourceState.browserVersion = manifest.version || '';
    broadcastResourceState();
    await downloadFile(archiveUrl, archivePath);
    if (manifest.sha512 && fileSha512Base64(archivePath) !== manifest.sha512) {
      throw new Error('Downloaded browser archive checksum does not match manifest.');
    }
    resourceState.browserStatus = 'installing';
    broadcastResourceState();
    // Extract into a fresh directory of its own (named for this build) rather
    // than overwriting managedBrowserRoot() in place: any currently-running
    // profile windows have the previous build's DLLs/EXEs open, and Windows
    // refuses to delete those out from under them. A new directory means this
    // install never has to touch a file another process might be holding.
    const versionedDir = managedBrowserVersionedDir(manifestBuildId);
    extractBrowserArchive(archivePath, versionedDir);
    fs.rmSync(archivePath, {force: true});
    writeManagedBrowserCurrentDir(versionedDir);
    const installedBrowserPath = managedBrowserAppPath();
    if (!installedBrowserPath) {
      throw new Error(`Downloaded browser did not contain a supported app for ${browserResourceKey()}.`);
    }
    writeManagedBrowserVersion(manifest);
    // Best-effort cleanup of the previous build(s). Anything still backing a
    // running profile simply fails to delete and is retried on a later check.
    pruneStaleManagedBrowserDirs();
    resourceState.browserStatus = 'ready';
    resourceState.browserPath = installedBrowserPath;
    resourceState.progress = null;
    resourceState.error = null;
  } catch (error) {
    if (resolved) {
      // Refresh check failed (e.g. offline) but a previously-installed
      // browser still resolves -- launch must keep working without network,
      // so fall back to what's already on disk instead of erroring out.
      resourceState.browserStatus = 'ready';
      resourceState.browserPath = resolved.appPath;
      resourceState.error = null;
      resourceState.progress = null;
      return broadcastResourceState();
    }
    resourceState.browserStatus = manual ? 'error' : 'idle';
    resourceState.error = errorDetail(error);
  }
  return broadcastResourceState();
}

async function checkForUpdates({manual = false} = {}) {
  if (!app.isPackaged && !allowUpdaterInDev) {
    updateState.status = 'disabled';
    updateState.error = 'Updates are available only in packaged builds.';
    return broadcastUpdateState();
  }
  try {
    updateState.status = 'checking';
    updateState.error = null;
    updateState.progress = null;
    broadcastUpdateState();
    await autoUpdater.checkForUpdates();
  } catch (error) {
    applyUpdateError(error, {manual});
    broadcastUpdateState();
  }
  return publicUpdateState();
}

async function downloadUpdate() {
  if (!updateState.updateInfo) {
    updateState.status = 'idle';
    updateState.error = 'No available update has been found yet.';
    return broadcastUpdateState();
  }
  try {
    updateState.status = 'downloading';
    updateState.error = null;
    updateState.progress = null;
    updateState.downloaded = false;
    broadcastUpdateState();
    await autoUpdater.downloadUpdate();
  } catch (error) {
    updateState.status = 'error';
    updateState.error = error instanceof Error ? error.message : String(error);
    broadcastUpdateState();
  }
  return publicUpdateState();
}

function configureAutoUpdater() {
  // Download as soon as an update is found -- previously required opening
  // Settings and clicking Download manually every time. Install still stays
  // manual (autoInstallOnAppQuit false) so it never silently restarts and
  // closes the user's browser sessions without a "Restart & install" click.
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.allowPrerelease = process.env.ARGUS_UPDATE_PRERELEASE === '1';

  if (process.env.ARGUS_UPDATE_FEED_URL) {
    autoUpdater.setFeedURL({
      provider: 'generic',
      url: process.env.ARGUS_UPDATE_FEED_URL,
    });
  }

  autoUpdater.on('checking-for-update', () => {
    updateState.status = 'checking';
    updateState.error = null;
    broadcastUpdateState();
  });
  autoUpdater.on('update-available', (info) => {
    updateState.status = 'available';
    updateState.updateInfo = serializableUpdateInfo(info);
    updateState.downloaded = false;
    updateState.progress = null;
    updateState.error = null;
    broadcastUpdateState();
  });
  autoUpdater.on('update-not-available', (info) => {
    updateState.status = 'not-available';
    updateState.updateInfo = serializableUpdateInfo(info);
    updateState.downloaded = false;
    updateState.progress = null;
    updateState.error = null;
    broadcastUpdateState();
  });
  autoUpdater.on('download-progress', (progress) => {
    updateState.status = 'downloading';
    updateState.progress = {
      percent: progress.percent || 0,
      bytesPerSecond: progress.bytesPerSecond || 0,
      transferred: progress.transferred || 0,
      total: progress.total || 0,
    };
    updateState.error = null;
    broadcastUpdateState();
  });
  autoUpdater.on('update-downloaded', (info) => {
    updateState.status = 'downloaded';
    updateState.updateInfo = serializableUpdateInfo(info) || updateState.updateInfo;
    updateState.downloaded = true;
    updateState.progress = null;
    updateState.error = null;
    broadcastUpdateState();
  });
  autoUpdater.on('error', (error) => {
    applyUpdateError(error, {manual: true});
    broadcastUpdateState();
  });

  if (app.isPackaged || allowUpdaterInDev) {
    // A short delay so the first check doesn't compete with the window's own
    // startup rendering/network calls, but short enough that it still reads
    // as "automatic" rather than requiring a manual check.
    setTimeout(() => {
      void checkForUpdates({manual: false});
    }, 3000);
    setInterval(() => {
      void checkForUpdates({manual: false});
    }, UPDATE_CHECK_INTERVAL_MS);
  }
}

function createWindow() {
  const icon = appIconPath();
  if (process.platform === 'darwin' && icon) {
    app.dock?.setIcon(nativeImage.createFromPath(icon));
  }
  const win = new BrowserWindow({
    title: 'Argus Launcher',
    width: 1180,
    height: 760,
    minWidth: 980,
    minHeight: 620,
    icon: icon || undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  mainWindow = win;
  win.on('closed', () => {
    if (mainWindow === win) {
      mainWindow = null;
    }
  });

  win.webContents.on('console-message', (_event, _level, message, line, sourceId) => {
    console.log(`[renderer] ${message} (${sourceId}:${line})`);
  });
  win.webContents.on('render-process-gone', (_event, details) => {
    console.log('[renderer] gone:', JSON.stringify(details));
  });

  const devUrl = process.env.VITE_DEV_SERVER_URL || 'http://127.0.0.1:5173';
  if (process.env.ARGUS_LAUNCHER_DEV === '1') {
    void win.loadURL(devUrl);
  } else {
    void win.loadFile(path.join(__dirname, '../dist/index.html'));
  }
  win.webContents.once('did-finish-load', () => {
    broadcastUpdateState();
    broadcastResourceState();
    broadcastApiState();
  });
}

function appExecutable(appPath) {
  if (appPath.endsWith('.app')) {
    const macosDir = path.join(appPath, 'Contents/MacOS');
    const candidates = [
      path.join(macosDir, 'Argys Browser'),
      path.join(macosDir, 'Argys'),
      path.join(macosDir, 'Argus'),
      path.join(macosDir, path.basename(appPath, '.app')),
    ];
    return candidates.find((candidate) => fs.existsSync(candidate)) ||
      candidates[0];
  }
  return appPath;
}

function resolveBrowserExecutable() {
  for (const appPath of browserAppCandidates(browserAppPath())) {
    const executable = appExecutable(appPath);
    if (fs.existsSync(executable)) {
      return {appPath, executable};
    }
  }
  return null;
}

function splitSwitches(raw) {
  if (!raw) {
    return [];
  }
  return raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
}

function launchSafeSwitches(raw) {
  return splitSwitches(raw).filter((switchArg) => {
    if (/^--load-extension(?:=|$)/.test(switchArg)) {
      console.warn(`Ignoring unsafe launch switch: ${switchArg}`);
      return false;
    }
    if (/^--disable-extensions-except(?:=|$)/.test(switchArg)) {
      console.warn(`Ignoring unsafe launch switch: ${switchArg}`);
      return false;
    }
    if (/^--user-data-dir(?:=|$)/.test(switchArg)) {
      console.warn(`Ignoring unsafe launch switch: ${switchArg}`);
      return false;
    }
    if (/^--profile-directory(?:=|$)/.test(switchArg)) {
      console.warn(`Ignoring unsafe launch switch: ${switchArg}`);
      return false;
    }
    return true;
  });
}

function cookieManagerSourcePath() {
  const candidate = path.join(__dirname, '../extensions/cookie-manager');
  return isLoadableExtensionDir(candidate) ? candidate : '';
}

// onlinesim-sms is bundled for every profile regardless of proxy mode, unless
// the Extensions tab's global toggle turns it off.
function bundledExtensionPaths(payload) {
  if (payload.enableSmsActivate === false) {
    return [];
  }
  const bundled = [
    {name: 'SMSActivate', source: path.join(__dirname, '../extensions/onlinesim-sms')},
  ];
  return bundled
      .map((entry) => materializeBundledExtension(payload, entry.name, entry.source))
      .filter(Boolean);
}

function materializeBundledExtension(payload, name, sourceDir) {
  if (!payload?.userDataDir) {
    return '';
  }
  if (!isLoadableExtensionDir(sourceDir)) {
    console.warn(
        `Skipping bundled extension "${name}": source folder is missing or has no valid ` +
        `manifest.json (${sourceDir}). Profile launch will continue without it.`);
    return '';
  }
  const extensionDir = path.join(payload.userDataDir, 'ArgysBundled', name);
  fs.rmSync(extensionDir, {recursive: true, force: true});
  copyDirectoryContents(sourceDir, extensionDir);
  if (!isLoadableExtensionDir(extensionDir)) {
    console.warn(
        `Skipping bundled extension "${name}": copy to ${extensionDir} did not produce a ` +
        `readable manifest.json. Profile launch will continue without it.`);
    fs.rmSync(extensionDir, {recursive: true, force: true});
    return '';
  }
  return extensionDir;
}

const FREE_PROXY_SOURCE_PATH = path.join(__dirname, '../extensions/foxywall');

// Chrome caches an unpacked (--load-extension) service worker's script body
// independently of its manifest version or file content -- reloading the
// browser against the same stable path on an already-used profile can keep
// running a stale background.js from hours earlier no matter how many times
// the source file changes or its manifest version is bumped (confirmed via
// live CDP inspection: chrome.runtime.getManifest().version reflected a fresh
// bump, but functions/consts only present in newer source were still
// undefined). Copying into a fresh, uniquely-named per-launch directory --
// same pattern as writeProfileCookieManagerExtension below -- gives Chrome a
// genuinely new extension identity every time, so it can never reuse a stale
// cached service worker.
function writeProfileFreeProxyExtension(payload) {
  if (!isLoadableExtensionDir(FREE_PROXY_SOURCE_PATH)) {
    return '';
  }
  const extensionDir = path.join(payload.userDataDir, `ArgysFreeProxy-${Date.now()}`);
  copyDirectoryContents(FREE_PROXY_SOURCE_PATH, extensionDir);
  // FoxyWall is now bundled for every profile (so its toolbar icon/manual
  // toggle is always available), but must only auto-connect on launch when
  // the user actually picked Free Proxy mode -- never for 'direct' (no proxy
  // at all) or 'assigned' (a real proxy already owns the connection; this
  // would be a second, competing proxy source). This config file is the
  // signal background.js reads before deciding whether to auto-connect.
  fs.writeFileSync(path.join(extensionDir, 'argus-config.json'), JSON.stringify({
    autoConnect: Boolean(payload.useFreeProxy),
  }));
  return extensionDir;
}

// Stale per-launch free-proxy extension copies (see writeProfileFreeProxyExtension
// above) accumulate one fresh directory per launch forever otherwise -- prune
// old ones for this profile before writing today's.
function pruneStaleFreeProxyExtensions(userDataDir) {
  let entries;
  try {
    entries = fs.readdirSync(userDataDir, {withFileTypes: true});
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isDirectory() && entry.name.startsWith('ArgysFreeProxy-')) {
      fs.rmSync(path.join(userDataDir, entry.name), {recursive: true, force: true});
    }
  }
}

// ---------------------------------------------------------------------------
// Shared extensions (team-synced, see SharedExtension in src/types.ts).
// Cloud state only ever holds a *reference* (a webstore id, or a Storage URL
// for a zipped local folder) -- never the extension's actual files, since
// those live on whichever machine added them. Each team member materializes
// their own local copy into SHARED_EXTENSIONS_ROOT the first time they use
// it, keyed by the entry's stable id so every machine ends up with the same
// on-disk layout independently.
// ---------------------------------------------------------------------------

function sharedExtensionsRoot() {
  return path.join(app.getPath('userData'), 'SharedExtensions');
}

function downloadBuffer(url, redirectsLeft = 5) {
  if (url.startsWith('data:')) {
    const match = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(url);
    if (!match) {
      return Promise.reject(new Error('Invalid inline extension package URL'));
    }
    return Promise.resolve(
        match[2] ? Buffer.from(match[3], 'base64') : Buffer.from(decodeURIComponent(match[3])));
  }
  return new Promise((resolve, reject) => {
    https.get(url, {headers: {'User-Agent': 'ArgysAnty/1.0'}}, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && redirectsLeft > 0) {
        res.resume();
        resolve(downloadBuffer(new URL(res.headers.location, url).toString(), redirectsLeft - 1));
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`HTTP ${res.statusCode} fetching ${url}`));
        return;
      }
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    }).on('error', reject);
  });
}

// A CRX file is a small header (magic + version + a length-prefixed
// signature block) directly followed by a plain ZIP -- this only needs to
// find where the header ends, never to actually parse it.
function crxZipOffset(buffer) {
  if (buffer.toString('ascii', 0, 4) !== 'Cr24') {
    throw new Error('Not a CRX file (bad magic)');
  }
  const version = buffer.readUInt32LE(4);
  if (version === 3) {
    const headerSize = buffer.readUInt32LE(8);
    return 12 + headerSize;
  }
  if (version === 2) {
    const pubKeyLen = buffer.readUInt32LE(8);
    const sigLen = buffer.readUInt32LE(12);
    return 16 + pubKeyLen + sigLen;
  }
  throw new Error(`Unsupported CRX version ${version}`);
}

function unzipBufferTo(zipBuffer, destDir) {
  fs.mkdirSync(destDir, {recursive: true});
  const tmpZip = path.join(os.tmpdir(), `argys-ext-${crypto.randomUUID()}.zip`);
  fs.writeFileSync(tmpZip, zipBuffer);
  try {
    if (process.platform === 'win32') {
      const result = spawnSync('powershell.exe', [
        '-NoProfile',
        '-Command',
        `Expand-Archive -LiteralPath ${JSON.stringify(tmpZip)} -DestinationPath ${JSON.stringify(destDir)} -Force`,
      ], {encoding: 'utf8'});
      if (result.status !== 0) {
        throw new Error(result.stderr || result.stdout || `Expand-Archive exited ${result.status}`);
      }
      return;
    }
    const unzipBin = process.platform === 'darwin' ? '/usr/bin/unzip' : 'unzip';
    const result = spawnSync(unzipBin, ['-o', '-q', tmpZip, '-d', destDir]);
    if (result.status !== 0) {
      throw new Error(`unzip failed: ${result.stderr?.toString() || result.status}`);
    }
  } finally {
    fs.rmSync(tmpZip, {force: true});
  }
}

function isDirectory(candidatePath) {
  try {
    return fs.statSync(candidatePath).isDirectory();
  } catch {
    return false;
  }
}

function ensureDirectoryPath(dirPath) {
  if (!dirPath) {
    return;
  }
  if (fs.existsSync(dirPath) && !isDirectory(dirPath)) {
    fs.renameSync(dirPath, `${dirPath}.file-${Date.now()}`);
  }
  fs.mkdirSync(dirPath, {recursive: true});
}

// Chrome's own "Manifest file is missing or unreadable" error covers both a
// missing manifest.json AND one that exists but fails to parse (truncated by
// an interrupted copy, 0 bytes, invalid JSON, etc). Checking existence alone
// (the old behavior here) let a corrupt-but-present manifest.json through
// every guard in this file and straight into --load-extension, where Chrome
// would only then discover it can't be read. Actually parsing it here is what
// lets us catch that case ourselves and skip the extension instead.
function readExtensionManifest(candidatePath) {
  try {
    const raw = fs.readFileSync(path.join(candidatePath, 'manifest.json'), 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function isLoadableExtensionDir(candidatePath) {
  return Boolean(candidatePath) &&
    isDirectory(candidatePath) &&
    readExtensionManifest(candidatePath) !== null;
}

function copyDirectoryContents(sourceDir, destDir) {
  ensureDirectoryPath(destDir);
  for (const entry of fs.readdirSync(sourceDir, {withFileTypes: true})) {
    if (entry.name === '.git') continue;
    const from = path.join(sourceDir, entry.name);
    const to = path.join(destDir, entry.name);
    try {
      copyPathRecursive(from, to, entry);
    } catch (error) {
      console.error(`Skipping extension file ${from}:`, error);
    }
  }
}

function copyPathRecursive(from, to, dirent = null) {
  const entry = dirent || fs.statSync(from);
  if (entry.isDirectory()) {
    ensureDirectoryPath(to);
    for (const child of fs.readdirSync(from, {withFileTypes: true})) {
      copyPathRecursive(path.join(from, child.name), path.join(to, child.name), child);
    }
    return;
  }
  if (entry.isFile()) {
    fs.copyFileSync(from, to);
  }
}

// Google's public CRX update endpoint -- the same one Chrome itself uses to
// fetch/update webstore extensions, so this always gets whatever the
// developer currently has published, with no re-hosting on our side.
async function downloadWebstoreExtension(extensionId, destDir) {
  const url = 'https://clients2.google.com/service/update2/crx?response=redirect' +
      '&acceptformat=crx2,crx3&prodversion=124.0.0.0' +
      `&x=id%3D${extensionId}%26installsource%3Dondemand%26uc`;
  const crxBuffer = await downloadBuffer(url);
  const zipOffset = crxZipOffset(crxBuffer);
  unzipBufferTo(crxBuffer.subarray(zipOffset), destDir);
}

async function downloadLocalSharedExtension(storageUrl, destDir) {
  const zipBuffer = await downloadBuffer(storageUrl);
  unzipBufferTo(zipBuffer, destDir);
}

// Returns the local, ready-to-load path for a shared extension, downloading
// and unpacking it into the local cache on first use. Returns '' (and lets
// the profile launch without it) rather than throwing, so one bad/offline
// shared extension never blocks the whole launch.
async function materializeSharedExtension(entry) {
  if (!entry?.id) return '';
  const destDir = path.join(sharedExtensionsRoot(), entry.id);
  if (isLoadableExtensionDir(destDir)) {
    return destDir; // Already materialized on this machine.
  }
  try {
    fs.rmSync(destDir, {recursive: true, force: true});
    if (entry.source === 'webstore' && entry.webstoreId) {
      await downloadWebstoreExtension(entry.webstoreId, destDir);
    } else if (entry.source === 'local' && entry.storageUrl) {
      await downloadLocalSharedExtension(entry.storageUrl, destDir);
    } else {
      return '';
    }
    if (!fs.existsSync(path.join(destDir, 'manifest.json'))) {
      // Some extensions (or CRXs with a nested single top-level folder) can
      // unzip one level deeper than expected -- fall back to that.
      const nested = isDirectory(destDir) ?
        fs.readdirSync(destDir, {withFileTypes: true}).find((e) => e.isDirectory()) :
        null;
      if (nested && isLoadableExtensionDir(path.join(destDir, nested.name))) {
        return path.join(destDir, nested.name);
      }
      fs.rmSync(destDir, {recursive: true, force: true});
      return '';
    }
    return destDir;
  } catch (error) {
    console.error(`Failed to materialize shared extension ${entry.id}:`, error);
    fs.rmSync(destDir, {recursive: true, force: true});
    return '';
  }
}

// Zips a locally-picked extension folder to a temp file and returns its
// bytes base64-encoded, so the renderer (which already holds the
// authenticated Supabase client) can upload it to Storage itself -- main.cjs
// never needs its own Supabase credentials.
function zipFolderToBase64(folderPath) {
  const tmpZip = path.join(os.tmpdir(), `argys-ext-upload-${crypto.randomUUID()}.zip`);
  try {
    const result = spawnSync('/usr/bin/zip', ['-r', '-q', tmpZip, '.'], {cwd: folderPath});
    if (result.status !== 0) {
      throw new Error(`zip failed: ${result.stderr?.toString() || result.status}`);
    }
    return fs.readFileSync(tmpZip).toString('base64');
  } finally {
    fs.rmSync(tmpZip, {force: true});
  }
}

function normalizeCookieUrl(cookie) {
  if (cookie.url) {
    return String(cookie.url);
  }
  const domain = String(cookie.domain || '').replace(/^\./, '');
  const pathPart = cookie.path || '/';
  return `${cookie.secure ? 'https' : 'http'}://${domain}${pathPart}`;
}

function normalizeCookie(cookie) {
  if (!cookie || typeof cookie !== 'object') {
    return null;
  }
  const name = String(cookie.name || '').trim();
  const value = String(cookie.value ?? '');
  const domain = String(cookie.domain || '').trim();
  if (!name || (!domain && !cookie.url)) {
    return null;
  }
  const normalized = {
    url: normalizeCookieUrl(cookie),
    name,
    value,
    domain: domain || undefined,
    path: cookie.path || '/',
    secure: Boolean(cookie.secure),
    httpOnly: Boolean(cookie.httpOnly || cookie.http_only),
    sameSite: cookie.sameSite || cookie.same_site || 'lax',
  };
  const expirationDate = Number(cookie.expirationDate || cookie.expiration_date || cookie.expires);
  if (Number.isFinite(expirationDate) && expirationDate > 0) {
    normalized.expirationDate = expirationDate > 10000000000 ?
      Math.floor(expirationDate / 1000) :
      expirationDate;
  }
  return normalized;
}

function parseNetscapeCookies(raw) {
  return raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'))
      .map((line) => {
        const parts = line.split('\t');
        if (parts.length < 7) {
          return null;
        }
        const [domain, , pathPart, secure, expires, name, ...valueParts] = parts;
        return normalizeCookie({
          domain,
          path: pathPart || '/',
          secure: secure.toUpperCase() === 'TRUE',
          expirationDate: Number(expires),
          name,
          value: valueParts.join('\t'),
        });
      })
      .filter(Boolean);
}

function parseCookieFile(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  return parseCookieContent(raw);
}

function parseCookieContent(raw) {
  try {
    const parsed = JSON.parse(raw);
    const list = Array.isArray(parsed) ? parsed : parsed.cookies;
    if (!Array.isArray(list)) {
      return [];
    }
    return list.map(normalizeCookie).filter(Boolean);
  } catch {
    return parseNetscapeCookies(raw);
  }
}

function cookieRawFromDataUrl(url) {
  const match = /^data:([^,]*?)(;base64)?,(.*)$/i.exec(String(url || ''));
  if (!match) {
    return null;
  }
  const [, , base64, body] = match;
  return base64 ?
    Buffer.from(body, 'base64').toString('utf8') :
    decodeURIComponent(body);
}

async function parseCookieUrl(url) {
  const inline = cookieRawFromDataUrl(url);
  if (inline !== null) {
    return parseCookieContent(inline);
  }
  const buffer = await downloadBuffer(url);
  return parseCookieContent(buffer.toString('utf8'));
}

// Writes one merged "Argys Cookie Manager" extension per launch, into the
// profile's own user-data-dir: a copy of extensions/cookie-manager's manual
// export/import UI, plus (only when this profile has a cookie file assigned)
// a seed-cookies.json the extension's own background.js auto-imports once on
// first run. Previously this shipped as two separate extensions (a shared
// "Argys Cookie Manager" plus a per-profile "Argys Cookie Seed <name>"
// generated from an inline script) -- merged so each profile shows exactly
// one cookie extension that both seeds and manages.
async function writeProfileCookieManagerExtension(payload) {
  const sourceDir = cookieManagerSourcePath();
  if (!isLoadableExtensionDir(sourceDir)) {
    console.warn(
        `Skipping Cookie Manager extension: source folder is missing or has no valid ` +
        `manifest.json (${sourceDir}). Profile launch will continue without it.`);
    return '';
  }
  const extensionDir = path.join(payload.userDataDir, 'ArgysCookieManager');
  fs.rmSync(extensionDir, {recursive: true, force: true});
  copyDirectoryContents(sourceDir, extensionDir);
  if (!isLoadableExtensionDir(extensionDir)) {
    console.warn(
        `Skipping Cookie Manager extension: copy to ${extensionDir} did not produce a ` +
        `readable manifest.json. Profile launch will continue without it.`);
    fs.rmSync(extensionDir, {recursive: true, force: true});
    return '';
  }
  // Lets the popup show which profile it's attached to (Argys Browser windows
  // are otherwise unlabeled from the extension's point of view).
  fs.writeFileSync(path.join(extensionDir, 'profile-meta.json'), JSON.stringify({
    id: payload.id || '',
    name: payload.name || '',
  }, null, 2));
  const writeSeedCookies = (cookies) => {
    if (cookies.length) {
      fs.writeFileSync(path.join(extensionDir, 'seed-cookies.json'), JSON.stringify({cookies}, null, 2));
    }
  };
  if (payload.cookieImportUrl) {
    try {
      writeSeedCookies(await parseCookieUrl(payload.cookieImportUrl));
    } catch {
      // Fall back to a local path below if one is still available.
    }
  }
  if (!fs.existsSync(path.join(extensionDir, 'seed-cookies.json')) && payload.cookieImportPath) {
    try {
      writeSeedCookies(parseCookieFile(payload.cookieImportPath));
    } catch {
      // No seed file written: the extension's own fetch() of seed-cookies.json
      // simply finds nothing and skips seeding, so this fails soft.
    }
  }
  return extensionDir;
}

function proxyArgs(proxy) {
  if (!proxy?.host || !proxy.port) {
    return [];
  }
  const scheme = proxy.type === 'socks5' ? 'socks5' : 'http';
  // Deliberately no --proxy-server here: Chromium's native SOCKS5 client can't
  // do RFC 1929 username/password auth, and a bare --proxy-server never seeds
  // the HTTP proxy auth cache either, so an authenticated proxy passed this way
  // always fails (ERR_SOCKS_CONNECTION_FAILED, or a 407 for http). Passing only
  // the --argus-proxy-* switches routes the browser through
  // ArgusProfileService::Connect(), which starts the local authenticated
  // SocksBridge and points the profile at that instead.
  const args = [
    `--argus-proxy-label=${proxy.name || `${proxy.host}:${proxy.port}`}`,
    `--argus-proxy-host=${proxy.host}`,
    `--argus-proxy-port=${proxy.port}`,
    `--argus-proxy-type=${scheme}`,
  ];
  if (proxy.username || proxy.password) {
    args.push(`--argus-proxy-user=${proxy.username || ''}`);
    args.push(`--argus-proxy-pass=${proxy.password || ''}`);
  }
  return args;
}

// The current Argus Browser build does not actually consume any of the
// --argus-proxy-* switches above -- nothing in argus-browser's command-line
// handling reads them, so on Windows (running the current rebuilt browser)
// an assigned proxy silently launches direct every time. What the browser
// *does* read on startup is its own per-profile "argus.profile_data" pref
// (ArgusProfileService::InitializeAsync in argus_profile_service.cc), which
// it also writes itself when a proxy is connected from its in-browser UI, and
// which it auto-reconnects to on every subsequent launch. Writing that same
// pref block directly into the profile's Preferences file before spawn --
// the same technique writeProfileStartupPrefs already uses for homepage/
// session-restore prefs -- is what actually wires an assigned proxy in.
// Chromium's JsonPrefStore treats dots in a registered pref name as nested
// object paths, so the on-disk shape is {"argus": {"profile_data": {...}}},
// not a flat "argus.profile_data" key.
function writeProfileProxyAssignment(userDataDir, proxy) {
  if (!userDataDir) {
    return;
  }
  const defaultDir = path.join(userDataDir, 'Default');
  ensureDirectoryPath(defaultDir);
  const prefsPath = path.join(defaultDir, 'Preferences');
  let prefs = {};
  try {
    prefs = JSON.parse(fs.readFileSync(prefsPath, 'utf8'));
  } catch {
    prefs = {};
  }
  const profileData = {...(prefs.argus?.profile_data || {})};
  if (proxy?.host && proxy.port) {
    const transport = proxy.type === 'socks5' ? 'socks5' : 'http';
    profileData.assigned_proxy_id = proxy.id || `${proxy.host}:${proxy.port}`;
    profileData.proxy_host = proxy.host;
    profileData.proxy_port = transport === 'socks5' ? Number(proxy.port) : 0;
    profileData.proxy_http_port = transport === 'http' ? Number(proxy.port) : 0;
    profileData.proxy_username = proxy.username || '';
    profileData.proxy_password = proxy.password || '';
    profileData.proxy_transport = transport;
  } else {
    // No proxy assigned this launch -- explicitly clear any assignment left
    // over from a previous launch of this same profile directory, otherwise
    // the browser's own auto-reconnect would keep dialing a stale proxy
    // forever even after the user switches this profile to direct/free-proxy.
    profileData.assigned_proxy_id = '';
    profileData.proxy_host = '';
    profileData.proxy_port = 0;
    profileData.proxy_http_port = 0;
    profileData.proxy_username = '';
    profileData.proxy_password = '';
  }
  prefs.argus = {...(prefs.argus || {}), profile_data: profileData};
  fs.writeFileSync(prefsPath, JSON.stringify(prefs, null, 2));
}

function base64UrlEncode(text) {
  return Buffer.from(text, 'utf8').toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
}

// Fills in whatever the renderer left unresolved on the runtime fingerprint
// (timezone/languages when the profile is set to derive them from the proxy,
// and lat/long for "manual" geolocation) using the same COUNTRY_DEFAULTS
// table and resolveTimezone/resolveLanguage helpers already used for the TZ
// env var and --lang switch below, so proxy-country resolution lives in
// exactly one place. Returns the base64url-encoded JSON for
// --argus-fingerprint-json, or '' if there is no fingerprint to send.
function resolveRuntimeFingerprintArg(fingerprint, proxy, timezone, language) {
  if (!fingerprint) {
    return '';
  }
  const resolved = {...fingerprint};
  if (!resolved.timezone && timezone) {
    resolved.timezone = timezone;
  }
  if ((!resolved.languages || !resolved.languages.length) && language) {
    const base = language.split('-')[0];
    resolved.languages = base && base !== language ? [language, base] : [language];
  }
  if (resolved.geolocation_mode === 'manual' &&
      (resolved.latitude == null || resolved.longitude == null)) {
    const code = (proxy?.country_code || '').toLowerCase();
    const defaults = COUNTRY_DEFAULTS[code];
    if (defaults) {
      resolved.latitude = defaults.latitude;
      resolved.longitude = defaults.longitude;
    }
  }
  return base64UrlEncode(JSON.stringify(resolved));
}

function proxyUrl(proxy) {
  const scheme = proxy.type === 'socks5' ? 'socks5h' : 'http';
  return `${scheme}://${proxy.host}:${proxy.port}`;
}

function proxyCheckCurlBinary() {
  return process.platform === 'win32' ? 'curl.exe' : '/usr/bin/curl';
}

// Runs one curl attempt against `endpoint` through the proxy and resolves to a
// normalized result -- never rejects, so Promise.allSettled/race logic upstream
// doesn't need try/catch around each attempt.
function checkProxyEndpoint(proxy, endpoint) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const args = [
      '--silent',
      '--show-error',
      '--location',
      // Separate connect-timeout from total max-time: a proxy that's simply
      // dead/unreachable fails fast (6s) instead of waiting out the full
      // budget every other slow-but-alive endpoint gets (10s).
      '--connect-timeout', '6',
      '--max-time', '10',
      '--proxy', proxyUrl(proxy),
    ];
    if (proxy.username || proxy.password) {
      args.push('--proxy-user', `${proxy.username || ''}:${proxy.password || ''}`);
    }
    args.push(endpoint);
    const child = spawn(proxyCheckCurlBinary(), args);
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', (error) => {
      resolve({ok: false, endpoint, error: error.message});
    });
    child.on('close', (code) => {
      const pingMs = Date.now() - startedAt;
      if (code !== 0) {
        resolve({ok: false, endpoint, error: (stderr || stdout || `curl exited ${code}`).trim()});
        return;
      }
      try {
        const data = JSON.parse(stdout);
        if (data.error || data.status === 'fail') {
          resolve({ok: false, endpoint, error: data.reason || data.message || `Lookup failed at ${endpoint}`});
          return;
        }
        const country = data.country_name || data.countryName || data.country;
        const countryCode = data.country_code || data.countryCode ||
          (typeof data.country === 'string' && data.country.length === 2 ? data.country : undefined);
        resolve({ok: true, endpoint, ip: data.ip || data.query, country, countryCode, pingMs});
      } catch {
        resolve({ok: false, endpoint, error: `Invalid response from ${endpoint}`});
      }
    });
  });
}

async function checkProxy(proxy) {
  if (!proxy?.host || !proxy.port) {
    return {ok: false, error: 'Proxy host and port are required'};
  }
  const started = Date.now();
  // Queried concurrently (not one-by-one) so a single slow/rate-limited/
  // blocked geolocation service doesn't stall or fail the whole check --
  // the fastest successful response wins.
  const endpoints = [
    'https://ipapi.co/json/',
    'https://ipinfo.io/json',
    'http://ip-api.com/json/',
  ];
  const results = await Promise.all(endpoints.map((endpoint) => checkProxyEndpoint(proxy, endpoint)));
  const success = results.find((result) => result.ok);
  if (success) {
    return {ok: true, ip: success.ip, country: success.country, countryCode: success.countryCode, pingMs: success.pingMs};
  }
  return {
    ok: false,
    pingMs: Date.now() - started,
    error: results.map((result) => result.error).filter(Boolean).join(' · ') || 'Proxy check failed',
  };
}

function clearSessionRestore(userDataDir) {
  if (!userDataDir) {
    return;
  }
  const candidates = [
    path.join(userDataDir, 'Default', 'Sessions'),
    path.join(userDataDir, 'Default', 'Session Storage'),
    path.join(userDataDir, 'Default', 'Current Session'),
    path.join(userDataDir, 'Default', 'Current Tabs'),
    path.join(userDataDir, 'Default', 'Last Session'),
    path.join(userDataDir, 'Default', 'Last Tabs'),
    path.join(userDataDir, 'Sessions'),
    path.join(userDataDir, 'Current Session'),
    path.join(userDataDir, 'Current Tabs'),
    path.join(userDataDir, 'Last Session'),
    path.join(userDataDir, 'Last Tabs'),
  ];
  for (const candidate of candidates) {
    try {
      fs.rmSync(candidate, {recursive: true, force: true});
    } catch {
      // Best effort: stale sessions should not block launch.
    }
  }
}

function killExistingProfileProcess(profileId, userDataDir) {
  const patterns = [
    profileId ? `argus-profile-id=${profileId}` : '',
    userDataDir || '',
  ].filter(Boolean);
  for (const pattern of patterns) {
    spawnSync('/usr/bin/pkill', ['-f', pattern], {stdio: 'ignore'});
  }
  const deadline = Date.now() + 5000;
  while (userDataDir && Date.now() < deadline) {
    const result = spawnSync('/usr/bin/pgrep', ['-f', userDataDir], {
      encoding: 'utf8',
    });
    if (result.status !== 0 || !result.stdout.trim()) {
      return;
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250);
  }
}

function fallbackHomeHtml(profileName) {
  const safeName = String(profileName || 'Profile')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;');
  return `<!doctype html><html><head><meta charset="utf-8"><title>${safeName}</title>
<style>body{margin:0;display:grid;min-height:100vh;place-items:center;background:#fbfaf8;color:#1d1c18;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}main{text-align:center}h1{font-size:36px;margin:0 0 10px}p{color:#716b62;font-size:17px}</style>
</head><body><main><h1>${safeName}</h1><p>Anonymous Argys Browser session</p></main></body></html>`;
}

function writeHomeFile(payload) {
  const html = payload.homeHtml || fallbackHomeHtml(payload.name);
  const root = payload.userDataDir || app.getPath('userData');
  const homeDir = path.join(root, 'ArgysHome');
  ensureDirectoryPath(homeDir);
  const homePath = path.join(homeDir, 'home.html');
  fs.writeFileSync(homePath, html);
  return pathToFileURL(homePath).toString();
}

function writeProfileStartupPrefs(userDataDir, launchUrl) {
  if (!userDataDir || !launchUrl) {
    return;
  }
  const defaultDir = path.join(userDataDir, 'Default');
  ensureDirectoryPath(defaultDir);
  const prefsPath = path.join(defaultDir, 'Preferences');
  let prefs = {};
  try {
    prefs = JSON.parse(fs.readFileSync(prefsPath, 'utf8'));
  } catch {
    prefs = {};
  }
  prefs.homepage = launchUrl;
  prefs.homepage_is_newtabpage = false;
  prefs.newtab_page_location_override = launchUrl;
  prefs.session = {
    ...(prefs.session || {}),
    restore_on_startup: 4,
    startup_urls: [launchUrl],
    urls_to_restore_on_startup: [launchUrl],
  };
  prefs.pinned_tabs = [];
  prefs.tabs = {
    ...(prefs.tabs || {}),
    pinned_tabs: [],
  };
  prefs.browser = {
    ...(prefs.browser || {}),
    has_seen_welcome_page: true,
    show_home_button: true,
  };
  prefs.profile = {
    ...(prefs.profile || {}),
    exit_type: 'Normal',
    exited_cleanly: true,
  };
  fs.writeFileSync(prefsPath, JSON.stringify(prefs, null, 2));
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function xmlEscape(value) {
  return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
}

function bundleSafeId(value) {
  return String(value || 'profile')
      .toLowerCase()
      .replace(/[^a-z0-9.-]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'profile';
}

function fileSafeName(value) {
  return String(value || 'Profile')
      .replace(/[/:]/g, '-')
      .replace(/\s+/g, ' ')
      .trim() || 'Profile';
}

function profileLaunchersRoot() {
  return path.join(app.getPath('home'), 'Applications', 'Argys Profiles');
}

function profileLauncherPath(payload) {
  return path.join(profileLaunchersRoot(), `${fileSafeName(payload.name)}.app`);
}

function copyBrowserIcon(browserAppPath, resourcesDir) {
  const candidates = [
    path.join(browserAppPath, 'Contents/Resources/app.icns'),
    '/Applications/Argys Browser.app/Contents/Resources/app.icns',
    '/Applications/Argus.app/Contents/Resources/app.icns',
  ];
  const iconPath = candidates.find((candidate) => fs.existsSync(candidate));
  if (iconPath) {
    fs.copyFileSync(iconPath, path.join(resourcesDir, 'app.icns'));
  }
}

// The Dock/Cmd+Tab name for a running app comes from its bundle's Info.plist,
// never from a window's title or command-line args -- there is no supported
// way for one shared "Argys Browser" binary to report a different Dock
// identity per profile. So each launch gets its own tiny wrapper .app (named
// after the profile) whose sole job is to exec the real browser with this
// profile's args; the Dock then shows the profile's name instead of the
// shared "Argys Browser" identity, as required.
function writeProfileLauncherApp(payload, resolved, args, timezone) {
  const appPath = profileLauncherPath(payload);
  const contentsDir = path.join(appPath, 'Contents');
  const macosDir = path.join(contentsDir, 'MacOS');
  const resourcesDir = path.join(contentsDir, 'Resources');
  fs.rmSync(appPath, {recursive: true, force: true});
  ensureDirectoryPath(macosDir);
  ensureDirectoryPath(resourcesDir);

  const displayName = fileSafeName(payload.name);
  const bundleId = `com.argys.browser.profile.${bundleSafeId(payload.id || displayName)}`;
  const executableName = 'ArgysProfileLauncher';
  const infoPlist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleName</key><string>${xmlEscape(displayName)}</string>
<key>CFBundleDisplayName</key><string>${xmlEscape(displayName)}</string>
<key>CFBundleIdentifier</key><string>${xmlEscape(bundleId)}</string>
<key>CFBundleExecutable</key><string>${executableName}</string>
<key>CFBundleIconFile</key><string>app</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleShortVersionString</key><string>1.0</string>
<key>CFBundleVersion</key><string>1</string>
<key>LSMinimumSystemVersion</key><string>13.0</string>
</dict></plist>
`;
  fs.writeFileSync(path.join(contentsDir, 'Info.plist'), infoPlist);
  fs.writeFileSync(path.join(contentsDir, 'PkgInfo'), 'APPL????');
  copyBrowserIcon(resolved.appPath, resourcesDir);

  const logPath = `/tmp/argys-profile-${bundleSafeId(payload.id || displayName)}.log`;
  const launchArgs = args.map(shellQuote).join(' ');
  // TZ is respected by V8/ICU for Intl.DateTimeFormat and Date's reported
  // timezone/offset, so this is what actually makes the browser's apparent
  // timezone match the proxy's country instead of leaking the host Mac's.
  const tzExport = timezone ? `export TZ=${shellQuote(timezone)}\n` : '';
  const script = `#!/bin/zsh
set -e
${tzExport}ARGYS_BROWSER_BIN=${shellQuote(resolved.executable)}
PROFILE_MARKER=${shellQuote(`argus-profile-id=${payload.id || ''}`)}
pkill -f "$PROFILE_MARKER" >/dev/null 2>&1 || true
sleep 1
"$ARGYS_BROWSER_BIN" ${launchArgs} >${shellQuote(logPath)} 2>&1 &
sleep 3
while pgrep -f "$PROFILE_MARKER" >/dev/null 2>&1; do
  sleep 5
done
`;
  const executablePath = path.join(macosDir, executableName);
  fs.writeFileSync(executablePath, script, {mode: 0o755});
  fs.chmodSync(executablePath, 0o755);
  return appPath;
}

// Best-effort: a failure here shouldn't block the launch attempt itself,
// since the normal case (no stale process) is expected to find nothing.
function killStaleProfileProcess(profileId) {
  if (!profileId) {
    return;
  }
  const marker = `argus-profile-id=${profileId}`;
  try {
    if (process.platform === 'win32') {
      const script =
        `Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'chrome.exe' -and $_.CommandLine -like '*${marker}*' } | ` +
        'ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }; ' +
        'Start-Sleep -Milliseconds 500';
      spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {windowsHide: true});
    } else if (process.platform === 'linux') {
      spawnSync('pkill', ['-f', marker]);
    }
  } catch {
    // Ignore -- see comment above.
  }
}

function spawnProfileBrowserDirectly(resolved, args, timezone) {
  const env = {...process.env};
  if (timezone) {
    env.TZ = timezone;
  }
  const child = spawn(resolved.executable, args, {
    detached: true,
    stdio: 'ignore',
    windowsHide: process.platform === 'win32',
    env,
  });
  child.unref();
  return child;
}

// Shared by the normal launch-profile handler and the Facebook-login-fetch
// automation: builds the launcher args/app and spawns the browser. `extraArgs`
// lets the automation path append --remote-debugging-port for CDP without
// exposing it on ordinary launches.
async function spawnProfile(payload, extraArgs = []) {
  try {
    return await spawnProfileUnchecked(payload, extraArgs);
  } catch (error) {
    return {
      ok: false,
      error: errorDetail(error),
    };
  }
}

// The renderer's profileDataDir() (src/main.tsx) hands back a bare relative
// path on Windows (e.g. "ArgysProfiles/<id>", no drive letter). Every file
// operation below resolves payload.userDataDir with path.join(), and the
// --user-data-dir switch handed to the spawned browser is a relative string
// too -- both Node and Chromium resolve a relative path against the
// process's own cwd at the moment each one runs, and that cwd is whatever
// Windows happened to set for this process (e.g. a shortcut's "Start in"
// directory, or wherever the process was launched from), not anything under
// this app's control. If that cwd ever differs between when the launcher
// writes the profile's files and when Chromium itself resolves the same
// switch, the two sides land in different directories -- Chromium then opens
// a --user-data-dir that never received the extension files the launcher
// just wrote, and reports exactly "Manifest file is missing or unreadable"
// even though materializeBundledExtension() copied everything correctly.
// Anchoring to a fixed, absolute directory make the resolution
// deterministic regardless of process cwd.
function resolveProfileUserDataDir(userDataDir) {
  if (!userDataDir) {
    return userDataDir;
  }
  return path.isAbsolute(userDataDir) ?
    userDataDir :
    path.join(app.getPath('userData'), userDataDir);
}

async function spawnProfileUnchecked(payload, extraArgs = []) {
  payload = {...payload, userDataDir: resolveProfileUserDataDir(payload.userDataDir)};
  const resolved = resolveBrowserExecutable();
  console.log(
      `Launching profile "${payload.name}" (${payload.id}): resolved browser ` +
      `path = ${resolved ? resolved.executable : '(none found)'}`);
  if (!resolved) {
    if (['checking', 'downloading', 'installing'].includes(resourceState.browserStatus)) {
      return {
        ok: false,
        error: 'Argys Browser is still downloading. Try again when the additional resources finish installing.',
      };
    }
    return {
      ok: false,
      error:
        resourceState.error ||
        'Argys Browser is not installed and no downloadable browser resource is available yet.',
    };
  }
  // Proxy reachability is checked here, before the browser is ever spawned,
  // rather than inside it: the browser used to re-verify the assigned proxy
  // itself and fail closed with a generic, static error page on any failure
  // -- indistinguishable from a genuinely dead proxy, and any transient hiccup
  // in that verification round-trip silently ate an otherwise-working proxy.
  // A profile in Free Proxy mode has no assigned proxy to check here; that
  // extension owns and reports its own connection state instead.
  if (payload.proxy?.host && payload.proxy.port && !payload.useFreeProxy) {
    const proxyCheck = await checkProxy(payload.proxy);
    if (!proxyCheck.ok) {
      return {
        ok: false,
        error: `Proxy ${payload.proxy.host}:${payload.proxy.port} did not respond` +
          `${proxyCheck.error ? ` (${proxyCheck.error})` : ''}. Fix the proxy in ` +
          'Argus Launcher and try again.',
      };
    }
  }
  const extensionPaths = [
    ...bundledExtensionPaths(payload),
    ...(payload.extensionPaths || []),
  ].filter(Boolean);
  // Team-shared extensions (see SharedExtension in src/types.ts): each is a
  // reference (webstore id, or a Storage URL), materialized into a local
  // cache on first use on this machine. A missing/offline one resolves to ''
  // and is simply skipped rather than blocking the launch.
  const sharedExtensionPaths = await Promise.all(
      (payload.sharedExtensions || []).map(materializeSharedExtension));
  extensionPaths.push(...sharedExtensionPaths.filter(Boolean));
  killExistingProfileProcess(payload.id, payload.userDataDir);
  clearSessionRestore(payload.userDataDir);
  const launchUrl = payload.startUrl || writeHomeFile(payload);
  writeProfileStartupPrefs(payload.userDataDir, launchUrl);
  writeProfileProxyAssignment(payload.userDataDir, payload.proxy);
  const cookieManagerPath = payload.enableCookieManager !== false ?
    await writeProfileCookieManagerExtension(payload) : '';
  if (cookieManagerPath) {
    extensionPaths.push(cookieManagerPath);
  }
  // Bundled for every profile (so its toolbar icon/manual toggle is always
  // available) unless the Extensions tab's global switch turns it off
  // entirely. writeProfileFreeProxyExtension's own argus-config.json still
  // gates auto-connect to payload.useFreeProxy only -- being merely installed
  // never makes it touch chrome.proxy.settings on its own, so an
  // assigned-proxy profile's connection is never contested.
  pruneStaleFreeProxyExtensions(payload.userDataDir);
  const freeProxyPath = payload.enableFoxywallFreeProxy !== false ?
    writeProfileFreeProxyExtension(payload) : '';
  if (freeProxyPath) {
    extensionPaths.push(freeProxyPath);
  }
  const uniqueExtensionPaths = [...new Set(extensionPaths)].filter(isLoadableExtensionDir);
  const switches = launchSafeSwitches(payload.commandLineSwitches);
  const explicitTimezone = payload.runtimeFingerprint?.timezone || null;
  const explicitLanguage = payload.runtimeFingerprint?.languages?.[0] || null;
  const timezone = resolveTimezone(explicitTimezone, payload.proxy);
  const language = resolveLanguage(explicitLanguage, payload.proxy);
  const fingerprintArg = resolveRuntimeFingerprintArg(
      payload.runtimeFingerprint, payload.proxy, timezone, language);
  // The renderer's fingerprintSwitches() already emits --lang when the user set
  // an explicit fingerprint language; only fall back to the proxy-derived one
  // here so we don't send a conflicting duplicate.
  const hasLangSwitch = switches.some((sw) => sw.startsWith('--lang='));
  const args = [
    '--argus-profile-launch',
    `--argus-profile-id=${payload.id}`,
    `--argus-profile-name=${payload.name}`,
    `--user-data-dir=${payload.userDataDir}`,
    '--profile-directory=Default',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-session-crashed-bubble',
    '--hide-crash-restore-bubble',
    '--disable-session-restore',
    '--disable-restore-session-state',
    '--disable-features=InfiniteSessionRestore',
    '--new-window',
    ...proxyArgs(payload.proxy),
    ...(payload.useFreeProxy ? ['--argus-free-proxy'] : []),
    ...(fingerprintArg ? [`--argus-fingerprint-json=${fingerprintArg}`] : []),
    ...(uniqueExtensionPaths.length ? [`--load-extension=${uniqueExtensionPaths.join(',')}`] : []),
    ...switches,
    ...(!hasLangSwitch && language ? [`--lang=${language}`] : []),
    ...extraArgs,
    launchUrl,
  ];

  const proxySummary = payload.proxy?.host ?
    `${payload.proxy.type || 'http'}://${payload.proxy.host}:${payload.proxy.port}` +
    (payload.proxy.username ? ' (authenticated)' : '') :
    '(none)';
  console.log(
      `Launching profile "${payload.name}" (${payload.id}): ` +
      `proxy=${proxySummary}, extensions=${JSON.stringify(uniqueExtensionPaths)}. ` +
      'Launch args: ' +
      JSON.stringify(args.map((arg) => arg.replace(/^(--argus-proxy-pass=).*/, '$1<redacted>'))));

  if (process.platform === 'darwin') {
    // On macOS we still need a per-profile wrapper bundle so the Dock/Cmd+Tab
    // identity matches the profile name instead of the shared browser binary.
    const profileAppPath = writeProfileLauncherApp(payload, resolved, args, timezone);
    const child = spawn('/usr/bin/open', ['-n', profileAppPath], {
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
    return {
      ok: true,
      pid: child.pid || 0,
      appPath: resolved.appPath,
      launcherAppPath: profileAppPath,
    };
  }

  // Windows and Linux launch the browser executable directly. They do not
  // support the macOS bundle/Open flow, so spawning the resolved executable is
  // the correct platform-specific path.
  //
  // A profile's user-data-dir is a Chrome single-instance lock: if a browser
  // window for this profile is already open (from a previous plain launch, or
  // an automation launch whose tracking was lost e.g. across an Anty
  // restart), a fresh spawn here silently hands off to that existing window
  // and immediately exits instead of ever opening the new --remote-debugging-port
  // -- so an automation launch_profile call just times out waiting for a CDP
  // endpoint that will never come up, with no clear error pointing at why.
  // macOS's writeProfileLauncherApp already avoids this with its own
  // `pkill -f "$PROFILE_MARKER"` before spawning; this is the same fix for
  // Windows/Linux, where there's no wrapper script to put it in.
  killStaleProfileProcess(payload.id);
  const child = spawnProfileBrowserDirectly(resolved, args, timezone);
  return {
    ok: true,
    pid: child.pid || 0,
    appPath: resolved.appPath,
    launcherAppPath: null,
  };
}

ipcMain.handle('argus:launch-profile', async (_event, payload, extraArgs) => {
  return spawnProfile(payload, Array.isArray(extraArgs) ? extraArgs : []);
});

ipcMain.handle('argus:check-proxy', async (_event, proxy) => {
  return checkProxy(proxy);
});

// The renderer can ask us to open a page in the user's real browser -- used by
// the sign-in screen for "create an account" and "forgot password", which live
// on the web rather than in the launcher.
//
// openExternal hands the string to the OS, so an unfiltered renderer-supplied
// value is a command-injection surface (file:, and on Windows anything the
// shell knows how to run). Only ever pass through https: URLs on a host we own.
const EXTERNAL_URL_HOSTS = new Set([
  'browserargus.com',
  'www.browserargus.com',
]);

function externalUrlAllowed(raw) {
  if (typeof raw !== 'string' || raw.length > 2048) {
    return false;
  }
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return false;
  }
  // Dev only: the landing site runs on plain http at localhost, so without this
  // the sign-in links are untestable before deploy. Never widened in a build.
  if (process.env.ARGUS_LAUNCHER_DEV === '1' &&
      parsed.protocol === 'http:' &&
      (parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost')) {
    return true;
  }
  return parsed.protocol === 'https:' && EXTERNAL_URL_HOSTS.has(parsed.hostname);
}

ipcMain.handle('argus:open-external', async (_event, url) => {
  if (!externalUrlAllowed(url)) {
    console.log('[open-external] refused:', typeof url === 'string' ? url.slice(0, 120) : typeof url);
    return false;
  }
  await shell.openExternal(url);
  return true;
});

ipcMain.handle('argus:update-status', async () => {
  return publicUpdateState();
});

ipcMain.handle('argus:resource-status', async () => {
  return publicResourceState();
});

ipcMain.handle('argus:download-browser-resource', async () => {
  return ensureBrowserResource({manual: true});
});

ipcMain.handle('argus:api-status', async () => {
  return publicApiState();
});

ipcMain.handle('argus:list-api-keys', async () => {
  return publicAutomationKeys();
});

ipcMain.handle('argus:create-api-key', async (_event, {name, folderScope}) => {
  return createAutomationKey(name, folderScope);
});

ipcMain.handle('argus:revoke-api-key', async (_event, id) => {
  return {revoked: revokeAutomationKey(id)};
});

// Writes the argus-hive-bridge MCP server registration directly into the
// config file each tool reads at startup, instead of making the user
// copy/paste it -- every CLI-command form of this we tried
// (`claude mcp add`, `claude mcp add-json`) turned out to be unreliable on
// Windows, and file-editing has no shell argument-passing to go wrong.
function claudeConfigPath() {
  return path.join(app.getPath('home'), '.claude.json');
}

function codexConfigPath() {
  return path.join(app.getPath('home'), '.codex', 'config.toml');
}

function openclawConfigPath() {
  return path.join(app.getPath('home'), '.openclaw', 'openclaw.json');
}

function applyClaudeCodeConfig(dir, token, base) {
  const configPath = claudeConfigPath();
  let config = {};
  try {
    config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch {
    // Missing or unreadable -- start fresh. We only ever touch mcpServers.
  }
  if (typeof config !== 'object' || config === null || Array.isArray(config)) {
    config = {};
  }
  config.mcpServers = (config.mcpServers && typeof config.mcpServers === 'object') ? config.mcpServers : {};
  config.mcpServers.argus = {
    type: 'stdio',
    // Point straight at the bridge's own venv Python rather than `uv run` --
    // `uv` isn't guaranteed to be on PATH for whatever spawns this process
    // (confirmed: it wasn't even installed on this machine), while the venv
    // itself already has argus_hive_bridge installed and proven working.
    command: path.join(dir, '.venv', 'Scripts', 'python.exe'),
    args: ['-m', 'argus_hive_bridge.mcp_server'],
    env: {ARGYS_API_TOKEN: token, ARGYS_API_BASE: base},
  };
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  return configPath;
}

function applyCodexConfig(dir, token, base) {
  const configPath = codexConfigPath();
  fs.mkdirSync(path.dirname(configPath), {recursive: true});
  let existing = '';
  try {
    existing = fs.readFileSync(configPath, 'utf8');
  } catch {
    // No config yet -- fine, we're creating it.
  }
  // Same reasoning as applyClaudeCodeConfig: point at the venv's own Python
  // instead of `uv run` -- uv isn't confirmed present on PATH for whatever
  // spawns this, the venv already works.
  const escapedPython = path.join(dir, '.venv', 'Scripts', 'python.exe').replace(/\\/g, '\\\\');
  const block = [
    '[mcp_servers.argus]',
    `command = "${escapedPython}"`,
    'args = ["-m", "argus_hive_bridge.mcp_server"]',
    '',
    '[mcp_servers.argus.env]',
    `ARGYS_API_TOKEN = "${token}"`,
    `ARGYS_API_BASE = "${base}"`,
    '',
  ].join('\n');
  // Text-based section replace/append -- no TOML library here, and this app
  // only ever touches its own [mcp_servers.argus] table, so "find this exact
  // header, cut to the next top-level [section] or EOF, splice in the new
  // block" is safe without one.
  const headerIndex = existing.indexOf('[mcp_servers.argus]');
  if (headerIndex === -1) {
    const separator = existing.trim().length > 0 ? '\n\n' : '';
    fs.writeFileSync(configPath, existing.replace(/\s*$/, '') + separator + block);
  } else {
    const afterHeader = existing.slice(headerIndex + '[mcp_servers.argus]'.length);
    const nextSectionMatch = afterHeader.match(/\n\[(?!mcp_servers\.argus\.)/);
    const sectionEnd = nextSectionMatch ?
      headerIndex + '[mcp_servers.argus]'.length + nextSectionMatch.index + 1 :
      existing.length;
    fs.writeFileSync(configPath, existing.slice(0, headerIndex) + block + existing.slice(sectionEnd));
  }
  return configPath;
}

function applyOpenClawConfig(dir, token, base) {
  const configPath = openclawConfigPath();
  fs.mkdirSync(path.dirname(configPath), {recursive: true});
  let config = {};
  try {
    config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch {
    // Missing or unreadable -- start fresh. We only ever touch mcp.servers.
  }
  if (typeof config !== 'object' || config === null || Array.isArray(config)) {
    config = {};
  }
  config.mcp = (config.mcp && typeof config.mcp === 'object') ? config.mcp : {};
  config.mcp.servers = (config.mcp.servers && typeof config.mcp.servers === 'object') ? config.mcp.servers : {};
  config.mcp.servers.argus = {
    command: path.join(dir, '.venv', 'Scripts', 'python.exe'),
    args: ['-m', 'argus_hive_bridge.mcp_server'],
    env: {ARGYS_API_TOKEN: token, ARGYS_API_BASE: base},
  };
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  return configPath;
}

ipcMain.handle('argus:apply-integration-config', async (_event, {integrationId, dir, token, base}) => {
  try {
    if (integrationId === 'claude-code') {
      return {ok: true, path: applyClaudeCodeConfig(dir, token, base)};
    }
    if (integrationId === 'codex') {
      return {ok: true, path: applyCodexConfig(dir, token, base)};
    }
    if (integrationId === 'openclaw') {
      return {ok: true, path: applyOpenClawConfig(dir, token, base)};
    }
    return {ok: false, error: `No auto-apply available for ${integrationId}`};
  } catch (error) {
    return {ok: false, error: error.message};
  }
});

ipcMain.handle('argus:check-for-updates', async () => {
  return checkForUpdates({manual: true});
});

ipcMain.handle('argus:download-update', async () => {
  return downloadUpdate();
});

ipcMain.handle('argus:install-update', async () => {
  if (!updateState.downloaded) {
    return {ok: false, error: 'No downloaded update is ready to install.'};
  }
  autoUpdater.quitAndInstall(false, true);
  return {ok: true};
});

ipcMain.handle('argus:select-extension-folder', async () => {
  const result = await dialog.showOpenDialog({
    title: 'Select unpacked extension folder',
    properties: ['openDirectory'],
  });
  if (result.canceled || !result.filePaths[0]) {
    return null;
  }
  return result.filePaths[0];
});

// Zips a locally-picked extension folder and returns it base64-encoded so
// the renderer can upload it to Supabase Storage with its own authenticated
// client -- this process never needs its own Supabase credentials.
ipcMain.handle('argus:zip-extension-folder', async (_event, folderPath) => {
  try {
    if (!folderPath || !fs.existsSync(path.join(folderPath, 'manifest.json'))) {
      return {ok: false, error: 'Not a valid unpacked extension folder (no manifest.json).'};
    }
    return {ok: true, base64: zipFolderToBase64(folderPath)};
  } catch (error) {
    return {ok: false, error: error instanceof Error ? error.message : String(error)};
  }
});

ipcMain.handle('argus:select-cookie-file', async () => {
  const result = await dialog.showOpenDialog({
    title: 'Select cookies file',
    properties: ['openFile'],
    filters: [
      {name: 'Cookie files', extensions: ['json', 'txt', 'cookies']},
      {name: 'All files', extensions: ['*']},
    ],
  });
  if (result.canceled || !result.filePaths[0]) {
    return null;
  }
  const filePath = result.filePaths[0];
  const cookies = parseCookieFile(filePath);
  return {
    path: filePath,
    name: path.basename(filePath),
    count: cookies.length,
    base64: fs.readFileSync(filePath).toString('base64'),
  };
});

ipcMain.handle('argus:select-cookie-folder', async () => {
  const result = await dialog.showOpenDialog({
    title: 'Select folder with cookie files',
    properties: ['openDirectory'],
  });
  if (result.canceled || !result.filePaths[0]) {
    return null;
  }
  return result.filePaths[0];
});

ipcMain.handle('argus:match-cookie-files', async (_event, {folderPath, profileNames}) => {
  let entries = [];
  try {
    entries = fs.readdirSync(folderPath, {withFileTypes: true})
        .filter((entry) => entry.isFile())
        .map((entry) => entry.name);
  } catch {
    return {};
  }
  const matches = {};
  for (const name of profileNames) {
    const needle = name.trim().toLowerCase();
    const fileName = needle ?
      entries.find((entry) => entry.toLowerCase().includes(needle)) :
      undefined;
    if (!fileName) {
      matches[name] = null;
      continue;
    }
    const filePath = path.join(folderPath, fileName);
    try {
      const cookies = parseCookieFile(filePath);
      matches[name] = {
        path: filePath,
        name: fileName,
        count: cookies.length,
        base64: fs.readFileSync(filePath).toString('base64'),
      };
    } catch {
      matches[name] = null;
    }
  }
  return matches;
});

ipcMain.handle('argus:save-text-file', async (_event, {defaultName, content}) => {
  const result = await dialog.showSaveDialog({
    title: 'Export',
    defaultPath: defaultName,
  });
  if (result.canceled || !result.filePath) {
    return null;
  }
  fs.writeFileSync(result.filePath, content, 'utf8');
  return result.filePath;
});

ipcMain.handle('argus:select-import-csv', async () => {
  const result = await dialog.showOpenDialog({
    title: 'Select profile inventory CSV',
    properties: ['openFile'],
    filters: [
      {name: 'CSV files', extensions: ['csv']},
      {name: 'All files', extensions: ['*']},
    ],
  });
  if (result.canceled || !result.filePaths[0]) {
    return null;
  }
  const filePath = result.filePaths[0];
  const content = fs.readFileSync(filePath, 'utf8');
  return {path: filePath, content};
});

ipcMain.handle('argus:get-browser-path', async () => {
  return browserAppPath();
});

ipcMain.handle('argus:set-browser-path', async (_event, nextBrowserAppPath) => {
  writeSettings({...readSettings(), browserAppPath: nextBrowserAppPath});
  return nextBrowserAppPath;
});

// ---- Local automation API (127.0.0.1 only) --------------------------------
// Lets an external script drive actions that otherwise require a native
// dialog (e.g. bulk-matching a cookies folder to profiles) without clicking
// through the UI. Requests are forwarded to the renderer -- which owns the
// signed-in Supabase session and cloud state -- over IPC, matched back to
// the waiting HTTP response by a request id. Never exposed on any interface
// but loopback, and the renderer only runs the same matching logic the
// "Import cookies" button already calls.
const AUTOMATION_API_PORT = 39219;
const pendingAutomationRequests = new Map();
const AUTOMATION_REQUEST_TIMEOUT_MS = 20000;

// Loopback-only isn't the same as trusted: any local process (including a
// page open in an ordinary browser tab, since this server answers with
// permissive CORS headers) can already reach 127.0.0.1. Named, scoped,
// revocable keys -- persisted as salted hashes, never plaintext -- are what
// actually gate access. Each key optionally restricts which profile folders
// it can see/launch, so a given integration (e.g. Hive) can be handed access
// to one folder of profiles instead of the whole account.
const AUTOMATION_KEYS_PATH = path.join(app.getPath('userData'), 'automation-keys.json');
const LEGACY_AUTOMATION_TOKEN_PATH = path.join(app.getPath('userData'), 'automation-token.json');
let automationKeysCache = null;

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function loadAutomationKeys() {
  if (automationKeysCache) {
    return automationKeysCache;
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(AUTOMATION_KEYS_PATH, 'utf8'));
    if (parsed && Array.isArray(parsed.keys)) {
      automationKeysCache = parsed.keys;
      return automationKeysCache;
    }
  } catch {
    // No store on disk yet -- fall through to a possible legacy migration.
  }
  // One-time migration from the original single-token file so anything
  // already relying on it (e.g. an already-configured Hive bridge) keeps
  // working as a full-access "Legacy" key instead of silently breaking.
  try {
    const legacy = JSON.parse(fs.readFileSync(LEGACY_AUTOMATION_TOKEN_PATH, 'utf8'));
    if (legacy && typeof legacy.token === 'string' && legacy.token.length >= 32) {
      automationKeysCache = [{
        id: crypto.randomUUID(),
        name: 'Legacy (full access)',
        tokenHash: hashToken(legacy.token),
        tokenPreview: legacy.token.slice(-4),
        folderScope: null,
        createdAt: new Date().toISOString(),
        lastUsedAt: null,
      }];
      saveAutomationKeys(automationKeysCache);
      return automationKeysCache;
    }
  } catch {
    // No legacy token either -- fresh install, start empty.
  }
  automationKeysCache = [];
  return automationKeysCache;
}

function saveAutomationKeys(keys) {
  automationKeysCache = keys;
  fs.mkdirSync(path.dirname(AUTOMATION_KEYS_PATH), {recursive: true});
  fs.writeFileSync(AUTOMATION_KEYS_PATH, JSON.stringify({keys}, null, 2), {mode: 0o600});
}

// folderScope: null grants every folder; an array (possibly empty) grants
// only those folder ids.
function createAutomationKey(name, folderScope) {
  const token = crypto.randomBytes(24).toString('hex');
  const key = {
    id: crypto.randomUUID(),
    name: (name || 'Unnamed key').slice(0, 80),
    tokenHash: hashToken(token),
    tokenPreview: token.slice(-4),
    folderScope: Array.isArray(folderScope) ? folderScope : null,
    createdAt: new Date().toISOString(),
    lastUsedAt: null,
  };
  const keys = loadAutomationKeys();
  saveAutomationKeys([...keys, key]);
  // Raw token is returned exactly once, to the caller that just created it --
  // only its hash is ever persisted.
  return {...key, token};
}

function revokeAutomationKey(id) {
  const keys = loadAutomationKeys();
  const next = keys.filter((key) => key.id !== id);
  if (next.length === keys.length) {
    return false;
  }
  saveAutomationKeys(next);
  return true;
}

function publicAutomationKeys() {
  return loadAutomationKeys().map(({tokenHash, ...rest}) => rest);
}

// Resolves the caller's key from its Authorization header, or null if
// missing/invalid/revoked. Updates lastUsedAt on a hit.
function resolveAutomationKey(req) {
  const match = /^Bearer (.+)$/.exec(req.headers['authorization'] || '');
  if (!match) {
    return null;
  }
  const provided = Buffer.from(hashToken(match[1]));
  const keys = loadAutomationKeys();
  const found = keys.find((key) => {
    const expected = Buffer.from(key.tokenHash);
    return provided.length === expected.length && crypto.timingSafeEqual(provided, expected);
  });
  if (!found) {
    return null;
  }
  found.lastUsedAt = new Date().toISOString();
  saveAutomationKeys(keys);
  return found;
}

// undefined folderScope (key grants everything) or an explicit allow-list
// that includes folderId.
function keyAllowsFolder(key, folderId) {
  return !key.folderScope || key.folderScope.includes(folderId);
}

// Profiles launched through /v1/profiles/launch-automation, keyed by
// profileId. Deliberately separate from ordinary user-launched windows (which
// this process doesn't track at all) so close-automation can never reach out
// and kill a window a human opened by hand.
const automationLaunches = new Map();

function getFreePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.unref();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const {port} = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

function waitForCdpReady(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const req = http.get({host: '127.0.0.1', port, path: '/json/version', timeout: 1500}, (res) => {
        if (res.statusCode === 200) {
          res.resume();
          resolve();
          return;
        }
        res.resume();
        retry();
      });
      req.on('error', retry);
      req.on('timeout', () => req.destroy());
    };
    const retry = () => {
      if (Date.now() > deadline) {
        reject(new Error('Timed out waiting for the browser\'s CDP endpoint to come up'));
        return;
      }
      setTimeout(attempt, 300);
    };
    attempt();
  });
}

function killAutomationLaunch(profileId) {
  const tracked = automationLaunches.get(profileId);
  if (!tracked) {
    return false;
  }
  automationLaunches.delete(profileId);
  try {
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/pid', String(tracked.pid), '/T', '/F'], {stdio: 'ignore'});
    } else {
      process.kill(tracked.pid);
    }
  } catch {
    // Already exited -- nothing left to clean up.
  }
  return true;
}

ipcMain.on('argus:bulk-match-cookies-result', (_event, {requestId, result, error}) => {
  const pending = pendingAutomationRequests.get(requestId);
  if (!pending) {
    return;
  }
  pendingAutomationRequests.delete(requestId);
  clearTimeout(pending.timeout);
  if (error) {
    pending.res.writeHead(500, {'Content-Type': 'application/json'});
    pending.res.end(JSON.stringify({status: false, msg: error}));
    return;
  }
  pending.res.writeHead(200, {'Content-Type': 'application/json'});
  pending.res.end(JSON.stringify({status: true, ...result}));
});

ipcMain.on('argus:push-local-cookies-result', (_event, {requestId, result, error}) => {
  const pending = pendingAutomationRequests.get(requestId);
  if (!pending) {
    return;
  }
  pendingAutomationRequests.delete(requestId);
  clearTimeout(pending.timeout);
  if (error) {
    pending.res.writeHead(500, {'Content-Type': 'application/json'});
    pending.res.end(JSON.stringify({status: false, msg: error}));
    return;
  }
  pending.res.writeHead(200, {'Content-Type': 'application/json'});
  pending.res.end(JSON.stringify({status: true, ...result}));
});

ipcMain.on('argus:reimport-proxies-result', (_event, {requestId, result, error}) => {
  const pending = pendingAutomationRequests.get(requestId);
  if (!pending) {
    return;
  }
  pendingAutomationRequests.delete(requestId);
  clearTimeout(pending.timeout);
  if (error) {
    pending.res.writeHead(500, {'Content-Type': 'application/json'});
    pending.res.end(JSON.stringify({status: false, msg: error}));
    return;
  }
  pending.res.writeHead(200, {'Content-Type': 'application/json'});
  pending.res.end(JSON.stringify({status: true, ...result}));
});

ipcMain.on('argus:assign-profile-proxy-result', (_event, {requestId, result, error}) => {
  const pending = pendingAutomationRequests.get(requestId);
  if (!pending) {
    return;
  }
  pendingAutomationRequests.delete(requestId);
  clearTimeout(pending.timeout);
  if (error) {
    pending.res.writeHead(500, {'Content-Type': 'application/json'});
    pending.res.end(JSON.stringify({status: false, msg: error}));
    return;
  }
  pending.res.writeHead(200, {'Content-Type': 'application/json'});
  pending.res.end(JSON.stringify({status: true, ...result}));
});

ipcMain.on('argus:get-profile-result', (_event, {requestId, result, error}) => {
  const pending = pendingAutomationRequests.get(requestId);
  if (!pending) {
    return;
  }
  pendingAutomationRequests.delete(requestId);
  clearTimeout(pending.timeout);
  if (error) {
    sendJson(pending.res, 500, {status: false, msg: error});
    return;
  }
  if (!result?.profile) {
    sendJson(pending.res, 404, {status: false, msg: 'Profile not found'});
    return;
  }
  sendJson(pending.res, 200, {status: true, profile: result.profile});
});

ipcMain.on('argus:list-proxies-result', (_event, {requestId, result, error}) => {
  const pending = pendingAutomationRequests.get(requestId);
  if (!pending) {
    return;
  }
  pendingAutomationRequests.delete(requestId);
  clearTimeout(pending.timeout);
  if (error) {
    sendJson(pending.res, 500, {status: false, msg: error});
    return;
  }
  sendJson(pending.res, 200, {status: true, proxies: result?.proxies || []});
});

ipcMain.on('argus:create-proxy-result', (_event, {requestId, result, error}) => {
  const pending = pendingAutomationRequests.get(requestId);
  if (!pending) {
    return;
  }
  pendingAutomationRequests.delete(requestId);
  clearTimeout(pending.timeout);
  if (error) {
    sendJson(pending.res, 500, {status: false, msg: error});
    return;
  }
  sendJson(pending.res, 200, {status: true, ...result});
});

ipcMain.on('argus:update-proxy-result', (_event, {requestId, result, error}) => {
  const pending = pendingAutomationRequests.get(requestId);
  if (!pending) {
    return;
  }
  pendingAutomationRequests.delete(requestId);
  clearTimeout(pending.timeout);
  if (error) {
    sendJson(pending.res, 500, {status: false, msg: error});
    return;
  }
  sendJson(pending.res, 200, {status: true, ...result});
});

ipcMain.on('argus:delete-proxy-result', (_event, {requestId, result, error}) => {
  const pending = pendingAutomationRequests.get(requestId);
  if (!pending) {
    return;
  }
  pendingAutomationRequests.delete(requestId);
  clearTimeout(pending.timeout);
  if (error) {
    sendJson(pending.res, 500, {status: false, msg: error});
    return;
  }
  sendJson(pending.res, 200, {status: true, ...result});
});

ipcMain.on('argus:update-profile-result', (_event, {requestId, result, error}) => {
  const pending = pendingAutomationRequests.get(requestId);
  if (!pending) {
    return;
  }
  pendingAutomationRequests.delete(requestId);
  clearTimeout(pending.timeout);
  if (error) {
    pending.res.writeHead(500, {'Content-Type': 'application/json'});
    pending.res.end(JSON.stringify({status: false, msg: error}));
    return;
  }
  pending.res.writeHead(200, {'Content-Type': 'application/json'});
  pending.res.end(JSON.stringify({status: true, ...result}));
});

ipcMain.on('argus:delete-profile-result', (_event, {requestId, result, error}) => {
  const pending = pendingAutomationRequests.get(requestId);
  if (!pending) {
    return;
  }
  pendingAutomationRequests.delete(requestId);
  clearTimeout(pending.timeout);
  if (error) {
    sendJson(pending.res, 500, {status: false, msg: error});
    return;
  }
  sendJson(pending.res, 200, {status: true, ...result});
});

ipcMain.on('argus:update-fingerprint-result', (_event, {requestId, result, error}) => {
  const pending = pendingAutomationRequests.get(requestId);
  if (!pending) {
    return;
  }
  pendingAutomationRequests.delete(requestId);
  clearTimeout(pending.timeout);
  if (error) {
    pending.res.writeHead(500, {'Content-Type': 'application/json'});
    pending.res.end(JSON.stringify({status: false, msg: error}));
    return;
  }
  pending.res.writeHead(200, {'Content-Type': 'application/json'});
  pending.res.end(JSON.stringify({status: true, ...result}));
});

ipcMain.on('argus:launch-automation-result', (_event, {requestId, result, error}) => {
  const pending = pendingAutomationRequests.get(requestId);
  if (!pending) {
    return;
  }
  pendingAutomationRequests.delete(requestId);
  clearTimeout(pending.timeout);
  if (error || !result?.ok) {
    pending.res.writeHead(error ? 500 : 400, {'Content-Type': 'application/json'});
    pending.res.end(JSON.stringify({status: false, msg: error || result?.error || 'Launch failed'}));
    return;
  }
  (async () => {
    try {
      await waitForCdpReady(pending.cdpPort, 15000);
      automationLaunches.set(pending.profileId, {pid: result.pid, port: pending.cdpPort, launchedByKeyId: pending.keyId});
      sendJson(pending.res, 200, {
        status: true,
        profileId: pending.profileId,
        cdpUrl: `http://127.0.0.1:${pending.cdpPort}`,
        pid: result.pid,
      });
    } catch (waitError) {
      sendJson(pending.res, 504, {status: false, msg: waitError.message});
    }
  })();
});

ipcMain.on('argus:monitoring-report-result', (_event, {requestId, result, error}) => {
  const pending = pendingAutomationRequests.get(requestId);
  if (!pending) {
    return;
  }
  pendingAutomationRequests.delete(requestId);
  clearTimeout(pending.timeout);
  if (error) {
    sendJson(pending.res, 500, {status: false, msg: error});
    return;
  }
  sendJson(pending.res, 200, {status: true});
});

ipcMain.on('argus:list-profiles-result', (_event, {requestId, result, error}) => {
  const pending = pendingAutomationRequests.get(requestId);
  if (!pending) {
    return;
  }
  pendingAutomationRequests.delete(requestId);
  clearTimeout(pending.timeout);
  if (error) {
    sendJson(pending.res, 500, {status: false, msg: error});
    return;
  }
  sendJson(pending.res, 200, {status: true, profiles: result?.profiles || []});
});

function sendJson(res, statusCode, body) {
  res.writeHead(statusCode, {'Content-Type': 'application/json'});
  res.end(JSON.stringify(body));
}

function sendRedirect(res, location) {
  res.writeHead(302, {Location: location});
  res.end();
}

function isLoopbackRedirectUri(value) {
  try {
    const url = new URL(value);
    return (url.hostname === '127.0.0.1' || url.hostname === 'localhost') &&
      (url.protocol === 'http:' || url.protocol === 'https:');
  } catch {
    return false;
  }
}

// Standard "loopback OAuth" pattern used by CLI tools (gh, gcloud, aws) when
// there's no hosted authorization server: the client (e.g. Hive, running on
// this same machine) opens this URL in a real browser, the user approves
// inside Argus Launcher itself, and Anty redirects back to the client's own
// local callback with a short-lived one-time code. /v1/oauth/token then
// exchanges that code for the actual key -- so the long-lived token never
// sits in a URL/browser history, only the disposable code does.
const oauthCodes = new Map();
const OAUTH_CODE_TTL_MS = 60000;

function handleOAuthAuthorize(req, res, parsedUrl) {
  const clientName = parsedUrl.searchParams.get('client_name');
  const redirectUri = parsedUrl.searchParams.get('redirect_uri');
  const scope = parsedUrl.searchParams.get('scope') || 'all';
  const state = parsedUrl.searchParams.get('state') || '';
  if (!clientName) {
    sendJson(res, 400, {status: false, msg: 'client_name is required'});
    return;
  }
  if (!redirectUri || !isLoopbackRedirectUri(redirectUri)) {
    sendJson(res, 400, {status: false, msg: 'redirect_uri must be a loopback (127.0.0.1/localhost) URL'});
    return;
  }
  if (!mainWindow) {
    sendJson(res, 503, {status: false, msg: 'Argus Launcher window is not open'});
    return;
  }
  mainWindow.show();
  mainWindow.focus();
  const requestId = crypto.randomUUID();
  // This one waits on a human clicking Approve/Deny, not another process --
  // give it real time instead of the usual short automation timeout.
  const timeout = setTimeout(() => {
    pendingAutomationRequests.delete(requestId);
    sendJson(res, 504, {status: false, msg: 'Timed out waiting for approval in Argus Launcher'});
  }, 5 * 60 * 1000);
  pendingAutomationRequests.set(requestId, {res, timeout, redirectUri, state});
  mainWindow.webContents.send('argus:oauth-authorize-request', {
    requestId,
    clientName,
    requestedScope: scope,
  });
}

function handleOAuthTokenExchange(req, res) {
  let body = '';
  req.on('data', (chunk) => { body += chunk; });
  req.on('end', () => {
    let payload;
    try {
      payload = JSON.parse(body || '{}');
    } catch {
      sendJson(res, 400, {status: false, msg: 'Invalid JSON body'});
      return;
    }
    const entry = payload.code ? oauthCodes.get(payload.code) : null;
    if (payload.code) {
      oauthCodes.delete(payload.code);
    }
    if (!entry || entry.expiresAt < Date.now()) {
      sendJson(res, 400, {status: false, msg: 'Invalid or expired code'});
      return;
    }
    sendJson(res, 200, {status: true, token: entry.token, name: entry.name, folderScope: entry.folderScope});
  });
}

ipcMain.on('argus:oauth-authorize-result', (_event, {requestId, approved, folderScope, keyName}) => {
  const pending = pendingAutomationRequests.get(requestId);
  if (!pending) {
    return;
  }
  pendingAutomationRequests.delete(requestId);
  clearTimeout(pending.timeout);
  const redirectUrl = new URL(pending.redirectUri);
  if (!approved) {
    redirectUrl.searchParams.set('error', 'access_denied');
    if (pending.state) {
      redirectUrl.searchParams.set('state', pending.state);
    }
    sendRedirect(pending.res, redirectUrl.toString());
    return;
  }
  const created = createAutomationKey(keyName, folderScope);
  const code = crypto.randomBytes(24).toString('hex');
  oauthCodes.set(code, {
    token: created.token,
    name: created.name,
    folderScope: created.folderScope,
    expiresAt: Date.now() + OAUTH_CODE_TTL_MS,
  });
  redirectUrl.searchParams.set('code', code);
  if (pending.state) {
    redirectUrl.searchParams.set('state', pending.state);
  }
  sendRedirect(pending.res, redirectUrl.toString());
});

function startAutomationApiServer() {
  apiState.status = 'starting';
  apiState.error = null;
  broadcastApiState();
  const server = http.createServer((req, res) => {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      });
      res.end();
      return;
    }
    if (req.method === 'GET' && req.url === '/health') {
      sendJson(res, 200, {status: true, service: 'argys-anty-api'});
      return;
    }
    const parsedUrl = new URL(req.url, 'http://127.0.0.1');

    if (req.method === 'GET' && parsedUrl.pathname === '/v1/oauth/authorize') {
      handleOAuthAuthorize(req, res, parsedUrl);
      return;
    }
    if (req.method === 'POST' && parsedUrl.pathname === '/v1/oauth/token') {
      handleOAuthTokenExchange(req, res);
      return;
    }

    const key = resolveAutomationKey(req);
    if (!key) {
      sendJson(res, 401, {status: false, msg: 'Missing or invalid Authorization bearer token'});
      return;
    }
    if (req.method === 'GET' && parsedUrl.pathname === '/v1/profiles') {
      if (!mainWindow) {
        sendJson(res, 503, {status: false, msg: 'Argus Launcher window is not open'});
        return;
      }
      const requestId = crypto.randomUUID();
      const timeout = setTimeout(() => {
        pendingAutomationRequests.delete(requestId);
        sendJson(res, 504, {status: false, msg: 'Timed out waiting for Argus Launcher to respond'});
      }, AUTOMATION_REQUEST_TIMEOUT_MS);
      pendingAutomationRequests.set(requestId, {res, timeout});
      mainWindow.webContents.send('argus:list-profiles-request', {
        requestId,
        folder: parsedUrl.searchParams.get('folder') || null,
        allowedFolders: key.folderScope,
      });
      return;
    }
    if (req.method === 'GET' && parsedUrl.pathname === '/v1/proxies') {
      if (!mainWindow) {
        sendJson(res, 503, {status: false, msg: 'Argus Launcher window is not open'});
        return;
      }
      const requestId = crypto.randomUUID();
      const timeout = setTimeout(() => {
        pendingAutomationRequests.delete(requestId);
        sendJson(res, 504, {status: false, msg: 'Timed out waiting for Argus Launcher to respond'});
      }, AUTOMATION_REQUEST_TIMEOUT_MS);
      pendingAutomationRequests.set(requestId, {res, timeout});
      mainWindow.webContents.send('argus:list-proxies-request', {requestId});
      return;
    }
    if (req.method !== 'POST' ||
        (parsedUrl.pathname !== '/v1/cookies/bulk-match' &&
         parsedUrl.pathname !== '/v1/cookies/push-local' &&
         parsedUrl.pathname !== '/v1/proxies/reimport' &&
         parsedUrl.pathname !== '/v1/proxies/create' &&
         parsedUrl.pathname !== '/v1/proxies/update' &&
         parsedUrl.pathname !== '/v1/proxies/delete' &&
         parsedUrl.pathname !== '/v1/proxies/check' &&
         parsedUrl.pathname !== '/v1/profiles/assign-proxy' &&
         parsedUrl.pathname !== '/v1/profiles/get' &&
         parsedUrl.pathname !== '/v1/profiles/update' &&
         parsedUrl.pathname !== '/v1/profiles/delete' &&
         parsedUrl.pathname !== '/v1/profiles/update-fingerprint' &&
         parsedUrl.pathname !== '/v1/profiles/launch-automation' &&
         parsedUrl.pathname !== '/v1/profiles/close-automation' &&
         parsedUrl.pathname !== '/v1/monitoring/report')) {
      sendJson(res, 404, {status: false, msg: 'Not found'});
      return;
    }
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', async () => {
      let payload;
      try {
        payload = JSON.parse(body || '{}');
      } catch {
        sendJson(res, 400, {status: false, msg: 'Invalid JSON body'});
        return;
      }
      if (parsedUrl.pathname === '/v1/profiles/close-automation') {
        if (!payload.profileId || typeof payload.profileId !== 'string') {
          sendJson(res, 400, {status: false, msg: 'profileId is required'});
          return;
        }
        const tracked = automationLaunches.get(payload.profileId);
        // A scoped key may only close what it (or an unscoped/full-access
        // key) launched -- otherwise a narrowly-scoped integration could
        // reach out and kill a session that belongs to a different one.
        if (tracked && tracked.launchedByKeyId !== key.id && key.folderScope !== null) {
          sendJson(res, 403, {status: false, msg: 'This key did not launch that profile'});
          return;
        }
        sendJson(res, 200, {status: true, closed: killAutomationLaunch(payload.profileId)});
        return;
      }
      if (!mainWindow) {
        sendJson(res, 503, {status: false, msg: 'Argus Launcher window is not open'});
        return;
      }
      const isPushLocal = parsedUrl.pathname === '/v1/cookies/push-local';
      const isReimportProxies = parsedUrl.pathname === '/v1/proxies/reimport';
      const isCreateProxy = parsedUrl.pathname === '/v1/proxies/create';
      const isUpdateProxy = parsedUrl.pathname === '/v1/proxies/update';
      const isDeleteProxy = parsedUrl.pathname === '/v1/proxies/delete';
      const isCheckProxy = parsedUrl.pathname === '/v1/proxies/check';
      const isAssignProfileProxy = parsedUrl.pathname === '/v1/profiles/assign-proxy';
      const isGetProfile = parsedUrl.pathname === '/v1/profiles/get';
      const isUpdateProfile = parsedUrl.pathname === '/v1/profiles/update';
      const isDeleteProfile = parsedUrl.pathname === '/v1/profiles/delete';
      const isUpdateFingerprint = parsedUrl.pathname === '/v1/profiles/update-fingerprint';
      const isLaunchAutomation = parsedUrl.pathname === '/v1/profiles/launch-automation';
      const isMonitoringReport = parsedUrl.pathname === '/v1/monitoring/report';
      if (isPushLocal) {
        if (!payload.profileId || typeof payload.profileId !== 'string') {
          sendJson(res, 400, {status: false, msg: 'profileId is required'});
          return;
        }
        if (!Array.isArray(payload.cookies)) {
          sendJson(res, 400, {status: false, msg: 'cookies array is required'});
          return;
        }
      } else if (isReimportProxies) {
        if (!Array.isArray(payload.proxies)) {
          sendJson(res, 400, {status: false, msg: 'proxies array is required'});
          return;
        }
      } else if (isCreateProxy) {
        if (!payload.host || typeof payload.host !== 'string') {
          sendJson(res, 400, {status: false, msg: 'host is required'});
          return;
        }
        if (!Number.isInteger(payload.port)) {
          sendJson(res, 400, {status: false, msg: 'port (integer) is required'});
          return;
        }
      } else if (isUpdateProxy) {
        if (!payload.proxyId || typeof payload.proxyId !== 'string') {
          sendJson(res, 400, {status: false, msg: 'proxyId is required'});
          return;
        }
      } else if (isDeleteProxy) {
        if (!payload.proxyId || typeof payload.proxyId !== 'string') {
          sendJson(res, 400, {status: false, msg: 'proxyId is required'});
          return;
        }
      } else if (isCheckProxy) {
        if (!payload.host || typeof payload.host !== 'string') {
          sendJson(res, 400, {status: false, msg: 'host is required'});
          return;
        }
        if (!Number.isInteger(payload.port)) {
          sendJson(res, 400, {status: false, msg: 'port (integer) is required'});
          return;
        }
      } else if (isAssignProfileProxy) {
        if (!payload.profileId || typeof payload.profileId !== 'string') {
          sendJson(res, 400, {status: false, msg: 'profileId is required'});
          return;
        }
      } else if (isGetProfile) {
        if (!payload.profileId || typeof payload.profileId !== 'string') {
          sendJson(res, 400, {status: false, msg: 'profileId is required'});
          return;
        }
      } else if (isUpdateProfile) {
        if (!payload.profileId || typeof payload.profileId !== 'string') {
          sendJson(res, 400, {status: false, msg: 'profileId is required'});
          return;
        }
      } else if (isDeleteProfile) {
        if (!payload.profileId || typeof payload.profileId !== 'string') {
          sendJson(res, 400, {status: false, msg: 'profileId is required'});
          return;
        }
      } else if (isUpdateFingerprint) {
        if (!payload.profileId || typeof payload.profileId !== 'string') {
          sendJson(res, 400, {status: false, msg: 'profileId is required'});
          return;
        }
        if (typeof payload.fingerprint !== 'object' || payload.fingerprint === null || Array.isArray(payload.fingerprint)) {
          sendJson(res, 400, {status: false, msg: 'fingerprint object is required'});
          return;
        }
      } else if (isLaunchAutomation) {
        if (!payload.profileId || typeof payload.profileId !== 'string') {
          sendJson(res, 400, {status: false, msg: 'profileId is required'});
          return;
        }
      } else if (isMonitoringReport) {
        if (!payload.runId || typeof payload.runId !== 'string') {
          sendJson(res, 400, {status: false, msg: 'runId is required'});
          return;
        }
        if (!payload.profileId || typeof payload.profileId !== 'string') {
          sendJson(res, 400, {status: false, msg: 'profileId is required'});
          return;
        }
        if (typeof payload.ok !== 'boolean') {
          sendJson(res, 400, {status: false, msg: 'ok (boolean) is required'});
          return;
        }
      } else if (!payload.folderPath || typeof payload.folderPath !== 'string') {
        sendJson(res, 400, {status: false, msg: 'folderPath is required'});
        return;
      }
      if (isCheckProxy) {
        // Unlike every other path here, checkProxy() is a plain main-process
        // function operating only on the host/port/credentials in the
        // request body -- it doesn't touch cloudState, so there's no need
        // for the IPC round-trip to the renderer (and it works even to
        // test a proxy that was never saved as a profile's assigned proxy).
        const result = await checkProxy({
          host: payload.host,
          port: payload.port,
          username: typeof payload.username === 'string' ? payload.username : undefined,
          password: typeof payload.password === 'string' ? payload.password : undefined,
        });
        sendJson(res, 200, {status: true, ...result});
        return;
      }
      let cdpPort = null;
      if (isLaunchAutomation) {
        try {
          cdpPort = await getFreePort();
        } catch (error) {
          sendJson(res, 500, {status: false, msg: `Could not allocate a local port: ${error.message}`});
          return;
        }
      }
      const requestId = crypto.randomUUID();
      const timeout = setTimeout(() => {
        pendingAutomationRequests.delete(requestId);
        sendJson(res, 504, {status: false, msg: 'Timed out waiting for Argus Launcher to respond'});
      }, AUTOMATION_REQUEST_TIMEOUT_MS);
      pendingAutomationRequests.set(requestId, isLaunchAutomation ?
        {res, timeout, cdpPort, profileId: payload.profileId, keyId: key.id} :
        {res, timeout});
      if (isPushLocal) {
        mainWindow.webContents.send('argus:push-local-cookies-request', {
          requestId,
          profileId: payload.profileId,
          profileName: typeof payload.profileName === 'string' ? payload.profileName : '',
          cookies: payload.cookies,
        });
      } else if (isReimportProxies) {
        mainWindow.webContents.send('argus:reimport-proxies-request', {
          requestId,
          proxies: payload.proxies,
        });
      } else if (isCreateProxy) {
        mainWindow.webContents.send('argus:create-proxy-request', {
          requestId,
          name: typeof payload.name === 'string' ? payload.name : '',
          type: payload.type === 'http' ? 'http' : 'socks5',
          host: payload.host,
          port: payload.port,
          username: typeof payload.username === 'string' ? payload.username : undefined,
          password: typeof payload.password === 'string' ? payload.password : undefined,
        });
      } else if (isUpdateProxy) {
        const fields = {};
        if (typeof payload.name === 'string') fields.name = payload.name;
        if (payload.type === 'http' || payload.type === 'socks5') fields.type = payload.type;
        if (typeof payload.host === 'string') fields.host = payload.host;
        if (Number.isInteger(payload.port)) fields.port = payload.port;
        if (typeof payload.username === 'string') fields.username = payload.username;
        if (typeof payload.password === 'string') fields.password = payload.password;
        mainWindow.webContents.send('argus:update-proxy-request', {
          requestId,
          proxyId: payload.proxyId,
          fields,
        });
      } else if (isDeleteProxy) {
        mainWindow.webContents.send('argus:delete-proxy-request', {
          requestId,
          proxyId: payload.proxyId,
        });
      } else if (isAssignProfileProxy) {
        mainWindow.webContents.send('argus:assign-profile-proxy-request', {
          requestId,
          profileId: payload.profileId,
          proxyId: typeof payload.proxyId === 'string' ? payload.proxyId : '',
          proxyHost: typeof payload.proxyHost === 'string' ? payload.proxyHost : '',
          proxyPort: Number.isInteger(payload.proxyPort) ? payload.proxyPort : 0,
        });
      } else if (isGetProfile) {
        mainWindow.webContents.send('argus:get-profile-request', {
          requestId,
          profileId: payload.profileId,
          allowedFolders: key.folderScope,
        });
      } else if (isUpdateProfile) {
        // Only these fields are settable here -- proxy assignment has its
        // own endpoint (assign-proxy) since it needs to resolve against the
        // proxies list rather than take a bare proxy_id, and fingerprint has
        // its own endpoint too since it's a nested object merged field-by-field.
        const fields = {};
        if (typeof payload.name === 'string') fields.name = payload.name;
        if (Array.isArray(payload.tags)) fields.tags = payload.tags.filter((tag) => typeof tag === 'string');
        if (typeof payload.status === 'string') fields.status = payload.status;
        if (typeof payload.color === 'string') fields.color = payload.color;
        if (typeof payload.folderId === 'string' || payload.folderId === null) fields.folder_id = payload.folderId;
        if (typeof payload.email === 'string') fields.email = payload.email;
        if (typeof payload.password === 'string') fields.password = payload.password;
        mainWindow.webContents.send('argus:update-profile-request', {
          requestId,
          profileId: payload.profileId,
          fields,
        });
      } else if (isDeleteProfile) {
        mainWindow.webContents.send('argus:delete-profile-request', {
          requestId,
          profileId: payload.profileId,
          permanent: payload.permanent === true,
          allowedFolders: key.folderScope,
        });
      } else if (isUpdateFingerprint) {
        mainWindow.webContents.send('argus:update-fingerprint-request', {
          requestId,
          profileId: payload.profileId,
          fingerprint: payload.fingerprint,
        });
      } else if (isLaunchAutomation) {
        mainWindow.webContents.send('argus:launch-automation-request', {
          requestId,
          profileId: payload.profileId,
          cdpPort,
          allowedFolders: key.folderScope,
        });
      } else if (isMonitoringReport) {
        mainWindow.webContents.send('argus:monitoring-report-request', {
          requestId,
          runId: payload.runId,
          profileId: payload.profileId,
          ok: payload.ok,
          detail: typeof payload.detail === 'string' ? payload.detail : '',
          screenshotBase64: typeof payload.screenshotBase64 === 'string' ? payload.screenshotBase64 : null,
        });
      } else {
        mainWindow.webContents.send('argus:bulk-match-cookies-request', {
          requestId,
          folderPath: payload.folderPath,
          // profileIds omitted/empty means "match against every profile".
          profileIds: Array.isArray(payload.profileIds) ? payload.profileIds : null,
        });
      }
    });
  });
  server.listen(AUTOMATION_API_PORT, '127.0.0.1', () => {
    apiState.status = 'ready';
    apiState.error = null;
    broadcastApiState();
  });
  server.on('error', (error) => {
    apiState.status = 'error';
    apiState.error = error.message;
    broadcastApiState();
    console.log('[automation-api] failed to start:', error.message);
  });
}

app.whenReady().then(() => {
  configureAutoUpdater();
  createWindow();
  void ensureBrowserResource({manual: false});
});
app.whenReady().then(startAutomationApiServer);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
