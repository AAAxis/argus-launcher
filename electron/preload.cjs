const {contextBridge, ipcRenderer} = require('electron');

contextBridge.exposeInMainWorld('argusNative', {
  launchProfile: (payload) => ipcRenderer.invoke('argus:launch-profile', payload),
  checkProxy: (proxy) => ipcRenderer.invoke('argus:check-proxy', proxy),
  getUpdateStatus: () => ipcRenderer.invoke('argus:update-status'),
  checkForUpdates: () => ipcRenderer.invoke('argus:check-for-updates'),
  downloadUpdate: () => ipcRenderer.invoke('argus:download-update'),
  installUpdate: () => ipcRenderer.invoke('argus:install-update'),
  onUpdateState: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('argus:update-state', listener);
    return () => ipcRenderer.removeListener('argus:update-state', listener);
  },
  getResourceStatus: () => ipcRenderer.invoke('argus:resource-status'),
  downloadBrowserResource: () => ipcRenderer.invoke('argus:download-browser-resource'),
  onResourceState: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('argus:resource-state', listener);
    return () => ipcRenderer.removeListener('argus:resource-state', listener);
  },
  getApiStatus: () => ipcRenderer.invoke('argus:api-status'),
  onApiState: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('argus:api-state', listener);
    return () => ipcRenderer.removeListener('argus:api-state', listener);
  },
  selectExtensionFolder: () => ipcRenderer.invoke('argus:select-extension-folder'),
  zipExtensionFolder: (folderPath) => ipcRenderer.invoke('argus:zip-extension-folder', folderPath),
  selectCookieFile: () => ipcRenderer.invoke('argus:select-cookie-file'),
  selectCookieFolder: () => ipcRenderer.invoke('argus:select-cookie-folder'),
  matchCookieFiles: (folderPath, profileNames) =>
    ipcRenderer.invoke('argus:match-cookie-files', {folderPath, profileNames}),
  saveTextFile: (defaultName, content) =>
    ipcRenderer.invoke('argus:save-text-file', {defaultName, content}),
  selectImportCsv: () => ipcRenderer.invoke('argus:select-import-csv'),
  onBulkMatchCookiesRequest: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('argus:bulk-match-cookies-request', listener);
    return () => ipcRenderer.removeListener('argus:bulk-match-cookies-request', listener);
  },
  sendBulkMatchCookiesResult: (requestId, result, error) =>
    ipcRenderer.send('argus:bulk-match-cookies-result', {requestId, result, error}),
});
