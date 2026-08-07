const {
  app, BrowserWindow, Notification, dialog, ipcMain, nativeImage, nativeTheme, shell,
} = require('electron');
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
const builtInExtensions = require('./built-in-extensions.cjs');
const {resolveFavicon} = require('./favicons.cjs');
const integrations = require('./integrations.cjs');
const {launcherIconPng, profileIconIcns, profileIconPng} = require('./profile-icons.cjs');
const cdpCore = require('./cdp-core.cjs');
const automationRunner = require('./automation/runner.cjs');
const automationStore = require('./automation/store.cjs');
const automationSteps = require('./automation/steps.cjs');
const automationAi = require('./automation/ai.cjs');
const automationConnectors = require('./automation/connectors.cjs');
const automationNotify = require('./automation/notify.cjs');
const stepSchema = require('./automation/step-schema.json');
const {
  createRunTokens, handleCookiePullFromPage, handleCookiePushFromPage,
  handleRecheckFromPage, handleRunFromPage,
} = require('./automation/run-token.cjs');
const {routes: apiRoutes} = require('./api/routes.json');

// ── argus:// deep links ──────────────────────────────────────────────────────
// Two shapes, and nothing else is honoured:
//   argus://auth?code=...  the PKCE authorization code coming back from Google
//                          via Supabase. Exchanged in the renderer, which is
//                          the only place the matching code_verifier exists.
//   argus://open           just focus (or start) the app. Carries no credential.
//
// The single-instance lock below is load-bearing, not hygiene: on Windows and
// Linux a deep link is delivered as argv to the ALREADY RUNNING instance via
// 'second-instance', which never fires without the lock. It also fixes a real
// bug -- without it a second launch starts a whole second app that then fails
// to bind the automation API port, stranding the user on "not ready" instead of
// focusing the window they already had.
const DEEP_LINK_SCHEME = 'argus';

// Must track --surface in src/styles.css: this is what the native window paints
// behind the renderer, so a mismatch shows as a flash on launch and resize.
const WINDOW_BG = {light: '#f7f7f6', dark: '#1c1b19'};

// Deep links can arrive before there is a window to send them to -- on macOS
// 'open-url' routinely fires before whenReady. Hold them until the renderer
// says it is listening, then replay.
let deepLinkQueue = [];
let deepLinkReady = false;

function parseDeepLink(raw) {
  if (typeof raw !== 'string' || !raw.startsWith(`${DEEP_LINK_SCHEME}://`)) {
    return null;
  }
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  // URL puts the first path segment in `hostname` for custom schemes.
  const action = parsed.hostname;
  if (action === 'auth') {
    const code = parsed.searchParams.get('code');
    const error = parsed.searchParams.get('error_description') || parsed.searchParams.get('error');
    if (code) {
      return {action: 'auth', code};
    }
    return {action: 'auth', error: error || 'Sign-in was cancelled or failed.'};
  }
  if (action === 'open') {
    return {action: 'open'};
  }
  return null;
}

function focusMainWindow() {
  if (!mainWindow) {
    return;
  }
  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  mainWindow.show();
  mainWindow.focus();
}

function handleDeepLink(raw) {
  const payload = parseDeepLink(raw);
  if (!payload) {
    // Do not log the raw URL: on the auth path it carries an authorization code.
    console.log('[deep-link] ignored an unrecognised argus:// URL');
    return;
  }
  focusMainWindow();
  if (payload.action === 'open') {
    return;
  }
  if (!deepLinkReady || !mainWindow) {
    deepLinkQueue.push(payload);
    return;
  }
  mainWindow.webContents.send('argus:deep-link', payload);
}

function flushDeepLinkQueue() {
  if (!deepLinkReady || !mainWindow) {
    return;
  }
  const pending = deepLinkQueue;
  deepLinkQueue = [];
  for (const payload of pending) {
    mainWindow.webContents.send('argus:deep-link', payload);
  }
}

function deepLinkFromArgv(argv) {
  return (argv || []).find((arg) => typeof arg === 'string' && arg.startsWith(`${DEEP_LINK_SCHEME}://`)) || null;
}

// When the project is named on the command line (`electron .`, and the Windows
// and Linux dev loops), the executable is Electron itself, so the scheme has to
// be registered against that binary plus the app path -- otherwise the OS hands
// argus:// to a bare Electron with no project and nothing happens. The macOS
// dev bundle carries its app at Contents/Resources/app instead (see
// scripts/ensure-macos-app.cjs), which makes defaultApp false and sends it down
// the same branch as a packaged build, where registering the bundle is right.
if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient(DEEP_LINK_SCHEME, process.execPath, [path.resolve(process.argv[1])]);
  }
} else {
  app.setAsDefaultProtocolClient(DEEP_LINK_SCHEME);
}

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  // A copy is already running. Hand it whatever we were launched with and quit
  // -- 'second-instance' fires over there.
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    focusMainWindow();
    const link = deepLinkFromArgv(argv);
    if (link) {
      handleDeepLink(link);
    }
  });
}

// macOS delivers deep links here rather than through argv.
app.on('open-url', (event, url) => {
  event.preventDefault();
  handleDeepLink(url);
});

app.setName('Argus Launcher');
app.setAboutPanelOptions({
  applicationName: 'Argus Launcher',
  applicationVersion: app.getVersion(),
  credits: 'Developed by Dmitry Polskoy\nhttps://www.linkedin.com/in/dmitry-polskoy-a46103177/',
  website: 'https://www.linkedin.com/in/dmitry-polskoy-a46103177/',
});

// Where a proxy is, and what a profile behind it should therefore report. Split
// into its own module so it is reachable from vitest -- see electron/proxy-geo.cjs.
const {
  COUNTRY_DEFAULTS,
  parseProxyGeo,
  resolveLanguage,
  resolveTimezone,
} = require('./proxy-geo.cjs');

// The launcher's own icon, for the current theme, as a PNG.
//
// This used to walk a list of .icns files -- assets/app.icns first, then the
// browser's -- which was doubly wrong. assets/app.icns is a byte-identical copy
// of the browser's icon, so the Dock showed one tile for the control plane and
// for every session it had started, identifiable only by reading the name
// underneath. And nativeImage cannot read .icns at all: it returns an empty
// image, so both consumers below were silently no-ops and the packaged app's
// icon was really coming from electron-builder alone. Hence a .png, and hence
// no fallback -- there was never a working one to preserve.
function appIconPath(dark = nativeTheme.shouldUseDarkColors) {
  return launcherIconPng(dark) || '';
}

// macOS is the only platform that can restyle a running app's icon: the Dock
// tile is set from an image at runtime, where the Windows taskbar reads it out
// of the .exe. So the launcher follows the theme live here, and the Windows
// build keeps whatever assets/app.ico holds until that icon is redrawn too.
function applyDockIcon() {
  if (process.platform !== 'darwin') {
    return;
  }
  const icon = appIconPath();
  if (!icon) {
    return;
  }
  const image = nativeImage.createFromPath(icon);
  if (!image.isEmpty()) {
    app.dock?.setIcon(image);
  }
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
  applyDockIcon();
  const win = new BrowserWindow({
    title: 'Argus Launcher',
    width: 1180,
    height: 760,
    minWidth: 980,
    minHeight: 620,
    icon: icon || undefined,
    // Painted before the renderer loads. Without it the shell is white, which
    // flashes hard against a dark UI on every cold start. The renderer corrects
    // this via argus:set-theme once it knows the user's actual preference.
    backgroundColor: nativeTheme.shouldUseDarkColors ? WINDOW_BG.dark : WINDOW_BG.light,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  mainWindow = win;
  // A fresh renderer has not subscribed yet; it re-arms this via
  // argus:deep-link-ready. Without the reset, a link arriving during a reload
  // would be sent into a window that is not listening and lost.
  deepLinkReady = false;
  win.on('closed', () => {
    if (mainWindow === win) {
      mainWindow = null;
      deepLinkReady = false;
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

// Every enabled built-in extension's ready-to-load directory. What each one is
// and where its copy goes lives in built-in-extensions.cjs; this only supplies
// the file helpers and the cache root that module deliberately does not own.
function builtInExtensionDeps() {
  return {
    isLoadableExtensionDir,
    copyDirectoryContents,
    parseCookieFile,
    parseCookieUrl,
    webstoreCachePath,
  };
}

function builtInExtensionPaths(payload) {
  return builtInExtensions.materializeBuiltIns(payload, builtInExtensionDeps());
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

// Where a Web Store extension's unpacked copy lives on this machine, keyed by
// its store id. One copy per machine shared by every profile -- which is why
// built-in-extensions.cjs can list an 80 MB extension without it being copied
// into each profile's user-data-dir the way the vendored folders are.
function webstoreCachePath(extensionId) {
  return path.join(sharedExtensionsRoot(), extensionId);
}

// `onProgress({receivedBytes, totalBytes})` is optional and fires as bytes
// arrive; totalBytes is 0 when the server sends no content-length. Only the
// CaptchaPlugin enable flow passes it -- at ~56 MB that download is long enough
// that a card with no progress bar reads as a frozen one.
function downloadBuffer(url, redirectsLeft = 5, onProgress = null) {
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
        resolve(downloadBuffer(
            new URL(res.headers.location, url).toString(), redirectsLeft - 1, onProgress));
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`HTTP ${res.statusCode} fetching ${url}`));
        return;
      }
      const totalBytes = Number(res.headers['content-length']) || 0;
      let receivedBytes = 0;
      const chunks = [];
      res.on('data', (chunk) => {
        chunks.push(chunk);
        if (onProgress) {
          receivedBytes += chunk.length;
          onProgress({receivedBytes, totalBytes});
        }
      });
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
async function downloadWebstoreExtension(extensionId, destDir, onProgress = null) {
  const url = 'https://clients2.google.com/service/update2/crx?response=redirect' +
      '&acceptformat=crx2,crx3&prodversion=124.0.0.0' +
      `&x=id%3D${extensionId}%26installsource%3Dondemand%26uc`;
  const crxBuffer = await downloadBuffer(url, 5, onProgress);
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

// ---------------------------------------------------------------------------
// Web Store built-ins (see built-in-extensions.cjs; currently CaptchaPlugin
// alone). These are the built-ins whose files are not vendored in extensions/
// but downloaded once per machine, because they are far too large to copy into
// every profile.
//
// The org-wide toggle and the bytes live in different places: the toggle is
// cloud state shared by the team, the bytes are local to one machine. So there
// are two ways in. The enable click downloads with progress and only then
// writes the toggle. A colleague's machine never clicks anything, so it also
// gets a quiet catch-up pass at app start for "toggle on, files missing".
// ---------------------------------------------------------------------------

// key -> in-flight promise, so the enable click and the catch-up pass can never
// run two 56 MB downloads of the same extension at once.
const webstoreBuiltInDownloads = new Map();

// A CRX whose zip has a single top-level folder unpacks one level too deep.
// Shared extensions handle that by returning the nested path, but a built-in's
// location has to stay derivable from its id alone -- launch looks it up via
// webstoreCachePath() with nothing else to go on -- so flatten instead.
function flattenNestedExtensionDir(destDir) {
  if (fs.existsSync(path.join(destDir, 'manifest.json'))) {
    return;
  }
  const entries = isDirectory(destDir) ?
    fs.readdirSync(destDir, {withFileTypes: true}) : [];
  const nested = entries.length === 1 && entries[0].isDirectory() ? entries[0] : null;
  if (!nested || !isLoadableExtensionDir(path.join(destDir, nested.name))) {
    return;
  }
  const nestedPath = path.join(destDir, nested.name);
  for (const entry of fs.readdirSync(nestedPath, {withFileTypes: true})) {
    fs.renameSync(path.join(nestedPath, entry.name), path.join(destDir, entry.name));
  }
  fs.rmSync(nestedPath, {recursive: true, force: true});
}

function sendBuiltInDownloadProgress(key, progress) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('argus:built-in-download-progress', {key, ...progress});
  }
}

// Downloads a Web Store built-in into this machine's cache if it is not already
// there. Never throws: returns {ok} so the enable click can leave the toggle
// off and say why. `notify` is false for the unattended catch-up pass, which
// has no card waiting on a progress bar.
async function ensureWebstoreBuiltIn(key, {notify = false} = {}) {
  const entry = builtInExtensions.builtInExtension(key);
  if (!entry || entry.source.kind !== 'webstore') {
    return {ok: false, error: `"${key}" is not a Web Store built-in extension.`};
  }
  const destDir = webstoreCachePath(entry.source.id);
  if (isLoadableExtensionDir(destDir)) {
    return {ok: true, alreadyInstalled: true};
  }
  const inFlight = webstoreBuiltInDownloads.get(key);
  if (inFlight) {
    return inFlight;
  }
  const run = (async () => {
    try {
      fs.rmSync(destDir, {recursive: true, force: true});
      // Throttled to whole percent: a 56 MB body arrives in thousands of
      // chunks, and one IPC message per chunk would cost more than the
      // download.
      let lastPercent = -1;
      await downloadWebstoreExtension(entry.source.id, destDir, !notify ? null : (progress) => {
        const percent = progress.totalBytes ?
          Math.floor((progress.receivedBytes / progress.totalBytes) * 100) : -1;
        if (percent !== lastPercent) {
          lastPercent = percent;
          sendBuiltInDownloadProgress(key, progress);
        }
      });
      flattenNestedExtensionDir(destDir);
      if (!isLoadableExtensionDir(destDir)) {
        throw new Error('downloaded package has no readable manifest.json');
      }
      return {ok: true};
    } catch (error) {
      fs.rmSync(destDir, {recursive: true, force: true});
      console.error(`Failed to download built-in extension "${key}":`, error);
      return {ok: false, error: error?.message || String(error)};
    } finally {
      webstoreBuiltInDownloads.delete(key);
    }
  })();
  webstoreBuiltInDownloads.set(key, run);
  return run;
}

// "Toggle on, files missing" -- the state a machine lands in when someone else
// on the team enabled it. Runs unattended at app start; launches never wait on
// it, so until it finishes those profiles simply launch without the extension.
function catchUpWebstoreBuiltIns(toggles) {
  for (const entry of builtInExtensions.BUILT_IN_EXTENSIONS) {
    if (entry.source.kind !== 'webstore') continue;
    if (!builtInExtensions.builtInEnabled(toggles, entry)) continue;
    if (isLoadableExtensionDir(webstoreCachePath(entry.source.id))) continue;
    void ensureWebstoreBuiltIn(entry.key);
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

// The object shape this returns is a contract shared with the renderer:
// src/lib/cookieFile.ts is a TypeScript port of this function and its
// neighbours, and the cookie inspector writes that shape back out as the very
// file this parses on the next launch. Nothing compiles electron/, so the two
// cannot be one module -- if you change the fields here, change them there.
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
    // Cleared too, or a profile that once ran on an HTTP proxy keeps
    // proxy_transport: "http" beside a zeroed proxy_http_port -- a shape no
    // launch ever produces, left for the next reader to puzzle over.
    profileData.proxy_transport = '';
    // And Chromium's OWN proxy pref, which is a different key entirely and the
    // one that actually routes traffic. On a proxied launch the browser writes
    // socks5://127.0.0.1:<bridge port> into it (argus::ApplySocksProxyToProfile),
    // and nothing clears it on the way back out: ArgusProfileService's startup
    // fail-safe is deliberately skipped for --argus-profile-launch sessions,
    // and InitializeAsync returns early on the now-empty assigned_proxy_id
    // above, so RevertToDirect/ClearProxyFromProfile never runs. Without this
    // line, switching a profile to Direct and relaunching it points the browser
    // at a SOCKS bridge that no longer exists and every navigation fails --
    // including loopback, since the applicator sets no bypass rules.
    prefs.proxy = {mode: 'direct'};
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
// and lat/long for "manual" geolocation) from electron/proxy-geo.cjs, the same
// module behind the TZ env var and --lang switch below, so a proxy's location
// is interpreted in exactly one place. `geo` is the launch-time proxy check's
// own reading and outranks the stored columns. Returns the base64url-encoded
// JSON for --argus-fingerprint-json, or '' if there is no fingerprint to send.
function resolveRuntimeFingerprintArg(fingerprint, proxy, timezone, language, geo) {
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
    // The proxy's own measured coordinates first, for the same reason the
    // timezone prefers them: the country default is a capital city, so a Denver
    // proxy claimed to be standing in Manhattan.
    const measuredLat = geo?.latitude ?? proxy?.latitude;
    const measuredLon = geo?.longitude ?? proxy?.longitude;
    const code = (geo?.countryCode || proxy?.country_code || '').toLowerCase();
    const defaults = COUNTRY_DEFAULTS[code];
    if (Number.isFinite(measuredLat) && Number.isFinite(measuredLon)) {
      resolved.latitude = measuredLat;
      resolved.longitude = measuredLon;
    } else if (defaults) {
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

// How bad a proxy failure is to *act on*, worst-actionable first. checkProxy
// reports the highest-ranked failure of its three attempts rather than pasting
// all three together, and this is the order.
//
// Auth outranks everything because all three attempts share one proxy: an auth
// failure is a fact about the proxy, whereas a timeout may be the geolocation
// service having a bad minute. 'unknown' sorts last so a real diagnosis always
// beats a raw curl string.
// 'lookup' sorts last: curl reached the internet through the proxy and the
// geolocation service refused, which is not the proxy's fault and must never
// outrank an actual connection failure.
const PROXY_FAILURE_RANK = [
  'auth-rejected', 'auth-required', 'dns', 'unreachable', 'timeout', 'unknown', 'lookup',
];

// Turn a curl exit code + stderr into a cause and a sentence a person can act on.
//
// The reason this exists: the raw curl text never contains the word
// "credentials". A SOCKS5 proxy that wants a username and password answers an
// anonymous handshake by hanging up, and curl reports that as "connection to
// proxy closed" -- so a whole CSV of credential-less proxies used to fail with a
// message that read like the proxies were dead. They were not; they were
// unauthenticated. Verified against a live provider:
//
//   socks5, no credentials    -> 97 "connection to proxy closed"
//   socks5, wrong credentials -> 97 "User was rejected by the SOCKS5 server"
//   http,   no credentials    -> 56 "CONNECT tunnel failed, response 407"
//   http,   wrong credentials -> 56 "CONNECT tunnel failed, response 401"
//
// `sentCredentials` is what separates "needs credentials" from "these
// credentials are wrong" for 407, which is returned in both cases.
function classifyProxyFailure(code, rawMessage, sentCredentials) {
  const message = String(rawMessage || '').trim();
  const lower = message.toLowerCase();
  const fallback = message || `curl exited ${code}`;

  if (lower.includes('user was rejected by the socks5 server')) {
    return {reason: 'auth-rejected', error: 'Proxy rejected these credentials (SOCKS5 refused the login)'};
  }
  if (lower.includes('no authentication method was acceptable') ||
      lower.includes('unacceptable authentication method')) {
    return {reason: 'auth-required', error: 'Proxy needs a username and password (it does not allow anonymous access)'};
  }
  const status = lower.match(/response (\d{3})/);
  if (status) {
    if (status[1] === '407') {
      return sentCredentials ?
        {reason: 'auth-rejected', error: 'Proxy rejected these credentials (407 Proxy Authentication Required)'} :
        {reason: 'auth-required', error: 'Proxy needs a username and password (407 Proxy Authentication Required)'};
    }
    if (status[1] === '401' || status[1] === '403') {
      return {reason: 'auth-rejected', error: `Proxy rejected these credentials (${status[1]})`};
    }
  }
  // Inferred rather than reported, so the wording hedges. Only when we sent
  // nothing -- a proxy that hangs up on credentials we did supply is a
  // different problem, and claiming "needs a password" there would be wrong.
  if (lower.includes('connection to proxy closed') && !sentCredentials) {
    return {
      reason: 'auth-required',
      error: 'Proxy closed the connection without a login — it needs a username and password',
    };
  }
  if (lower.includes('could not resolve proxy')) {
    return {reason: 'dns', error: 'Proxy host could not be resolved — check the hostname'};
  }
  if (code === 28 || lower.includes('timed out') || lower.includes('timeout')) {
    return {reason: 'timeout', error: 'Proxy did not respond in time'};
  }
  if (code === 7 || lower.includes('failed to connect') || lower.includes('connection refused')) {
    return {reason: 'unreachable', error: 'Could not connect to the proxy — check the host and port'};
  }
  return {reason: 'unknown', error: fallback};
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
    const sentCredentials = Boolean(proxy.username || proxy.password);
    if (sentCredentials) {
      args.push('--proxy-user', `${proxy.username || ''}:${proxy.password || ''}`);
    }
    args.push(endpoint);
    const child = spawn(proxyCheckCurlBinary(), args);
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', (error) => {
      // Spawn failed -- curl never ran, so there is nothing about the proxy to
      // classify. 'unknown' keeps it ranked below any real diagnosis.
      resolve({ok: false, endpoint, reason: 'unknown', error: error.message});
    });
    child.on('close', (code) => {
      const pingMs = Date.now() - startedAt;
      if (code !== 0) {
        const failure = classifyProxyFailure(code, stderr || stdout, sentCredentials);
        resolve({ok: false, endpoint, reason: failure.reason, error: failure.error});
        return;
      }
      try {
        const data = JSON.parse(stdout);
        if (data.error || data.status === 'fail') {
          // curl got through the proxy and the geolocation service answered with
          // a refusal, so this says nothing bad about the proxy -- hence its own
          // reason, ranked below every real proxy fault.
          resolve({
            ok: false,
            endpoint,
            reason: 'lookup',
            error: data.reason || data.message || `Lookup failed at ${endpoint}`,
          });
          return;
        }
        const country = data.country_name || data.countryName || data.country;
        const countryCode = data.country_code || data.countryCode ||
          (typeof data.country === 'string' && data.country.length === 2 ? data.country : undefined);
        resolve({
          ok: true, endpoint, ip: data.ip || data.query, country, countryCode, pingMs,
          ...parseProxyGeo(data),
        });
      } catch {
        resolve({ok: false, endpoint, reason: 'lookup', error: `Invalid response from ${endpoint}`});
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
  // Prefer a success that actually carries a timezone over a merely faster one:
  // the timezone decides what the profile reports to every site it visits, and a
  // provider that omits it would push us back to the country-granularity guess.
  const succeeded = results.filter((result) => result.ok);
  const success = succeeded.find((result) => result.timezone) || succeeded[0];
  if (success) {
    return {
      ok: true,
      ip: success.ip,
      country: success.country,
      countryCode: success.countryCode,
      pingMs: success.pingMs,
      timezone: success.timezone,
      city: success.city,
      region: success.region,
      latitude: success.latitude,
      longitude: success.longitude,
    };
  }
  // All three attempts go through the same proxy, so joining their errors used
  // to print the same sentence three times over ("connection to proxy closed ·
  // connection to proxy closed · connection to proxy closed"). Report the single
  // most actionable failure instead, and only mention a differing second cause.
  const ranked = results
      .filter((result) => result.error)
      .sort((a, b) =>
        PROXY_FAILURE_RANK.indexOf(a.reason || 'unknown') -
        PROXY_FAILURE_RANK.indexOf(b.reason || 'unknown'));
  const best = ranked[0];
  if (!best) {
    return {ok: false, pingMs: Date.now() - started, error: 'Proxy check failed'};
  }
  const alsoSaw = [...new Set(ranked.slice(1)
      .filter((result) => result.error !== best.error)
      .map((result) => result.error))];
  return {
    ok: false,
    pingMs: Date.now() - started,
    reason: best.reason || 'unknown',
    error: alsoSaw.length ? `${best.error} (also: ${alsoSaw.join('; ')})` : best.error,
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

// Only reached when the renderer sent no homeHtml -- a launch driven by the
// local API before cloud state has loaded, say. It carries its own colours
// because it cannot import src/lib/palette.ts (nothing compiles electron/), so
// they are written out here to match: --surface/--ink/--ink-soft in both
// themes, with prefers-color-scheme doing the choosing since a payload this
// degraded carries no theme either.
function fallbackHomeHtml(profileName) {
  const safeName = String(profileName || 'Profile')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;');
  return `<!doctype html><html><head><meta charset="utf-8"><title>${safeName}</title>
<style>:root{color-scheme:light dark;--surface:#f7f7f7;--ink:#1f1f1f;--ink-soft:#676767}@media (prefers-color-scheme:dark){:root{--surface:#1b1b1b;--ink:#e9e9e9;--ink-soft:#9e9e9e}}body{margin:0;display:grid;min-height:100vh;place-items:center;background:var(--surface);color:var(--ink);font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}main{text-align:center}h1{font-size:20px;letter-spacing:-0.01em;margin:0 0 4px}p{color:var(--ink-soft);font-size:13px}</style>
</head><body><main><h1>${safeName}</h1><p>Anonymous Argys Browser session</p></main></body></html>`;
}

function writeHomeFile(payload) {
  const html = payload.homeHtml || fallbackHomeHtml(payload.name);
  const root = payload.userDataDir || app.getPath('userData');
  const homeDir = path.join(root, 'ArgysHome');
  ensureDirectoryPath(homeDir);
  const homePath = path.join(homeDir, 'home.html');
  // 0600 because this file can carry a run token (see mintRunToken). It is a
  // small real improvement regardless: the generated page also names the
  // profile and its proxy, and there was no reason for it to be world-readable.
  //
  // Not a security boundary on its own -- a process running as this user
  // already wins, and automation-keys.json sits nearby granting strictly more.
  // It just stops the token being the easiest thing on the disk to read.
  fs.writeFileSync(homePath, html, {mode: 0o600});
  return pathToFileURL(homePath).toString();
}

// Two URLs, not one. `startupUrl` is where the *first* tab goes -- the profile's
// start_url when it has one. `argusHomeUrl` is the generated ArgysHome/home.html,
// and it is where *every other* tab goes: the new-tab page and the home button.
//
// These used to be a single `launchUrl` argument, which meant a profile with a
// start_url had newtab_page_location_override pointed at it too, so every Cmd+T
// for the life of that profile opened the start URL instead of the Argus home
// page. The four Android rows in a customer's CSV import were the only ones
// carrying start_url=facebook.com, which made it look like a mobile-fingerprint
// bug; it was neither mobile nor fingerprint. The first tab never needed the
// override -- it is opened by the positional URL arg and session.startup_urls.
function writeProfileStartupPrefs(userDataDir, startupUrl, argusHomeUrl) {
  if (!userDataDir || !startupUrl) {
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
  // Falling back to startupUrl keeps a caller that only knows one URL working,
  // rather than silently clearing the override and handing back Chromium's own
  // new-tab page.
  const newTabUrl = argusHomeUrl || startupUrl;
  prefs.homepage = newTabUrl;
  // The Argus home page is a file:// page, not the NTP, so the home button has
  // to be told to use `homepage` rather than treat it as the new-tab page.
  prefs.homepage_is_newtabpage = false;
  prefs.newtab_page_location_override = newTabUrl;
  prefs.session = {
    ...(prefs.session || {}),
    restore_on_startup: 4,
    startup_urls: [startupUrl],
    urls_to_restore_on_startup: [startupUrl],
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

// The icon this profile's wrapper bundle wears in Finder, Spotlight and
// Launchpad. NOT its Dock tile -- the wrapper has none (see above); the Dock is
// the browser's own, set from --argus-profile-icon.
//
// Every wrapper used to copy the browser's app.icns, so all of them were the
// same Chromium tile in a folder listing whose only other distinguishing mark
// is a filename. Each now takes its colour from the profiles table (see
// profile-icons.cjs), the same colour its row and chip already carry in the
// app, so the two agree.
//
// The browser's icon stays as the fallback: a profile with no colour is
// impossible today (the column defaults) but a tree where assets/icons was
// never generated is not, and a wrapper with no icon at all shows the generic
// application placeholder.
function writeProfileIcon(payload, browserAppPath, resourcesDir) {
  const candidates = [
    profileIconIcns(payload.color, nativeTheme.shouldUseDarkColors),
    path.join(browserAppPath, 'Contents/Resources/app.icns'),
    '/Applications/Argys Browser.app/Contents/Resources/app.icns',
    '/Applications/Argus.app/Contents/Resources/app.icns',
  ];
  const iconPath = candidates.find((candidate) => candidate && fs.existsSync(candidate));
  if (iconPath) {
    fs.copyFileSync(iconPath, path.join(resourcesDir, 'app.icns'));
  }
  // Logged because "the Dock tile did not change" has two very different
  // causes that look identical from outside: assets/icons is missing (falls
  // through to the browser's own icon, named here), or this process predates
  // the code that picks one -- main.cjs is read once at startup and does not
  // reload with the renderer, so a launcher left running across an edit keeps
  // the old behaviour with no sign of it.
  console.log(`Profile icon for "${payload.name}": colour=${payload.color || '(none)'} -> ` +
    `${iconPath ? path.basename(iconPath) : '(none found)'}`);
}

// Each launch gets its own tiny wrapper .app, named after the profile, whose
// sole job is to exec the real browser with this profile's args.
//
// It does NOT give the profile a Dock identity, despite what this comment used
// to claim. Verified on macOS 26: a bundle whose executable is a zsh script
// never calls NSApplicationMain, so LaunchServices runs it as a plain process
// with no Dock tile and no Cmd+Tab entry. The only tile a profile session has
// ever had is the browser's own, from the shared "Argys Browser" bundle -- the
// browser retints it per profile from --argus-profile-icon, and puts the
// profile's name in the window title, because those are the only handles that
// actually reach the running session.
//
// What the wrapper still earns its place for: the pkill-then-exec sequence that
// clears a stale process, the TZ export, and a per-profile entry in Finder,
// Spotlight and Launchpad -- which is a real surface, and is where the tinted
// icon below shows up.
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
<!-- This bundle's executable is a zsh script, not a Mach-O binary, so there is
     no header for LaunchServices to read an architecture out of. Left to
     itself it forges an LSArchitecturePriority of ("x86_64", arm64) for any
     script bundle -- x86_64 FIRST -- and an Apple Silicon Mac then offers to
     install Rosetta before it will open a wrapper that does nothing but exec
     an arm64 browser. Declaring the priority ourselves is what suppresses
     that; verified against lsregister -dump, where this clears the
     "forged-arch-priority" flag. LSRequiresNativeExecution does NOT work here
     -- LaunchServices ignores it for script bundles and forges x86_64 first
     anyway. Both architectures are listed, arm64 first, so an Intel Mac (where
     arm64 is unavailable and the browser build is x86_64) still launches. -->
<key>LSArchitecturePriority</key><array><string>arm64</string><string>x86_64</string></array>
</dict></plist>
`;
  fs.writeFileSync(path.join(contentsDir, 'Info.plist'), infoPlist);
  fs.writeFileSync(path.join(contentsDir, 'PkgInfo'), 'APPL????');
  writeProfileIcon(payload, resolved.appPath, resourcesDir);

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
    } else {
      // macOS included: the per-profile wrapper .app does its own pkill before
      // spawning, so the launch path never needed this here -- but closing a
      // session adopted from DevToolsActivePort (no pid, because this process
      // did not spawn it) has no other way to reach the window.
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
  // Also the freshest reading of where this proxy actually egresses. The stored
  // columns can be stale or cleared (a credential edit nulls them), and the
  // timezone below is only as trustworthy as the IP it was measured from, so the
  // launch uses what this check just saw rather than the database's copy.
  let proxyGeo = null;
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
    proxyGeo = proxyCheck;
  }
  const extensionPaths = [...(payload.extensionPaths || [])].filter(Boolean);
  // Team-shared extensions (see SharedExtension in src/types.ts): each is a
  // reference (webstore id, or a Storage URL), materialized into a local
  // cache on first use on this machine. A missing/offline one resolves to ''
  // and is simply skipped rather than blocking the launch.
  const sharedExtensionPaths = await Promise.all(
      (payload.sharedExtensions || []).map(materializeSharedExtension));
  extensionPaths.push(...sharedExtensionPaths.filter(Boolean));
  killExistingProfileProcess(payload.id, payload.userDataDir);
  clearSessionRestore(payload.userDataDir);
  // Resolved once, here, so the arg list below stays a list. Null in a tree
  // where assets/icons was never generated, in which case the switch is simply
  // omitted and the browser keeps the shared bundle icon.
  const profileDockIcon =
    profileIconPng(payload.color, nativeTheme.shouldUseDarkColors);
  // Always written, even when the profile has a start_url: the home page is the
  // new-tab page for the whole session, not just the fallback for the first tab.
  const argusHomeUrl = writeHomeFile(payload);
  const launchUrl = payload.startUrl || argusHomeUrl;
  writeProfileStartupPrefs(payload.userDataDir, launchUrl, argusHomeUrl);
  writeProfileProxyAssignment(payload.userDataDir, payload.proxy);
  // Built-in extensions (see built-in-extensions.cjs): the folders vendored in
  // extensions/, copied into this profile's own user-data-dir, plus any Web
  // Store one already sitting in this machine's shared cache. Each resolves to
  // '' rather than throwing, so a missing or unreadable one is skipped instead
  // of blocking the launch.
  //
  // After killExistingProfileProcess above, not before: these write into the
  // user-data-dir of a browser that may still be running until that call.
  //
  // Being bundled is not the same as being active -- FoxyWall's own
  // argus-config.json still gates auto-connect to payload.useFreeProxy, so
  // merely installing it never makes it touch chrome.proxy.settings and an
  // assigned-proxy profile's connection is never contested.
  extensionPaths.push(...await builtInExtensionPaths(payload));
  const uniqueExtensionPaths = [...new Set(extensionPaths)].filter(isLoadableExtensionDir);
  const switches = launchSafeSwitches(payload.commandLineSwitches);
  const explicitTimezone = payload.runtimeFingerprint?.timezone || null;
  const explicitLanguage = payload.runtimeFingerprint?.languages?.[0] || null;
  const timezone = resolveTimezone(explicitTimezone, payload.proxy, proxyGeo);
  const language = resolveLanguage(explicitLanguage, payload.proxy, proxyGeo);
  // A profile behind a proxy with no resolvable timezone used to launch anyway,
  // silently skipping the TZ export -- so it reported the *host* machine's zone
  // while egressing from another continent, which is a louder contradiction than
  // any wrong-but-plausible zone would have been. Fail closed instead.
  // Direct-connection profiles are exempt: with no proxy, the host zone is honest.
  if (!timezone && proxyGeo) {
    return {
      ok: false,
      error: `Could not determine a timezone for proxy ${payload.proxy.host}:${payload.proxy.port}. ` +
        'Re-check the proxy, or set an explicit timezone on this profile, before launching.',
    };
  }
  const fingerprintArg = resolveRuntimeFingerprintArg(
      payload.runtimeFingerprint, payload.proxy, timezone, language, proxyGeo);
  // The renderer's fingerprintSwitches() already emits --lang when the user set
  // an explicit fingerprint language; only fall back to the proxy-derived one
  // here so we don't send a conflicting duplicate.
  const hasLangSwitch = switches.some((sw) => sw.startsWith('--lang='));
  const args = [
    '--argus-profile-launch',
    `--argus-profile-id=${payload.id}`,
    `--argus-profile-name=${payload.name}`,
    // The browser retints its own Dock tile from this (argus_dock_icon_mac.mm).
    // It has to be the browser that does it: every session shares one bundle,
    // and a bundle's icon is a file, so the only per-session handle on the tile
    // is the running process. Resolved here because the launcher owns the
    // artwork and is the only side that knows the user's current theme.
    ...(profileDockIcon ? [`--argus-profile-icon=${profileDockIcon}`] : []),
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

// The renderer can ask us to open a page in the user's real browser -- used for
// the web-only billing dashboard, and for the Google authorize URL that starts
// desktop sign-in.
//
// openExternal hands the string to the OS, so an unfiltered renderer-supplied
// value is a command-injection surface (file:, and on Windows anything the
// shell knows how to run). Only ever pass through https: URLs on a host we own.
const EXTERNAL_URL_HOSTS = new Set([
  'browserargus.com',
  'www.browserargus.com',
]);

// Google sign-in starts at the Supabase project's authorize endpoint, so that
// has to be openable too. The project URL lives in VITE_SUPABASE_URL, which is
// a renderer-side value -- Vite inlines it into the bundle and this process
// never loads .env -- so it cannot be read here to build an exact-host rule.
//
// Instead of hardcoding a project id that would silently stop matching if the
// project changed, allow Supabase's authorize endpoint and nothing else: the
// path must be exactly /auth/v1/authorize. That is narrow enough that the worst
// a bad caller could do is open some other project's Google consent screen.
function isSupabaseAuthorizeUrl(parsed) {
  return parsed.hostname.endsWith('.supabase.co') &&
    parsed.pathname === '/auth/v1/authorize';
}

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
  if (parsed.protocol !== 'https:') {
    return false;
  }
  return EXTERNAL_URL_HOSTS.has(parsed.hostname) || isSupabaseAuthorizeUrl(parsed);
}

// The renderer calls this once it has subscribed to argus:deep-link. Anything
// that arrived before then (a cold start straight from a deep link) is replayed.
ipcMain.handle('argus:deep-link-ready', async () => {
  deepLinkReady = true;
  flushDeepLinkQueue();
  return true;
});

ipcMain.handle('argus:open-external', async (_event, url) => {
  if (!externalUrlAllowed(url)) {
    console.log('[open-external] refused:', typeof url === 'string' ? url.slice(0, 120) : typeof url);
    return false;
  }
  await shell.openExternal(url);
  return true;
});

// Bookmark favicons. Resolved in the main process so the renderer never issues
// the cross-origin requests itself, and cached on disk by host -- see
// electron/favicons.cjs for why this does not use a third-party icon service.
ipcMain.handle('argus:bookmark-favicon', async (_event, url) => {
  if (typeof url !== 'string' || !url) return null;
  try {
    return await resolveFavicon(path.join(app.getPath('userData'), 'Favicons'), url);
  } catch (error) {
    console.log('[favicon] resolve failed:', error && error.message);
    return null;
  }
});

// Takes the user's *preference*, not the resolved theme. That distinction
// matters: nativeTheme.themeSource also drives prefers-color-scheme inside the
// renderer, so pinning it to 'light'/'dark' while the user is on "System" would
// stop matchMedia from ever firing again and the app would no longer follow
// macOS appearance changes. Passing 'system' through keeps that live.
ipcMain.handle('argus:set-theme', async (_event, preference) => {
  nativeTheme.themeSource =
    preference === 'dark' || preference === 'light' ? preference : 'system';
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setBackgroundColor(nativeTheme.shouldUseDarkColors ? WINDOW_BG.dark : WINDOW_BG.light);
  }
  applyDockIcon();
  return true;
});

// Open-at-login, for the General section of Settings.
//
// getLoginItemSettings() is the source of truth rather than anything this app
// stores: the user can remove the entry from System Settings (or the Startup
// tab on Windows) without telling us, and a mirrored copy in localStorage would
// then show a toggle that disagrees with the OS. Every set reads back.
//
// In development this registers the Electron binary rather than Argus Launcher,
// which is harmless but confusing, so the renderer is told whether this build is
// packaged and disables the row when it isn't.
ipcMain.handle('argus:get-login-item', async () => {
  const settings = app.getLoginItemSettings();
  return {openAtLogin: Boolean(settings.openAtLogin), packaged: app.isPackaged};
});

ipcMain.handle('argus:set-login-item', async (_event, enabled) => {
  app.setLoginItemSettings({openAtLogin: Boolean(enabled), openAsHidden: false});
  const settings = app.getLoginItemSettings();
  return {openAtLogin: Boolean(settings.openAtLogin), packaged: app.isPackaged};
});

// Where a profile's browser data actually lands.
//
// The renderer cannot work this out itself: it hands launchProfile() a path that
// may be relative (Windows) or absolute (macOS), and only this process knows
// what a relative one resolves against -- see resolveProfileUserDataDir. Passing
// the renderer's own root string back through the same function means Settings
// shows the real destination rather than a plausible-looking guess.
ipcMain.handle('argus:resolve-profile-root', async (_event, root) => {
  const resolved = resolveProfileUserDataDir(
      typeof root === 'string' && root ? root : 'ArgysProfiles');
  let exists = false;
  try {
    exists = fs.existsSync(resolved);
  } catch {
    // An unreadable parent directory is itself worth showing as "not created
    // yet" rather than crashing the settings dialog.
  }
  return {path: resolved, exists};
});

// Reveals a directory in Finder/Explorer. showItemInFolder selects the item in
// its *parent*, which for a directory means the user lands one level up looking
// at it -- right for a "Show in Finder" button next to a path.
ipcMain.handle('argus:reveal-path', async (_event, target) => {
  if (typeof target !== 'string' || !target) {
    return {ok: false, error: 'No path'};
  }
  try {
    if (!fs.existsSync(target)) {
      return {ok: false, error: 'That folder does not exist yet.'};
    }
    shell.showItemInFolder(target);
    return {ok: true};
  } catch (error) {
    return {ok: false, error: errorDetail(error)};
  }
});

// While on "System", the window background has to track the OS too -- the
// renderer re-themes itself off matchMedia, but nothing else would repaint the
// native shell behind it. The Dock tile is on the same hook for the same
// reason. Already-open browser sessions keep the tile they launched with:
// their icon lives in a bundle on disk, and rewriting it under a running app
// does not repaint the Dock.
nativeTheme.on('updated', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setBackgroundColor(nativeTheme.shouldUseDarkColors ? WINDOW_BG.dark : WINDOW_BG.light);
  }
  applyDockIcon();
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

ipcMain.handle('argus:list-api-keys', async (_event, ownerUserId) => {
  return publicAutomationKeys(typeof ownerUserId === 'string' ? ownerUserId : null);
});

ipcMain.handle('argus:create-api-key', async (_event, {name, folderScope, ownerUserId, orgId, integrationId}) => {
  return createAutomationKey(name, folderScope, {ownerUserId, orgId, integrationId});
});

ipcMain.handle('argus:revoke-api-key', async (_event, id) => {
  return {revoked: revokeAutomationKey(id)};
});

// ── Integrations: wiring agent tools to the bundled MCP server ───────────────
//
// The registration each tool reads at startup is written straight into its own
// config file rather than handed over as a snippet to paste -- every
// CLI-command form of this we tried (`claude mcp add`, `claude mcp add-json`)
// proved unreliable on Windows, and editing the file has no shell
// argument-passing to go wrong. The per-tool file shapes live in
// electron/integrations.cjs.
//
// What we point those configs at is this app itself. `electron/mcp/server.cjs`
// ships inside the asar and is started through the launcher's own binary with
// ELECTRON_RUN_AS_NODE=1, so connecting installs nothing. Until this change the
// configs named `<checkout>/.venv/bin/python -m argus_hive_bridge.mcp_server`
// -- a Python package that is not in this repo, cannot be obtained, and was
// therefore missing on every machine. Every "connected" tool was in fact
// pointed at an interpreter that does not exist.

// process.execPath is the running executable: the .app binary when packaged,
// and the dev bundle's binary under `npm run dev`. Both are stable paths a
// child process can be spawned from.
//
// This depends on Electron's `runAsNode` fuse, which is enabled by default and
// which electron-builder does not touch. If anyone ever disables it, every
// integration breaks silently -- argus:verify-integration is what will say so.
function mcpServerCommand() {
  return process.execPath;
}

// Deliberately NOT unpacked from the asar. `require('ws')` resolves by walking
// up the literal path, so a script at app.asar.unpacked/electron/mcp/ cannot
// see app.asar/node_modules and fails with "Cannot find module 'ws'". Verified
// both ways.
function mcpServerScriptPath() {
  return path.join(app.getAppPath(), 'electron', 'mcp', 'server.cjs');
}

function mcpSpawnSpec(token) {
  return {
    command: mcpServerCommand(),
    args: [mcpServerScriptPath()],
    env: {
      ELECTRON_RUN_AS_NODE: '1',
      // Blanked rather than omitted: an inherited --require or --inspect writes
      // to stdout, and anything on the MCP server's stdout that is not a
      // protocol frame breaks every client that talks to it.
      NODE_OPTIONS: '',
      ARGYS_API_TOKEN: token,
      ARGYS_API_BASE: apiState.url || `http://127.0.0.1:${AUTOMATION_API_PORT}`,
      ARGUS_LAUNCHER_VERSION: app.getVersion(),
    },
  };
}

// Does this entry point at the server this build ships? Used to tell a live
// connection from one left behind by an older install (or by the Python
// bridge), which look identical if you only ask "is there an entry".
function entryIsCurrent(entry) {
  return entry.hasEntry &&
    entry.command === mcpServerCommand() &&
    Array.isArray(entry.args) &&
    entry.args[0] === mcpServerScriptPath();
}

ipcMain.handle('argus:apply-integration-config', async (_event, {integrationId, token}) => {
  try {
    if (integrations.isManual(integrationId)) {
      return {ok: false, error: `No auto-apply available for ${integrationId}`};
    }
    const configPath = integrations.applyIntegrationConfig({
      integrationId,
      home: app.getPath('home'),
      platform: process.platform,
      spawn: mcpSpawnSpec(token),
    });
    return {ok: true, path: configPath};
  } catch (error) {
    return {ok: false, error: error.message};
  }
});

// A key existing is not the same thing as being connected: the key lives in
// this app's own store, while the wiring lives in a file the user (or another
// tool) can edit or delete at any time, and revoking a key never removed the
// block it was written into. The Integrations tab needs both facts, plus
// whether the tool is on this machine at all.
ipcMain.handle('argus:integration-status', async (_event, {integrationId}) => {
  const home = app.getPath('home');
  const manual = integrations.isManual(integrationId);
  const entry = manual ?
    {configPath: null, hasEntry: false, command: null, args: []} :
    integrations.readIntegrationEntry({integrationId, home, platform: process.platform});
  const found = manual ?
    {found: true, evidence: ''} :
    integrations.detectToolDetail(integrationId, home, process.platform);
  return {
    configPath: entry.configPath,
    manual,
    // Hive and the generic card have nothing to detect -- treat them as
    // present so the UI never labels them "not installed".
    installed: found.found,
    // The exact thing on disk that says so, for a UI that would rather show a
    // path than assert. Empty when nothing was found, and for the manual cards.
    installedEvidence: found.evidence,
    hasEntry: entry.hasEntry,
    entryIsCurrent: entryIsCurrent(entry),
    stale: integrations.isStaleEntry(entry),
    commandExists: Boolean(entry.command) && fs.existsSync(entry.command),
    apiReady: apiState.status === 'ready',
  };
});

// Which agent tools are on this machine, in one call, so the tab can label
// every card on load instead of firing one IPC per integration.
ipcMain.handle('argus:detect-integrations', async () => {
  const home = app.getPath('home');
  const detected = {};
  for (const integrationId of Object.keys(integrations.TOOLS)) {
    detected[integrationId] = integrations.detectTool(integrationId, home, process.platform);
  }
  return detected;
});

// The other half of connecting. Without this, disconnecting left the tool
// pointed at a revoked token: it would keep trying to start the MCP server and
// keep failing, with nothing in the UI to explain why.
ipcMain.handle('argus:remove-integration-config', async (_event, {integrationId}) => {
  try {
    if (integrations.isManual(integrationId)) {
      return {ok: true, path: null};
    }
    return {
      ok: true,
      path: integrations.removeIntegrationConfig({
        integrationId,
        home: app.getPath('home'),
        platform: process.platform,
      }),
    };
  } catch (error) {
    return {ok: false, error: error.message};
  }
});

// Repoints a stale entry at the server this build ships, keeping the token that
// is already in the file. The key is still valid -- it lives in this app's own
// store and the old Python bridge authenticated with it exactly the same way --
// so there is nothing for the user to re-approve and no new key to mint.
//
// Returns needsKey when the token in the file is gone or revoked: minting a
// replacement needs ownerUserId/orgId, which only the renderer knows, so that
// case has to go back to the normal connect flow.
ipcMain.handle('argus:repair-integration', async (_event, {integrationId}) => {
  try {
    if (integrations.isManual(integrationId)) {
      return {ok: false, error: `Nothing to repair for ${integrationId}`};
    }
    const home = app.getPath('home');
    const entry = integrations.readIntegrationEntry({
      integrationId, home, platform: process.platform,
    });
    if (!entry.hasEntry) {
      return {ok: false, needsKey: true};
    }
    const token = entry.env?.ARGYS_API_TOKEN;
    if (!token) {
      return {ok: false, needsKey: true};
    }
    const known = loadAutomationKeys().some((key) => key.tokenHash === hashToken(token));
    if (!known) {
      return {ok: false, needsKey: true};
    }
    return {
      ok: true,
      path: integrations.applyIntegrationConfig({
        integrationId,
        home,
        platform: process.platform,
        spawn: mcpSpawnSpec(token),
      }),
    };
  } catch (error) {
    return {ok: false, error: error.message};
  }
});

// ── Verification ─────────────────────────────────────────────────────────────
// Actually starts what the config file says to start and speaks MCP to it.
//
// Everything cheaper than this -- "a key exists", "the file has an entry" --
// can be true while the integration is completely dead, which is exactly the
// state this app used to report as Connected. Reading command/args back out of
// the config rather than from what we meant to write is the point: it is the
// only way to catch a hand-edited entry, an older install's path, or a build
// with the runAsNode fuse disabled.

const VERIFY_TIMEOUT_MS = 12000;

function verifyHandshake(entry) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(entry.command, entry.args, {
        env: {...process.env, ...entry.env, ELECTRON_RUN_AS_NODE: '1'},
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      });
    } catch (error) {
      resolve({ok: false, detail: `Could not start the MCP server: ${error.message}`});
      return;
    }
    let out = '';
    let err = '';
    let settled = false;
    const responses = new Map();

    const finish = (result) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      try {
        child.kill();
      } catch {
        // Already gone.
      }
      resolve(result);
    };

    const timer = setTimeout(() => {
      finish({ok: false, detail: 'No response from the MCP server within 12 seconds.'});
    }, VERIFY_TIMEOUT_MS);

    child.on('error', (error) => {
      finish({
        ok: false,
        detail: error.code === 'ENOENT' ?
          `Could not start the MCP server: ${entry.command} was not found.` :
          `Could not start the MCP server: ${error.message}`,
      });
    });
    child.on('exit', (code) => {
      // The signature of a disabled runAsNode fuse, a moved app, or a server
      // that threw on load.
      finish({
        ok: false,
        detail: `The MCP server exited (code ${code}) before answering.` +
          (err.trim() ? ` Its output: ${err.trim().slice(-400)}` : ''),
      });
    });
    child.stderr.on('data', (chunk) => {
      err = `${err}${chunk}`.slice(-8192);
    });
    child.stdout.on('data', (chunk) => {
      out += chunk;
      let newline = out.indexOf('\n');
      while (newline !== -1) {
        const line = out.slice(0, newline).trim();
        out = out.slice(newline + 1);
        if (line) {
          try {
            const message = JSON.parse(line);
            responses.set(message.id, message);
          } catch {
            // Anything unparseable on stdout is fatal for every MCP client, so
            // it is worth naming precisely rather than timing out.
            finish({
              ok: false,
              detail: `The MCP server printed non-protocol output on stdout: ${line.slice(0, 200)}`,
            });
            return;
          }
        }
        newline = out.indexOf('\n');
      }
      const init = responses.get(1);
      const tools = responses.get(2);
      const call = responses.get(3);
      if (init && init.error) {
        finish({ok: false, detail: `initialize failed: ${init.error.message}`});
        return;
      }
      if (init && tools && call) {
        const names = (tools.result?.tools || []).map((tool) => tool.name);
        if (!names.length) {
          finish({ok: false, detail: 'The MCP server started but exposes no tools.'});
          return;
        }
        finish({
          ok: true,
          serverInfo: init.result?.serverInfo || null,
          protocolVersion: init.result?.protocolVersion || null,
          toolCount: names.length,
          // The only check that proves key, API and renderer are all wired: it
          // goes all the way through to real profile data.
          callOk: call.result ? call.result.isError !== true : false,
          callDetail: call.result?.content?.[0]?.text || call.error?.message || '',
        });
      }
    });

    const send = (message) => {
      try {
        child.stdin.write(`${JSON.stringify(message)}\n`);
      } catch {
        // The exit handler reports it.
      }
    };
    send({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: {name: 'argus-launcher-verify', version: app.getVersion()},
      },
    });
    send({jsonrpc: '2.0', method: 'notifications/initialized'});
    send({jsonrpc: '2.0', id: 2, method: 'tools/list', params: {}});
    send({jsonrpc: '2.0', id: 3, method: 'tools/call',
      params: {name: 'argus_list_profiles', arguments: {}}});
  });
}

ipcMain.handle('argus:verify-integration', async (_event, {integrationId}) => {
  const home = app.getPath('home');
  const checks = [];
  const add = (id, label, ok, detail) => checks.push({id, label, ok, detail: detail || ''});

  const manual = integrations.isManual(integrationId);
  const tool = integrations.TOOLS[integrationId];

  // First, and about the tool rather than about us. Every other check on this
  // list proves only our own side -- that we wrote a file, and that the server
  // we ship starts and can reach the API -- all of which is just as true for a
  // tool that is not installed. Seven green rows for a machine with no Cursor
  // on it is what this row exists to stop.
  if (!manual) {
    const found = integrations.detectToolDetail(integrationId, home, process.platform);
    add('tool', `${tool ? tool.name : integrationId} is on this machine`, found.found,
        found.found ?
          found.evidence :
          `Nothing on this machine looks like ${tool ? tool.name : integrationId}. ` +
            'The settings this app wrote are still correct — install it and they start working.');
  }

  add('api', 'Local API is running', apiState.status === 'ready',
      apiState.status === 'ready' ?
        apiState.url :
        `The local automation API is ${apiState.status || 'not running'}.`);

  if (manual) {
    return {ok: checks.every((check) => check.ok), checks};
  }

  const entry = integrations.readIntegrationEntry({
    integrationId, home, platform: process.platform,
  });
  add('config', 'Config carries the argus server', entry.hasEntry,
      entry.hasEntry ? entry.configPath : `${entry.configPath} has no argus entry.`);
  if (!entry.hasEntry) {
    return {ok: false, checks};
  }

  const commandExists = Boolean(entry.command) && fs.existsSync(entry.command);
  add('binary', 'Command exists', commandExists,
      commandExists ? entry.command :
        `${entry.command} does not exist — the app may have been moved or reinstalled.`);

  const script = entry.args?.[0];
  // fs.existsSync sees inside the asar in the main process, which is where the
  // script lives -- so this is a real check, not a false pass.
  const scriptExists = Boolean(script) && fs.existsSync(script);
  add('script', 'Server script exists', scriptExists,
      scriptExists ? script : `The MCP server script is missing at ${script}.`);

  if (!commandExists || !scriptExists) {
    return {ok: false, checks};
  }

  // Codex's TOML is read back for command only, so its env is not available
  // here; fall back to a freshly built spec's env for the handshake. The
  // handshake is still against the command the file actually names.
  const handshake = await verifyHandshake({
    command: entry.command,
    args: entry.args,
    env: entry.env || {},
  });
  add('handshake', 'MCP server responds', handshake.ok,
      handshake.ok ?
        `${handshake.serverInfo?.name || 'argus'} ${handshake.serverInfo?.version || ''}`.trim() :
        handshake.detail);
  if (!handshake.ok) {
    return {ok: false, checks};
  }
  add('tools', 'Tools available', handshake.toolCount > 0,
      `${handshake.toolCount} tools`);
  add('endToEnd', 'Can reach your profiles', handshake.callOk,
      handshake.callOk ? 'Listed profiles successfully.' : handshake.callDetail);

  return {ok: checks.every((check) => check.ok), checks};
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

// Downloads a Web Store built-in on demand -- the enable click. Resolves
// {ok:false, error} rather than throwing so the Extensions tab can leave the
// switch off and show why, instead of writing a toggle every profile then
// silently launches without.
ipcMain.handle('argus:install-built-in-extension', async (_event, {key}) =>
  ensureWebstoreBuiltIn(key, {notify: true}));

// Which Web Store built-ins this machine actually has on disk. The toggle is
// org-wide, the bytes are per machine, so the card needs both to know whether
// to offer Enable, a progress bar, or nothing.
ipcMain.handle('argus:built-in-extension-status', async () => {
  const installed = {};
  for (const entry of builtInExtensions.BUILT_IN_EXTENSIONS) {
    if (entry.source.kind !== 'webstore') continue;
    installed[entry.key] = isLoadableExtensionDir(webstoreCachePath(entry.source.id));
  }
  return {installed};
});

// Fired once when the workspace's cloud state loads: picks up anything a
// teammate enabled on their machine. Fire-and-forget by design.
ipcMain.handle('argus:catch-up-built-in-extensions', async (_event, {toggles}) => {
  catchUpWebstoreBuiltIns(toggles);
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

// A proxy list is whatever the vendor emailed: .txt far more often than .csv,
// occasionally no extension at all. The renderer parses the contents itself
// (lib/proxies.ts), so this only has to hand back the text.
ipcMain.handle('argus:select-proxy-file', async () => {
  const result = await dialog.showOpenDialog({
    title: 'Select proxy list',
    properties: ['openFile'],
    filters: [
      {name: 'Proxy lists', extensions: ['txt', 'csv', 'list']},
      {name: 'All files', extensions: ['*']},
    ],
  });
  if (result.canceled || !result.filePaths[0]) {
    return null;
  }
  const filePath = result.filePaths[0];
  return {path: filePath, content: fs.readFileSync(filePath, 'utf8')};
});

// A bookmarks file exported from another browser. Chrome, Edge, Firefox, Safari
// and Brave all write the same Netscape bookmark HTML, so one filter covers
// every browser a user is likely to be migrating from. Same division of labour
// as the proxy picker above: this hands back the text and the renderer parses
// it (lib/bookmarkImport.ts), where a real DOM parser is already available.
ipcMain.handle('argus:select-bookmark-file', async () => {
  const result = await dialog.showOpenDialog({
    title: 'Select bookmarks file',
    properties: ['openFile'],
    filters: [
      {name: 'Bookmarks', extensions: ['html', 'htm']},
      {name: 'All files', extensions: ['*']},
    ],
  });
  if (result.canceled || !result.filePaths[0]) {
    return null;
  }
  const filePath = result.filePaths[0];
  return {path: filePath, content: fs.readFileSync(filePath, 'utf8')};
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

// Every route this server answers, from electron/api/routes.json. The allow-list
// below the bearer gate is derived from it rather than written out again, which
// is what stops the served surface and the documented surface disagreeing --
// scripts/verify-api-routes.mjs asserts the two still match.
const ROUTE_BY_KEY = new Map(apiRoutes.map((route) => [`${route.method} ${route.path}`, route]));

// Routes carrying a `channel` are dispatched straight from the table: validate
// the declared fields, forward to the renderer, wait. The older routes keep
// their hand-written blocks further down.
const TABLE_ROUTES = apiRoutes.filter((route) => route.channel || route.local);

// One request/response round trip to the renderer.
//
// The dozen ipcMain.on('...-result') handlers above are the same fifteen lines
// each -- look up the pending request, clear its timeout, unwrap {result,
// error} -- copied once per route. New routes share this pair instead of adding
// a thirteenth copy.
function askRenderer(res, channel, payload) {
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
  mainWindow.webContents.send(channel, {requestId, ...payload});
}

ipcMain.on('argus:api-result', (_event, {requestId, result, error, status}) => {
  const pending = pendingAutomationRequests.get(requestId);
  if (!pending) {
    return;
  }
  pendingAutomationRequests.delete(requestId);
  clearTimeout(pending.timeout);
  if (error) {
    // The renderer chooses the code: 404 for a missing row, 403 for one this
    // key may not see, 400 for steps that do not validate. Defaulting to 500
    // would report every one of those as our fault.
    sendJson(pending.res, status || 500, {status: false, msg: error});
    return;
  }
  sendJson(pending.res, 200, {status: true, ...result});
});

// Reads and parses a JSON request body, answering 400 itself if it is not
// JSON. Capped because the table routes accept a step tree, which is the only
// body on this server that is not a handful of ids -- an unbounded read on a
// loopback port any local process can reach is a way to spend all our memory.
const MAX_API_BODY_BYTES = 512 * 1024;

function readJsonBody(req, res, next) {
  let body = '';
  let tooLarge = false;
  req.on('data', (chunk) => {
    if (tooLarge) {
      return;
    }
    body += chunk;
    if (body.length > MAX_API_BODY_BYTES) {
      tooLarge = true;
      sendJson(res, 413, {status: false, msg: 'Request body is too large'});
      req.destroy();
    }
  });
  req.on('end', () => {
    if (tooLarge) {
      return;
    }
    try {
      next(JSON.parse(body || '{}'));
    } catch {
      sendJson(res, 400, {status: false, msg: 'Invalid JSON body'});
    }
  });
}

// Checks a body against the route's declared fields and returns either the
// forwarded payload or an error string. Only declared fields travel: the same
// rule the MCP tools follow, for the same reason -- an undeclared key that
// happens to match a column downstream is a write nobody documented.
function payloadForRoute(route, body) {
  const out = {};
  for (const field of route.fields || []) {
    const value = body[field.key];
    if (value === undefined || value === null) {
      if (field.required) {
        return {error: `${field.key} is required`};
      }
      continue;
    }
    const okType =
      field.type === 'string' ? typeof value === 'string' :
      field.type === 'number' ? typeof value === 'number' && Number.isFinite(value) :
      field.type === 'boolean' ? typeof value === 'boolean' :
      field.type === 'steps' ? Array.isArray(value) :
      // Two names for one shape -- see ApiFieldType in src/api/routes.ts.
      field.type === 'tags' || field.type === 'strings' ?
        Array.isArray(value) && value.every((item) => typeof item === 'string') :
      value !== null && typeof value === 'object' && !Array.isArray(value);
    if (!okType) {
      const expected =
        field.type === 'steps' ? 'list of steps' :
        field.type === 'tags' || field.type === 'strings' ? 'list of strings' :
        field.type;
      return {error: `${field.key} must be a ${expected}`};
    }
    if (field.type === 'string' && !value.trim() && field.required) {
      return {error: `${field.key} is required`};
    }
    out[field.key] = value;
  }
  // Validated here rather than in the renderer so a workflow the runner would
  // refuse never reaches the database. validateSteps produces path-addressed
  // messages ("steps[2].then[0].selector is required") written for agents.
  if (out.steps) {
    const problems = automationSteps.validateSteps(out.steps, stepSchema);
    if (problems.length > 0) {
      return {error: `These steps are not valid: ${problems.slice(0, 5).join('; ')}`};
    }
  }
  return {payload: out};
}

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
//
// ownerUserId/orgId/integrationId are what make a key attributable. The store
// is per-install, so without an owner every account signed in on this machine
// saw every other account's keys -- and because the Integrations tab decided
// "connected" by matching key.name against the integration's display name, a
// key left behind by a previous account made the card read Connected for a
// brand-new one that had connected nothing. integrationId replaces that name
// match: it is set only by the connect flow, so a hand-made key called
// "Claude Code" can no longer masquerade as a connection.
function createAutomationKey(name, folderScope, meta = {}) {
  const token = crypto.randomBytes(24).toString('hex');
  const key = {
    id: crypto.randomUUID(),
    name: (name || 'Unnamed key').slice(0, 80),
    tokenHash: hashToken(token),
    tokenPreview: token.slice(-4),
    folderScope: Array.isArray(folderScope) ? folderScope : null,
    ownerUserId: typeof meta.ownerUserId === 'string' ? meta.ownerUserId : null,
    orgId: typeof meta.orgId === 'string' ? meta.orgId : null,
    integrationId: typeof meta.integrationId === 'string' ? meta.integrationId : null,
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

// Keys this user owns, plus any that predate ownership being recorded. The
// unowned ones are surfaced -- flagged, and never able to satisfy a connection
// check -- rather than hidden, because they still grant access to this
// machine's API and hiding them would leave no way to revoke them.
function publicAutomationKeys(ownerUserId) {
  return loadAutomationKeys()
      .filter((key) => !key.ownerUserId || key.ownerUserId === ownerUserId)
      .map(({tokenHash, ...rest}) => ({...rest, legacy: !rest.ownerUserId}));
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

// Is anything actually answering CDP on this port? Both resolution paths below
// have to ask, because both can be pointing at a browser that has since died:
// automationLaunches survives a crashed child, and DevToolsActivePort survives
// a SIGKILL.
function cdpAlive(port) {
  return new Promise((resolve) => {
    const req = http.get({host: '127.0.0.1', port, path: '/json/version', timeout: 1200}, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
  });
}

// Where a running profile's debugging endpoint is, without the MCP server (or
// anything else) having to remember it.
//
// Two tiers, because tracking alone is not enough: automationLaunches lives in
// this process, so restarting Anty used to strand every open session -- the
// browser was still there, still debuggable, and nothing could find it again.
// Chromium writes the port it actually bound into DevToolsActivePort inside the
// profile's own user-data-dir, which outlives us.
async function resolveProfileCdp(profileId) {
  const tracked = automationLaunches.get(profileId);
  if (tracked && await cdpAlive(tracked.port)) {
    return {
      running: true,
      cdpUrl: `http://127.0.0.1:${tracked.port}`,
      pid: tracked.pid,
      launchedByKeyId: tracked.launchedByKeyId,
    };
  }
  if (tracked) {
    // Stale entry -- the window is gone. Drop it so close-automation does not
    // later try to kill a pid that has been recycled.
    automationLaunches.delete(profileId);
  }
  try {
    const dir = resolveProfileUserDataDir(path.join('ArgysProfiles', profileId));
    const port = Number(fs.readFileSync(path.join(dir, 'DevToolsActivePort'), 'utf8')
        .split('\n')[0].trim());
    if (port > 0 && await cdpAlive(port)) {
      // Re-adopt it, with no pid: we did not spawn this one, so close-automation
      // must not claim it belongs to any particular key.
      automationLaunches.set(profileId, {pid: null, port, launchedByKeyId: null});
      return {running: true, cdpUrl: `http://127.0.0.1:${port}`, pid: null, launchedByKeyId: null};
    }
  } catch {
    // No file, unreadable, or nothing listening -- not running.
  }
  return {running: false, cdpUrl: null, pid: null, launchedByKeyId: null};
}

// May this key see (drive, close, re-adopt) this running session?
//
// A full-access key may see anything. A folder-scoped key may only see what it
// launched itself -- this process cannot tell which folder a profile is in
// (that lives in the renderer), so "did you start it" is the check that can be
// made here, and it is the conservative one.
//
// Consequence worth knowing: a session adopted from DevToolsActivePort after an
// Anty restart has no launchedByKeyId, so a scoped key cannot re-adopt even its
// own earlier session and must relaunch. Denying by default is the right way
// round -- the alternative lets a narrowly-scoped integration reach a profile
// outside its folder.
function maySeeAutomationSession(key, session) {
  if (key.folderScope === null) {
    return true;
  }
  return Boolean(session.launchedByKeyId) && session.launchedByKeyId === key.id;
}

function killAutomationLaunch(profileId) {
  // The token is only good for a live session; outliving one would leave a
  // credential on disk that still works against whatever opens next.
  runTokens.dropForProfile(profileId);
  const tracked = automationLaunches.get(profileId);
  if (!tracked) {
    return false;
  }
  automationLaunches.delete(profileId);
  // A session adopted from DevToolsActivePort after an Anty restart has no pid
  // -- we never spawned it. Fall back to the profile-marker kill the launch
  // path already uses, rather than killing pid null (which on POSIX signals the
  // whole process group, i.e. this app).
  if (!tracked.pid) {
    killStaleProfileProcess(profileId);
    return true;
  }
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

// ── automation runs ─────────────────────────────────────────────────────────
//
// The division of labour, and why it is this way round:
//
//   the renderer  owns the data. It resolves the automation and the profile,
//                 builds the launch payload, and writes every run record to
//                 Supabase. This process still holds no Supabase credentials.
//   this process  owns the session. It allocates the debugging port, holds the
//                 CDP socket for the life of the run, and kills what it
//                 started. The renderer is a window, and window-all-closed does
//                 not quit on macOS -- a closed window mid-run would otherwise
//                 abandon a browser that is still being driven.
//
// So a run starts with the renderer handing over a fully resolved automation
// and a cdpUrl, and progress comes back as events.

function sendRunEvent(event) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('argus:automation-run-event', event);
  }
}

// A run's outcome, as a desktop notification. Skipped while the window is
// focused -- the topbar bell already shows it there, and an OS banner on top
// of the app you are looking at is a knock on a door that is open. Clicking
// one raises the window, which is the whole thing a banner about a background
// event is for.
function raiseOsNotification(title, body) {
  if (!Notification.isSupported()) {
    return;
  }
  if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isFocused()) {
    return;
  }
  const notification = new Notification({title, body});
  notification.on('click', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) {
        mainWindow.restore();
      }
      mainWindow.show();
      mainWindow.focus();
    }
  });
  notification.show();
}

// ── start-page run tokens ───────────────────────────────────────────────────
//
// The store and the endpoint live in ./automation/run-token.cjs so their
// refusal paths can be tested against the real code rather than a copy --
// scripts/verify-run-token.mjs drives exactly that module. See its header for
// what a token does and does not authorize.
const runTokens = createRunTokens();

ipcMain.handle('argus:mint-run-token',
    async (_event, {profileId, profileName, cdpPort, automations}) =>
      runTokens.mint({profileId, profileName, cdpPort, automations}));

ipcMain.handle('argus:reserve-cdp-port', async () => {
  // The renderer has no node:net, so port allocation lives here even though
  // the launch it belongs to is driven from there.
  return getFreePort();
});

// Where a profile's debugging endpoint is, or null. Same two-tier resolution
// the HTTP API uses, so a run can attach to a session this process did not
// start -- including one adopted from DevToolsActivePort after a restart.
ipcMain.handle('argus:resolve-profile-cdp', async (_event, {profileId}) => {
  try {
    return await resolveProfileCdp(profileId);
  } catch (error) {
    return {running: false, error: error?.message || String(error)};
  }
});

// How many elements a selector matches on a profile's open page.
//
// The editor's Check button. Read-only by construction: it evaluates
// querySelectorAll(...).length and returns a number, so there is no argument
// about whether "testing" a click step might submit a form. The selector is
// JSON-encoded into the expression rather than concatenated -- it is text the
// user typed, and this is the one place in the editor that puts it into a
// string that a page will execute.
//
// Reuses withPage, which opens a socket and closes it in a finally. A pool was
// rejected for the MCP tools for the same reason it is not wanted here: a
// stale handle is worth more debugging than a connection is worth saving.
ipcMain.handle('argus:check-selector', async (_event, {profileId, selector}) => {
  const query = String(selector || '').trim();
  if (!query) {
    return {ok: false, error: 'Enter a selector first.'};
  }
  try {
    const session = await resolveProfileCdp(profileId);
    if (!session.running || !session.cdpUrl) {
      return {ok: false, notRunning: true, error: 'That profile is not open.'};
    }
    return await cdpCore.withPage(session.cdpUrl, async (page) => {
      const result = await page.send('Runtime.evaluate', {
        // The try/catch is inside the page: an invalid selector throws
        // SyntaxError from querySelectorAll, and "h1[" is a typo to report as
        // one, not a failure of the check itself.
        expression: `(() => {
          try {
            return {count: document.querySelectorAll(${JSON.stringify(query)}).length};
          } catch (error) {
            return {invalid: String(error && error.message || error)};
          }
        })()`,
        returnByValue: true,
      });
      const value = result.result?.value || {};
      if (value.invalid) {
        return {ok: false, error: `Not a valid CSS selector: ${value.invalid}`};
      }
      return {ok: true, count: Number(value.count) || 0};
    });
  } catch (error) {
    return {ok: false, error: error?.message || String(error)};
  }
});

// Waits for a port this process handed out to start answering.
//
// The on-launch trigger needs this: the profile has just been spawned with
// --remote-debugging-port and the browser takes a second or two to bind it, so
// resolving the session immediately would find nothing and the run would report
// "not open" for a window that is opening.
ipcMain.handle('argus:wait-for-cdp', async (_event, {port, timeoutMs}) => {
  try {
    await waitForCdpReady(port, Math.min(Number(timeoutMs) || 20000, 60000));
    return {ok: true, cdpUrl: `http://127.0.0.1:${port}`};
  } catch (error) {
    return {ok: false, error: error?.message || String(error)};
  }
});

ipcMain.handle('argus:start-automation-run', async (_event, payload) => {
  try {
    const runId = await automationRunner.start({
      app,
      automation: payload.automation,
      profile: payload.profile,
      trigger: payload.trigger || 'manual',
      cdpUrl: payload.cdpUrl,
      vars: payload.vars,
      onEvent: sendRunEvent,
      // Lets a saveCookies step land its result the same way the extension's
      // push does -- through the renderer, which owns the cloud write and the
      // Cookies-tab toast (useAutomationBridge, same handler as the loopback
      // API's cookie-sync push route below).
      pushCookies: (profileId, cookies) =>
        askRendererOnPageChannel('argus:cookie-sync-push-request', {profileId, cookies}),
      // close_on_finish, which until now was a checkbox that saved and did
      // nothing. Two conditions, not one: the automation has to ask for it AND
      // this run has to have opened the browser itself. ownsSession comes from
      // the renderer, which is the only side that knows -- it is the half of
      // startRun that had to launch the profile because it was not already
      // open. Without it, ticking the box would close the window a user was
      // working in the moment they ran anything against that profile.
      onFinish: payload.automation?.close_on_finish && payload.ownsSession ?
        () => killAutomationLaunch(payload.profile.id) :
        undefined,
      // Notify-on-finish. The runner calls this between sealing the record and
      // flushing it, so the message reports the final verdict and a failed
      // send still lands in the record the user reads. This side owns the
      // connector registry and the OS notification; the returned row rides the
      // finished event to the renderer, which is the only side that can write
      // it to Supabase.
      onNotify: payload.automation?.notify_on ? (record) => {
        const {notify_on: notifyOn, notify_connector_id: connectorId} = payload.automation;
        if (!automationNotify.shouldNotify(notifyOn, record.status)) {
          return null;
        }
        const {title, body} = automationNotify.composeFinishMessage(record);
        // "Straight to Argus" is the built-in delivery: the bell row and the
        // desktop notification fire whenever the setting says notify, and a
        // connector -- when one is named -- is an additional channel out.
        raiseOsNotification(title, body);
        const notification = {
          kind: 'automation_run',
          title,
          body,
          status: record.status,
          automation_id: record.automation_id,
          run_id: record.id,
        };
        if (!connectorId) {
          return notification;
        }
        // The connector resolve AND send are caught HERE, not thrown to the
        // runner: a deleted connector or a dead webhook must not also cost the
        // user the bell row that would have told them about it. The failure
        // travels as sendError, which the runner logs into the record -- for a
        // deleted connector that is the sentence naming it.
        return Promise.resolve()
            .then(() => automationConnectors.send({
              connector: automationConnectors.resolve(connectorId, 'message'),
              message: `${title}\n${body}`,
              subject: title,
            }))
            .then(() => notification)
            .catch((error) => ({
              ...notification,
              sendError: error?.message || String(error),
            }));
      } : undefined,
    });
    return {ok: true, runId};
  } catch (error) {
    // 409 (this profile is busy) and 429 (too many runs) are answers, not
    // crashes -- the caller shows them as a message rather than a failure.
    return {ok: false, error: error?.message || String(error), status: error?.status || 500};
  }
});

ipcMain.handle('argus:cancel-automation-run', async (_event, {runId}) => {
  return {ok: automationRunner.cancel(runId)};
});

// The workspace's connectors, pushed over from the renderer.
//
// It is a push and not a pull because this process holds no Supabase
// credentials and must never start: the renderer is the only side that can
// read `connectors`, so it hands the resolved list across whenever it changes.
// Memory only -- nothing here is written to disk, exactly as run tokens are
// handled, and for the same reason.
ipcMain.handle('argus:set-connectors', async (_event, {connectors}) => {
  automationConnectors.setConnectors(connectors);
  return {ok: true};
});

// The Test button on a connector card: the smallest real thing that service
// allows. For an AI connector that is the cheapest completion the API will
// accept -- this answers "does this key reach this model", and a longer answer
// would cost the user money to learn nothing more. For a message connector it
// is one real message, because there is no cheaper way to prove a webhook or a
// chat id than to use it.
// What models an AI connector's endpoint actually serves, for the connector
// form's model picker. Takes the draft (key included) rather than an id for
// the same reason the Test button does: the endpoint being asked is the one
// about to be saved, not whatever the last save wrote.
ipcMain.handle('argus:list-connector-models', async (_event, {connector}) => {
  try {
    const models = await automationAi.listModels({provider: connector});
    return {ok: true, models};
  } catch (error) {
    // The provider's own words -- "invalid x-api-key" beats "could not load".
    return {ok: false, error: error?.message || String(error)};
  }
});

ipcMain.handle('argus:test-connector', async (_event, {connector}) => {
  try {
    if (connector?.category === 'message') {
      await automationConnectors.send({
        connector,
        message: 'Test message from Argus. Your connector works.',
        subject: 'Argus connector test',
      });
    } else {
      await automationAi.complete({
        provider: connector,
        user: 'Reply with the single word: ok',
        maxTokens: 8,
      });
    }
    return {ok: true};
  } catch (error) {
    // The service's own words. describeDbError has no equivalent here and a
    // generic "the test failed" would hide the one useful sentence.
    return {ok: false, error: error?.message || String(error)};
  }
});

// A run that is in flight right now, so a reopened window can rejoin one that
// started before it mounted rather than showing nothing.
ipcMain.handle('argus:active-automation-runs', async () => automationRunner.activeRuns());

ipcMain.handle('argus:read-run-screenshot', async (_event, {runId, name}) => {
  return automationStore.readScreenshot(app, runId, name);
});

// The crash buffer. Runs that reached a terminal status on disk but may never
// have been written to Supabase -- because the window was closed, or the user
// was signed out, when they finished.
ipcMain.handle('argus:pending-automation-runs', async () => automationStore.pendingRuns(app));

ipcMain.handle('argus:mark-automation-run-flushed', async (_event, {runId}) => {
  automationStore.markFlushed(app, runId);
  return {ok: true};
});

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

// Runs one of a launch's own automations, asked for by that launch's start page.
// The authorization and the refusal semantics live in run-token.cjs; this is
// only the part that needs the runner and the session.
function runFromPage(req, res) {
  handleRunFromPage({
    req,
    res,
    tokens: runTokens,
    sendJson,
    startRun: async (entry, automation) => {
      const session = await resolveProfileCdp(entry.profileId);
      // A token whose automations list is non-empty was minted alongside a
      // reserved port, so this cannot normally be reached -- but a run with
      // nowhere to connect has to say so rather than dial http://127.0.0.1:null.
      if (!session.running && !entry.cdpPort) {
        throw Object.assign(new Error('This session has no debugging port'), {status: 409});
      }
      const cdpUrl = session.running && session.cdpUrl ?
        session.cdpUrl :
        `http://127.0.0.1:${entry.cdpPort}`;
      return automationRunner.start({
        app,
        automation,
        profile: {id: entry.profileId, name: entry.profileName || ''},
        trigger: 'start-page',
        cdpUrl,
        onEvent: sendRunEvent,
        pushCookies: (profileId, cookies) =>
          askRendererOnPageChannel('argus:cookie-sync-push-request', {profileId, cookies}),
      });
    },
  });
}

// Re-checks the proxy assigned to a launch's profile, asked for by that
// launch's start page.
//
// It goes through the renderer rather than calling checkProxy() here, which
// would be shorter. The renderer owns the cloud data: it can record the result
// against the proxy row (useProxyActions.recordCheck), so the Proxies tab and
// every other profile using that proxy agree with what the page now says, and
// it owns homeProxyStatus, which is the one place the panel's wording is
// decided. Answering from here would mean a second copy of both.
const pendingPageRequests = new Map();

function askRendererForRecheck(profileId) {
  return new Promise((resolve, reject) => {
    if (!mainWindow) {
      reject(Object.assign(new Error('Argus Launcher is not open'), {status: 503}));
      return;
    }
    const requestId = crypto.randomUUID();
    // A proxy check is three concurrent curl runs with --max-time 10, so it
    // fits inside the standard automation timeout with room to spare.
    const timeout = setTimeout(() => {
      pendingPageRequests.delete(requestId);
      reject(Object.assign(
          new Error('Timed out waiting for Argus Launcher to answer'), {status: 504}));
    }, AUTOMATION_REQUEST_TIMEOUT_MS);
    pendingPageRequests.set(requestId, {resolve, reject, timeout});
    mainWindow.webContents.send('argus:recheck-proxy-request', {requestId, profileId});
  });
}

ipcMain.on('argus:recheck-proxy-result', (_event, {requestId, result, error}) => {
  const pending = pendingPageRequests.get(requestId);
  if (!pending) {
    return;
  }
  pendingPageRequests.delete(requestId);
  clearTimeout(pending.timeout);
  if (error) {
    pending.reject(Object.assign(new Error(error), {status: 500}));
    return;
  }
  pending.resolve(result);
});

function recheckFromPage(req, res) {
  handleRecheckFromPage({
    req,
    res,
    tokens: runTokens,
    sendJson,
    recheck: (entry) => askRendererForRecheck(entry.profileId),
  });
}

// The cookie-sync page routes' renderer round trips. Same pendingPageRequests
// map and the same settle shape as the recheck above; the work itself lives in
// useAutomationBridge, which owns the cloud state and the Cookies-tab toast.
function askRendererOnPageChannel(channel, payload) {
  return new Promise((resolve, reject) => {
    if (!mainWindow) {
      reject(Object.assign(new Error('Argus Launcher is not open'), {status: 503}));
      return;
    }
    const requestId = crypto.randomUUID();
    const timeout = setTimeout(() => {
      pendingPageRequests.delete(requestId);
      reject(Object.assign(
          new Error('Timed out waiting for Argus Launcher to answer'), {status: 504}));
    }, AUTOMATION_REQUEST_TIMEOUT_MS);
    pendingPageRequests.set(requestId, {resolve, reject, timeout});
    mainWindow.webContents.send(channel, {...payload, requestId});
  });
}

function settlePageRequest(requestId, result, error) {
  const pending = pendingPageRequests.get(requestId);
  if (!pending) {
    return;
  }
  pendingPageRequests.delete(requestId);
  clearTimeout(pending.timeout);
  if (error) {
    pending.reject(Object.assign(new Error(error), {status: 500}));
    return;
  }
  pending.resolve(result);
}

ipcMain.on('argus:cookie-sync-push-result', (_event, {requestId, result, error}) =>
  settlePageRequest(requestId, result, error));
ipcMain.on('argus:cookie-sync-pull-result', (_event, {requestId, result, error}) =>
  settlePageRequest(requestId, result, error));

function cookiePushFromProfile(req, res) {
  handleCookiePushFromPage({
    req, res, tokens: runTokens, sendJson,
    pushCookies: (entry, cookies, saveAs) =>
      askRendererOnPageChannel('argus:cookie-sync-push-request',
          {profileId: entry.profileId, cookies, saveAs}),
  });
}

function cookiePullForProfile(req, res) {
  handleCookiePullFromPage({
    req, res, tokens: runTokens, sendJson,
    pullCookies: (entry) =>
      askRendererOnPageChannel('argus:cookie-sync-pull-request',
          {profileId: entry.profileId}),
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

    // Above the bearer gate on purpose: the caller is a file:// page, which has
    // no key and must never be given one. Both authenticate with a per-launch
    // run token instead -- see runTokens for what that does and does not
    // authorize. Neither is in electron/api/routes.json: they are not part of
    // the keyed surface and must never be advertised as one, which is why
    // verify-api-routes skips them by name.
    if (req.method === 'POST' && parsedUrl.pathname === '/v1/automations/run-from-page') {
      runFromPage(req, res);
      return;
    }
    if (req.method === 'POST' && parsedUrl.pathname === '/v1/proxies/recheck-from-page') {
      recheckFromPage(req, res);
      return;
    }
    // Same exemption as the two page routes above: the caller is the bundled
    // cookie-manager extension holding a per-launch run token, not a keyed
    // client. Neither route is in electron/api/routes.json on purpose;
    // verify-api-routes skips them by name.
    if (req.method === 'POST' && parsedUrl.pathname === '/v1/cookies/push-from-profile') {
      cookiePushFromProfile(req, res);
      return;
    }
    if (req.method === 'POST' && parsedUrl.pathname === '/v1/cookies/pull-for-profile') {
      cookiePullForProfile(req, res);
      return;
    }

    const key = resolveAutomationKey(req);
    if (!key) {
      sendJson(res, 401, {status: false, msg: 'Missing or invalid Authorization bearer token'});
      return;
    }

    // Table-driven routes, ahead of the hand-written blocks below.
    //
    // Automations are org-wide objects with no folder of their own, so folder
    // scope cannot be applied to them the way it is applied to a profile. A
    // scoped key may therefore list, read and run them -- running still checks
    // the profile's folder in the renderer -- but may not author them. Anything
    // else would let a key granted one folder rewrite a workflow every other
    // folder runs.
    const tableRoute = ROUTE_BY_KEY.get(`${req.method} ${parsedUrl.pathname}`);
    if (tableRoute && (tableRoute.channel || tableRoute.local)) {
      if (tableRoute.scope === 'unscoped' && key.folderScope) {
        sendJson(res, 403, {
          status: false,
          msg: 'This key is scoped to a folder, and automations are shared across all of them. ' +
            'Use an unscoped key to create, change or delete one.',
        });
        return;
      }
      if (tableRoute.local) {
        // Answered here: the step catalogue is a static file in this process,
        // and a renderer round trip for it would only add a way to fail.
        sendJson(res, 200, {status: true, steps: stepSchema});
        return;
      }
      // The calling key's own identity, forwarded alongside its folder scope.
      //
      // Everything the renderer writes goes through the signed-in user's
      // Supabase session, so auth.uid() is whoever has the launcher open --
      // never the key holder. For most routes that does not matter: a profile
      // renamed over the API is simply renamed. For anything that records WHO
      // did something it matters entirely, because without this a note written
      // by an agent is indistinguishable from one the user typed. This is the
      // only channel through which that distinction can cross.
      //
      // Name and id only. The token is hashed and must not leave this process,
      // and ownerUserId is not the author either -- it is who created the key.
      const agent = {id: key.id, name: key.name};
      if (req.method === 'GET') {
        askRenderer(res, tableRoute.channel, {agent, allowedFolders: key.folderScope});
        return;
      }
      readJsonBody(req, res, (payload) => {
        const {payload: forwarded, error} = payloadForRoute(tableRoute, payload);
        if (error) {
          sendJson(res, 400, {status: false, msg: error});
          return;
        }
        askRenderer(res, tableRoute.channel, {
          ...forwarded, agent, allowedFolders: key.folderScope,
        });
      });
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
    // Was sixteen chained pathname comparisons. Same set, read off the table
    // that also documents them, so a route cannot be served without being
    // documented or documented without being served.
    if (req.method !== 'POST' || !ROUTE_BY_KEY.has(`POST ${parsedUrl.pathname}`)) {
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
      // Where a running profile's CDP endpoint is. Answered entirely in this
      // process -- no renderer round trip -- so it stays available while the
      // window is busy, and so an MCP server can hold no session state at all.
      if (parsedUrl.pathname === '/v1/profiles/cdp') {
        if (!payload.profileId || typeof payload.profileId !== 'string') {
          sendJson(res, 400, {status: false, msg: 'profileId is required'});
          return;
        }
        const session = await resolveProfileCdp(payload.profileId);
        if (session.running && !maySeeAutomationSession(key, session)) {
          sendJson(res, 403, {status: false, msg: 'This key did not launch that profile'});
          return;
        }
        sendJson(res, 200, {
          status: true,
          profileId: payload.profileId,
          running: session.running,
          cdpUrl: session.cdpUrl,
          pid: session.pid,
        });
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
          // Without this the check always dialled http:// -- proxyUrl() picks
          // socks5h purely off `type`, so every socks5-only proxy tested
          // through the automation API reported dead while the same proxy
          // checked fine from the Proxies tab, which does pass it.
          type: typeof payload.type === 'string' ? payload.type : undefined,
          username: typeof payload.username === 'string' ? payload.username : undefined,
          password: typeof payload.password === 'string' ? payload.password : undefined,
        });
        sendJson(res, 200, {status: true, ...result});
        return;
      }
      let cdpPort = null;
      if (isLaunchAutomation) {
        // Launching a profile that is already open used to kill the live window
        // and relaunch it on a fresh port -- spawnProfile calls
        // killStaleProfileProcess deliberately, because Chromium's
        // single-instance handoff otherwise swallows --remote-debugging-port.
        // For a script that is holding a session open, that turned a harmless
        // second call into "my browser just closed". Hand back the running
        // session instead, and keep the destructive path behind relaunch:true.
        const existing = await resolveProfileCdp(payload.profileId);
        if (existing.running && !payload.relaunch) {
          if (!maySeeAutomationSession(key, existing)) {
            sendJson(res, 403, {status: false, msg: 'This key did not launch that profile'});
            return;
          }
          sendJson(res, 200, {
            status: true,
            profileId: payload.profileId,
            cdpUrl: existing.cdpUrl,
            pid: existing.pid,
            reused: true,
          });
          return;
        }
        if (existing.running && !maySeeAutomationSession(key, existing)) {
          sendJson(res, 403, {status: false, msg: 'This key did not launch that profile'});
          return;
        }
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
          allowedFolders: key.folderScope,
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
        // Brand marks only, and the empty string to clear. ArgusProfile.avatar
        // also accepts an https URL, but that half is the editor's: a URL here
        // would let a key holder point every avatar in the org at a host of
        // their choosing and have the launcher fetch it on every render. A
        // `brand:` slug is a dozen bytes resolved against a catalog that ships
        // with the app, so it cannot reach the network at all.
        if (payload.avatar === '' ||
            (typeof payload.avatar === 'string' && payload.avatar.startsWith('brand:'))) {
          fields.avatar = payload.avatar;
        }
        if (typeof payload.folderId === 'string' || payload.folderId === null) fields.folder_id = payload.folderId;
        if (typeof payload.email === 'string') fields.email = payload.email;
        if (typeof payload.password === 'string') fields.password = payload.password;
        mainWindow.webContents.send('argus:update-profile-request', {
          requestId,
          profileId: payload.profileId,
          fields,
          allowedFolders: key.folderScope,
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
          allowedFolders: key.folderScope,
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
      } else if (parsedUrl.pathname === '/v1/cookies/bulk-match') {
        mainWindow.webContents.send('argus:bulk-match-cookies-request', {
          requestId,
          folderPath: payload.folderPath,
          // profileIds omitted/empty means "match against every profile".
          profileIds: Array.isArray(payload.profileIds) ? payload.profileIds : null,
        });
      } else {
        // bulk-match used to be this branch, reached by elimination. That was
        // survivable while the allow-list above was written out by hand -- the
        // two lists were edited together or not at all. Now that the allow-list
        // is derived from routes.json, a route added to the table without a
        // handler here would have been silently answered as a cookie import
        // against whatever folderPath the caller happened to send.
        pendingAutomationRequests.delete(requestId);
        clearTimeout(timeout);
        sendJson(res, 501, {
          status: false,
          msg: `${parsedUrl.pathname} is documented but not implemented`,
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
  // Cold start from a deep link on Windows/Linux: the URL is in our own argv
  // rather than arriving via 'second-instance'. macOS uses 'open-url', which
  // may already have queued something by now.
  const initialLink = deepLinkFromArgv(process.argv);
  if (initialLink) {
    handleDeepLink(initialLink);
  }
});
app.whenReady().then(startAutomationApiServer);

// Run artifacts are PNGs, so they get a shorter life than the 30-day Trash
// contract rows do. Deferred off the startup path: this walks a directory that
// grows with use, and nothing waits on the result.
app.whenReady().then(() => {
  setTimeout(() => {
    try {
      automationStore.sweep(app);
    } catch {
      // A sweep that cannot run is not worth a startup failure.
    }
  }, 10000).unref();
});

// Tokens live in memory only -- they are never written to automation-keys.json
// and never logged -- so quitting is already the end of them. Cleared
// explicitly so a future change that persists this map has to think about it.
app.on('will-quit', () => {
  runTokens.clear();
});

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
