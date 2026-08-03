const {contextBridge, ipcRenderer} = require('electron');

contextBridge.exposeInMainWorld('argusNative', {
  launchProfile: (payload, extraArgs) => ipcRenderer.invoke('argus:launch-profile', payload, extraArgs),
  listApiKeys: () => ipcRenderer.invoke('argus:list-api-keys'),
  createApiKey: (name, folderScope) => ipcRenderer.invoke('argus:create-api-key', {name, folderScope}),
  revokeApiKey: (id) => ipcRenderer.invoke('argus:revoke-api-key', id),
  applyIntegrationConfig: (integrationId, dir, token, base) =>
    ipcRenderer.invoke('argus:apply-integration-config', {integrationId, dir, token, base}),
  checkProxy: (proxy) => ipcRenderer.invoke('argus:check-proxy', proxy),
  openExternal: (url) => ipcRenderer.invoke('argus:open-external', url),
  onDeepLink: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('argus:deep-link', listener);
    return () => ipcRenderer.removeListener('argus:deep-link', listener);
  },
  deepLinkReady: () => ipcRenderer.invoke('argus:deep-link-ready'),
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
  onPushLocalCookiesRequest: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('argus:push-local-cookies-request', listener);
    return () => ipcRenderer.removeListener('argus:push-local-cookies-request', listener);
  },
  sendPushLocalCookiesResult: (requestId, result, error) =>
    ipcRenderer.send('argus:push-local-cookies-result', {requestId, result, error}),
  onReimportProxiesRequest: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('argus:reimport-proxies-request', listener);
    return () => ipcRenderer.removeListener('argus:reimport-proxies-request', listener);
  },
  sendReimportProxiesResult: (requestId, result, error) =>
    ipcRenderer.send('argus:reimport-proxies-result', {requestId, result, error}),
  onAssignProfileProxyRequest: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('argus:assign-profile-proxy-request', listener);
    return () => ipcRenderer.removeListener('argus:assign-profile-proxy-request', listener);
  },
  sendAssignProfileProxyResult: (requestId, result, error) =>
    ipcRenderer.send('argus:assign-profile-proxy-result', {requestId, result, error}),
  onGetProfileRequest: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('argus:get-profile-request', listener);
    return () => ipcRenderer.removeListener('argus:get-profile-request', listener);
  },
  sendGetProfileResult: (requestId, result, error) =>
    ipcRenderer.send('argus:get-profile-result', {requestId, result, error}),
  onListProxiesRequest: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('argus:list-proxies-request', listener);
    return () => ipcRenderer.removeListener('argus:list-proxies-request', listener);
  },
  sendListProxiesResult: (requestId, result, error) =>
    ipcRenderer.send('argus:list-proxies-result', {requestId, result, error}),
  onCreateProxyRequest: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('argus:create-proxy-request', listener);
    return () => ipcRenderer.removeListener('argus:create-proxy-request', listener);
  },
  sendCreateProxyResult: (requestId, result, error) =>
    ipcRenderer.send('argus:create-proxy-result', {requestId, result, error}),
  onUpdateProxyRequest: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('argus:update-proxy-request', listener);
    return () => ipcRenderer.removeListener('argus:update-proxy-request', listener);
  },
  sendUpdateProxyResult: (requestId, result, error) =>
    ipcRenderer.send('argus:update-proxy-result', {requestId, result, error}),
  onDeleteProxyRequest: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('argus:delete-proxy-request', listener);
    return () => ipcRenderer.removeListener('argus:delete-proxy-request', listener);
  },
  sendDeleteProxyResult: (requestId, result, error) =>
    ipcRenderer.send('argus:delete-proxy-result', {requestId, result, error}),
  onUpdateProfileRequest: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('argus:update-profile-request', listener);
    return () => ipcRenderer.removeListener('argus:update-profile-request', listener);
  },
  sendUpdateProfileResult: (requestId, result, error) =>
    ipcRenderer.send('argus:update-profile-result', {requestId, result, error}),
  onDeleteProfileRequest: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('argus:delete-profile-request', listener);
    return () => ipcRenderer.removeListener('argus:delete-profile-request', listener);
  },
  sendDeleteProfileResult: (requestId, result, error) =>
    ipcRenderer.send('argus:delete-profile-result', {requestId, result, error}),
  onUpdateFingerprintRequest: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('argus:update-fingerprint-request', listener);
    return () => ipcRenderer.removeListener('argus:update-fingerprint-request', listener);
  },
  sendUpdateFingerprintResult: (requestId, result, error) =>
    ipcRenderer.send('argus:update-fingerprint-result', {requestId, result, error}),
  onLaunchAutomationRequest: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('argus:launch-automation-request', listener);
    return () => ipcRenderer.removeListener('argus:launch-automation-request', listener);
  },
  sendLaunchAutomationResult: (requestId, result, error) =>
    ipcRenderer.send('argus:launch-automation-result', {requestId, result, error}),
  onListProfilesRequest: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('argus:list-profiles-request', listener);
    return () => ipcRenderer.removeListener('argus:list-profiles-request', listener);
  },
  sendListProfilesResult: (requestId, result, error) =>
    ipcRenderer.send('argus:list-profiles-result', {requestId, result, error}),
  onMonitoringReportRequest: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('argus:monitoring-report-request', listener);
    return () => ipcRenderer.removeListener('argus:monitoring-report-request', listener);
  },
  sendMonitoringReportResult: (requestId, result, error) =>
    ipcRenderer.send('argus:monitoring-report-result', {requestId, result, error}),
  onOAuthAuthorizeRequest: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('argus:oauth-authorize-request', listener);
    return () => ipcRenderer.removeListener('argus:oauth-authorize-request', listener);
  },
  sendOAuthAuthorizeResult: (requestId, approved, folderScope, keyName) =>
    ipcRenderer.send('argus:oauth-authorize-result', {requestId, approved, folderScope, keyName}),
});
