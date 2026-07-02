import {app, BrowserWindow, ipcMain} from 'electron';
import Store from 'electron-store';
import {spawn} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const store = new Store({
  defaults: {
    browserAppPath:
      process.env.ARGUS_BROWSER_APP || '/Applications/Argus Browser.app',
  },
});

function createWindow() {
  const win = new BrowserWindow({
    title: 'Argus Launcher',
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
  if (!app.isPackaged) {
    void win.loadURL(devUrl);
  } else {
    void win.loadFile(path.join(__dirname, '../dist/index.html'));
  }
}

function appExecutable(appPath) {
  if (appPath.endsWith('.app')) {
    return path.join(appPath, 'Contents/MacOS/Argus');
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
  const executable = appExecutable(store.get('browserAppPath'));
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
  return store.get('browserAppPath');
});

ipcMain.handle('argus:set-browser-path', async (_event, browserAppPath) => {
  store.set('browserAppPath', browserAppPath);
  return browserAppPath;
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
