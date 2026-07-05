const {contextBridge, ipcRenderer} = require('electron');

contextBridge.exposeInMainWorld('argusNative', {
  launchProfile: (payload) => ipcRenderer.invoke('argus:launch-profile', payload),
  checkProxy: (proxy) => ipcRenderer.invoke('argus:check-proxy', proxy),
  selectExtensionFolder: () => ipcRenderer.invoke('argus:select-extension-folder'),
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
