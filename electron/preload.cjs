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
});
