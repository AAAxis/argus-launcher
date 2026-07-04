const {app, BrowserWindow, dialog, ipcMain, nativeImage} = require('electron');
const {spawn, spawnSync} = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const {pathToFileURL} = require('node:url');

app.setName('Argys Anty');

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
  if (fingerprintLanguage) {
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
  return readSettings().browserAppPath ||
    process.env.ARGUS_BROWSER_APP ||
    '/Applications/Argys Browser.app';
}

function browserAppCandidates(preferredAppPath) {
  const candidates = [
    preferredAppPath,
    '/Applications/Argys Browser.app',
  ];
  return [...new Set(candidates.filter(Boolean))];
}

function createWindow() {
  const icon = appIconPath();
  if (process.platform === 'darwin' && icon) {
    app.dock?.setIcon(nativeImage.createFromPath(icon));
  }
  const win = new BrowserWindow({
    title: 'Argys Anty',
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

function builtInCookieExtensionPath() {
  const candidate = path.join(__dirname, '../extensions/cookie-manager');
  return fs.existsSync(path.join(candidate, 'manifest.json')) ? candidate : '';
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

function writeCookieSeedExtension(payload) {
  if (!payload.cookieImportPath) {
    return '';
  }
  let cookies = [];
  try {
    cookies = parseCookieFile(payload.cookieImportPath);
  } catch {
    return '';
  }
  if (!cookies.length) {
    return '';
  }
  const extensionDir = path.join(payload.userDataDir, 'ArgysCookieSeed');
  fs.mkdirSync(extensionDir, {recursive: true});
  fs.writeFileSync(path.join(extensionDir, 'manifest.json'), JSON.stringify({
    manifest_version: 3,
    name: `Argys Cookie Seed ${payload.name || ''}`.trim(),
    version: '1.0.0',
    permissions: ['cookies', 'storage'],
    host_permissions: ['<all_urls>'],
    background: {service_worker: 'background.js'},
  }, null, 2));
  fs.writeFileSync(path.join(extensionDir, 'cookies.json'), JSON.stringify({cookies}, null, 2));
  fs.writeFileSync(path.join(extensionDir, 'background.js'), `
const IMPORT_KEY = 'argysCookieSeedImported';

async function importCookies() {
  const state = await chrome.storage.local.get(IMPORT_KEY);
  if (state[IMPORT_KEY]) return;
  const response = await fetch(chrome.runtime.getURL('cookies.json'));
  const payload = await response.json();
  const cookies = Array.isArray(payload.cookies) ? payload.cookies : [];
  let imported = 0;
  for (const cookie of cookies) {
    try {
      const details = {
        url: cookie.url,
        name: cookie.name,
        value: String(cookie.value ?? ''),
        path: cookie.path || '/',
        secure: Boolean(cookie.secure),
        httpOnly: Boolean(cookie.httpOnly),
        sameSite: cookie.sameSite || 'lax',
      };
      if (cookie.domain) details.domain = cookie.domain;
      if (cookie.expirationDate) details.expirationDate = cookie.expirationDate;
      await chrome.cookies.set(details);
      imported++;
    } catch (error) {
      console.warn('Argys cookie import failed', cookie?.domain, cookie?.name, error);
    }
  }
  await chrome.storage.local.set({[IMPORT_KEY]: true, imported, importedAt: Date.now()});
}

chrome.runtime.onInstalled.addListener(() => void importCookies());
chrome.runtime.onStartup.addListener(() => void importCookies());
void importCookies();
`);
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

function proxyUrl(proxy) {
  const scheme = proxy.type === 'socks5' ? 'socks5h' : 'http';
  return `${scheme}://${proxy.host}:${proxy.port}`;
}

function checkProxy(proxy) {
  if (!proxy?.host || !proxy.port) {
    return {ok: false, error: 'Proxy host and port are required'};
  }
  const started = Date.now();
  const endpoints = [
    'http://ip-api.com/json/',
    'https://ipapi.co/json/',
    'https://ipinfo.io/json',
  ];
  const errors = [];

  for (const endpoint of endpoints) {
    const args = [
      '--silent',
      '--show-error',
      '--location',
      '--max-time',
      '20',
      '--proxy',
      proxyUrl(proxy),
    ];
    if (proxy.username || proxy.password) {
      args.push('--proxy-user', `${proxy.username || ''}:${proxy.password || ''}`);
    }
    args.push(endpoint);
    const result = spawnSync('/usr/bin/curl', args, {
      encoding: 'utf8',
      maxBuffer: 1024 * 1024,
    });
    const pingMs = Date.now() - started;
    if (result.status !== 0) {
      errors.push((result.stderr || result.stdout || `Proxy check failed at ${endpoint}`).trim());
      continue;
    }
    try {
      const data = JSON.parse(result.stdout);
      if (data.error || data.status === 'fail') {
        errors.push(data.reason || data.message || `Proxy lookup failed at ${endpoint}`);
        continue;
      }
      const country = data.country_name || data.countryName || data.country;
      const countryCode = data.country_code || data.countryCode ||
        (typeof data.country === 'string' && data.country.length === 2 ? data.country : undefined);
      return {
        ok: true,
        ip: data.ip || data.query,
        country,
        countryCode,
        pingMs,
      };
    } catch {
      errors.push(`Proxy check returned invalid JSON at ${endpoint}`);
    }
  }

  return {
    ok: false,
    pingMs: Date.now() - started,
    error: errors.filter(Boolean).join(' · ') || 'Proxy check failed',
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
  fs.mkdirSync(homeDir, {recursive: true});
  const homePath = path.join(homeDir, 'home.html');
  fs.writeFileSync(homePath, html);
  return pathToFileURL(homePath).toString();
}

function writeProfileStartupPrefs(userDataDir, launchUrl) {
  if (!userDataDir || !launchUrl) {
    return;
  }
  const defaultDir = path.join(userDataDir, 'Default');
  fs.mkdirSync(defaultDir, {recursive: true});
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

function writeProfileLauncherApp(payload, resolved, args, timezone) {
  const appPath = profileLauncherPath(payload);
  const contentsDir = path.join(appPath, 'Contents');
  const macosDir = path.join(contentsDir, 'MacOS');
  const resourcesDir = path.join(contentsDir, 'Resources');
  fs.mkdirSync(macosDir, {recursive: true});
  fs.mkdirSync(resourcesDir, {recursive: true});

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

// Shared by the normal launch-profile handler and the Facebook-login-fetch
// automation: builds the launcher args/app and spawns the browser. `extraArgs`
// lets the automation path append --remote-debugging-port for CDP without
// exposing it on ordinary launches.
function spawnProfile(payload, extraArgs = []) {
  const resolved = resolveBrowserExecutable();
  if (!resolved) {
    return {
      ok: false,
      error:
        'Argys Browser is not installed. Set the browser app path or install /Applications/Argys Browser.app.',
    };
  }
  const extensionPaths = [
    builtInCookieExtensionPath(),
    ...(payload.extensionPaths || []),
  ].filter(Boolean);
  killExistingProfileProcess(payload.id, payload.userDataDir);
  clearSessionRestore(payload.userDataDir);
  const launchUrl = payload.startUrl || writeHomeFile(payload);
  writeProfileStartupPrefs(payload.userDataDir, launchUrl);
  const seedExtensionPath = writeCookieSeedExtension(payload);
  if (seedExtensionPath) {
    extensionPaths.push(seedExtensionPath);
  }
  const uniqueExtensionPaths = [...new Set(extensionPaths)];
  const switches = splitSwitches(payload.commandLineSwitches);
  const timezone = resolveTimezone(payload.fingerprintTimezone, payload.proxy);
  const language = resolveLanguage(payload.fingerprintLanguage, payload.proxy);
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
    ...(uniqueExtensionPaths.length ? [`--load-extension=${uniqueExtensionPaths.join(',')}`] : []),
    ...switches,
    ...(!hasLangSwitch && language ? [`--lang=${language}`] : []),
    ...extraArgs,
    launchUrl,
  ];

  try {
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
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

ipcMain.handle('argus:launch-profile', async (_event, payload) => {
  return spawnProfile(payload);
});

ipcMain.handle('argus:check-proxy', async (_event, proxy) => {
  return checkProxy(proxy);
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
  return {path: filePath, count: cookies.length};
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
      matches[name] = {path: filePath, count: cookies.length};
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

app.whenReady().then(createWindow);

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
