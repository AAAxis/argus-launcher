const {app, BrowserWindow, ipcMain} = require('electron');
const {spawn} = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

app.setName('Argys Anty');

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

function createWindow() {
  const win = new BrowserWindow({
    title: 'Argys Anty',
    width: 1180,
    height: 760,
    minWidth: 980,
    minHeight: 620,
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

ipcMain.handle('argus:launch-profile', async (_event, payload) => {
  const executable = appExecutable(browserAppPath());
  const extensionPaths = payload.extensionPaths || [];
  const args = [
    '--argus-profile-launch',
    `--argus-profile-id=${payload.id}`,
    `--argus-profile-name=${payload.name}`,
    `--user-data-dir=${payload.userDataDir}`,
    ...proxyArgs(payload.proxy),
    ...extensionPaths.map((extensionPath) => `--load-extension=${extensionPath}`),
    ...splitSwitches(payload.commandLineSwitches),
    payload.startUrl || 'chrome://argus-newtab',
  ];

  const child = spawn(executable, args, {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
  return {ok: true, pid: child.pid || 0};
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
