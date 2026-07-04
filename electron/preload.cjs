const {contextBridge, ipcRenderer} = require('electron');

contextBridge.exposeInMainWorld('argusNative', {
  launchProfile: (payload) => ipcRenderer.invoke('argus:launch-profile', payload),
  checkProxy: (proxy) => ipcRenderer.invoke('argus:check-proxy', proxy),
  selectExtensionFolder: () => ipcRenderer.invoke('argus:select-extension-folder'),
  selectCookieFile: () => ipcRenderer.invoke('argus:select-cookie-file'),
});
