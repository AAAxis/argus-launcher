const {contextBridge, ipcRenderer} = require('electron');

contextBridge.exposeInMainWorld('argusNative', {
  launchProfile: (payload) => ipcRenderer.invoke('argus:launch-profile', payload),
  getBrowserPath: () => ipcRenderer.invoke('argus:get-browser-path'),
  setBrowserPath: (browserAppPath) =>
    ipcRenderer.invoke('argus:set-browser-path', browserAppPath),
});
