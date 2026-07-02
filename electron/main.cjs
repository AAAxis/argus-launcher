const {app, BrowserWindow, ipcMain, nativeImage} = require('electron');
const {spawn} = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

app.setName('Argys Anty');

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
    '/Applications/Argus.app',
    path.join(app.getPath('home'), 'Desktop/Argus.app'),
    path.join(app.getPath('home'), 'argus-browser/out/Release-dmg/Argus.app'),
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

function proxyArgs(proxy) {
  if (!proxy?.host || !proxy.port) {
    return [];
  }
  const scheme = proxy.type === 'socks5' ? 'socks5' : 'http';
  const args = [`--proxy-server=${scheme}://${proxy.host}:${proxy.port}`];
  if (proxy.username || proxy.password) {
    args.push(`--argus-proxy-user=${proxy.username || ''}`);
    args.push(`--argus-proxy-pass=${proxy.password || ''}`);
  }
  return args;
}

function fallbackHomeUrl(profileName) {
  const safeName = String(profileName || 'Profile')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;');
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${safeName}</title>
<style>body{margin:0;display:grid;min-height:100vh;place-items:center;background:#fbfaf8;color:#1d1c18;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}main{text-align:center}h1{font-size:36px;margin:0 0 10px}p{color:#716b62;font-size:17px}</style>
</head><body><main><h1>${safeName}</h1><p>Anonymous Argys Browser session</p></main></body></html>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
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

function writeProfileLauncherApp(payload, resolved, args) {
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
  const script = `#!/bin/zsh
set -e
ARGYS_BROWSER_BIN=${shellQuote(resolved.executable)}
PROFILE_MARKER=${shellQuote(`argus-profile-id=${payload.id || ''}`)}
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

ipcMain.handle('argus:launch-profile', async (_event, payload) => {
  const resolved = resolveBrowserExecutable();
  if (!resolved) {
    return {
      ok: false,
      error:
        'Argys Browser is not installed. Set the browser app path or install /Applications/Argys Browser.app.',
    };
  }
  const executable = resolved.executable;
  const extensionPaths = payload.extensionPaths || [];
  const args = [
    '--argus-profile-launch',
    `--argus-profile-id=${payload.id}`,
    `--argus-profile-name=${payload.name}`,
    `--user-data-dir=${payload.userDataDir}`,
    ...proxyArgs(payload.proxy),
    ...extensionPaths.map((extensionPath) => `--load-extension=${extensionPath}`),
    ...splitSwitches(payload.commandLineSwitches),
    payload.startUrl || fallbackHomeUrl(payload.name),
  ];

  try {
    const profileAppPath = writeProfileLauncherApp(payload, resolved, args);
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
