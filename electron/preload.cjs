const {contextBridge, ipcRenderer} = require('electron');
const {routes: apiRoutes} = require('./api/routes.json');

// The channels a table-driven API route may use. An allow-list, not a
// pass-through: onApiRequest takes a channel name from the renderer, and a
// renderer that could name any channel could subscribe to every one of them.
const API_CHANNELS = new Set(
    apiRoutes.map((route) => route.channel).filter(Boolean));

contextBridge.exposeInMainWorld('argusNative', {
  launchProfile: (payload, extraArgs) => ipcRenderer.invoke('argus:launch-profile', payload, extraArgs),
  listApiKeys: (ownerUserId) => ipcRenderer.invoke('argus:list-api-keys', ownerUserId),
  createApiKey: (name, folderScope, meta) =>
    ipcRenderer.invoke('argus:create-api-key', {name, folderScope, ...(meta || {})}),
  revokeApiKey: (id) => ipcRenderer.invoke('argus:revoke-api-key', id),
  applyIntegrationConfig: (integrationId, token) =>
    ipcRenderer.invoke('argus:apply-integration-config', {integrationId, token}),
  integrationStatus: (integrationId) =>
    ipcRenderer.invoke('argus:integration-status', {integrationId}),
  removeIntegrationConfig: (integrationId) =>
    ipcRenderer.invoke('argus:remove-integration-config', {integrationId}),
  repairIntegration: (integrationId) =>
    ipcRenderer.invoke('argus:repair-integration', {integrationId}),
  verifyIntegration: (integrationId) =>
    ipcRenderer.invoke('argus:verify-integration', {integrationId}),
  detectIntegrations: () => ipcRenderer.invoke('argus:detect-integrations'),
  checkProxy: (proxy) => ipcRenderer.invoke('argus:check-proxy', proxy),
  checkSelector: (profileId, selector) =>
    ipcRenderer.invoke('argus:check-selector', {profileId, selector}),
  openExternal: (url) => ipcRenderer.invoke('argus:open-external', url),
  bookmarkFavicon: (url) => ipcRenderer.invoke('argus:bookmark-favicon', url),
  setTheme: (preference) => ipcRenderer.invoke('argus:set-theme', preference),
  getLoginItem: () => ipcRenderer.invoke('argus:get-login-item'),
  setLoginItem: (enabled) => ipcRenderer.invoke('argus:set-login-item', enabled),
  resolveProfileRoot: (root) => ipcRenderer.invoke('argus:resolve-profile-root', root),
  revealPath: (target) => ipcRenderer.invoke('argus:reveal-path', target),

  // ── automation runs ──────────────────────────────────────────────────────
  // These are the runner's own IPC and deliberately do not go through the
  // HTTP-forwarding request/result pattern below: nothing here is answering a
  // loopback API call, so there is no requestId to match back.
  reserveCdpPort: () => ipcRenderer.invoke('argus:reserve-cdp-port'),
  resolveProfileCdp: (profileId) =>
    ipcRenderer.invoke('argus:resolve-profile-cdp', {profileId}),
  mintRunToken: (profileId, profileName, cdpPort, automations) =>
    ipcRenderer.invoke('argus:mint-run-token', {profileId, profileName, cdpPort, automations}),
  waitForCdp: (port, timeoutMs) =>
    ipcRenderer.invoke('argus:wait-for-cdp', {port, timeoutMs}),
  startAutomationRun: (payload) => ipcRenderer.invoke('argus:start-automation-run', payload),
  cancelAutomationRun: (runId) => ipcRenderer.invoke('argus:cancel-automation-run', {runId}),
  activeAutomationRuns: () => ipcRenderer.invoke('argus:active-automation-runs'),
  readRunScreenshot: (runId, name) =>
    ipcRenderer.invoke('argus:read-run-screenshot', {runId, name}),
  pendingAutomationRuns: () => ipcRenderer.invoke('argus:pending-automation-runs'),
  markAutomationRunFlushed: (runId) =>
    ipcRenderer.invoke('argus:mark-automation-run-flushed', {runId}),
  onAutomationRunEvent: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('argus:automation-run-event', listener);
    return () => ipcRenderer.removeListener('argus:automation-run-event', listener);
  },

  // ── Connectors ───────────────────────────────────────────────────────────
  // One way, renderer to main. The renderer reads `connectors` from Supabase --
  // this process holds no Supabase credentials and must not start -- and hands
  // the resolved list over so an AI or notify step can make its outbound call.
  // Held in memory over there and never written to disk.
  setConnectors: (connectors) => ipcRenderer.invoke('argus:set-connectors', {connectors}),
  // The Test button: the smallest real thing the service allows -- one tiny
  // completion for an AI connector, one real message for a messaging one.
  // Takes the config directly rather than an id so an unsaved edit can be
  // tried before it is written.
  testConnector: (connector) => ipcRenderer.invoke('argus:test-connector', {connector}),
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
  installBuiltInExtension: (key) =>
    ipcRenderer.invoke('argus:install-built-in-extension', {key}),
  builtInExtensionStatus: () => ipcRenderer.invoke('argus:built-in-extension-status'),
  catchUpBuiltInExtensions: (toggles) =>
    ipcRenderer.invoke('argus:catch-up-built-in-extensions', {toggles}),
  onBuiltInDownloadProgress: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('argus:built-in-download-progress', listener);
    return () => ipcRenderer.removeListener('argus:built-in-download-progress', listener);
  },
  selectCookieFile: () => ipcRenderer.invoke('argus:select-cookie-file'),
  selectCookieFolder: () => ipcRenderer.invoke('argus:select-cookie-folder'),
  matchCookieFiles: (folderPath, profileNames) =>
    ipcRenderer.invoke('argus:match-cookie-files', {folderPath, profileNames}),
  saveTextFile: (defaultName, content) =>
    ipcRenderer.invoke('argus:save-text-file', {defaultName, content}),
  selectImportCsv: () => ipcRenderer.invoke('argus:select-import-csv'),
  selectProxyFile: () => ipcRenderer.invoke('argus:select-proxy-file'),
  selectBookmarkFile: () => ipcRenderer.invoke('argus:select-bookmark-file'),
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
  // One subscribe/reply pair for every table-driven route, rather than a named
  // method per route. The dozen pairs around this one are the same four lines
  // with a different string in them; adding five more for the automations
  // routes would have been the point where that stopped being a style question.
  onApiRequest: (channel, callback) => {
    if (!API_CHANNELS.has(channel)) {
      return () => undefined;
    }
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
  // `status` lets the renderer pick the HTTP code: 404 for a row that is not
  // there, 403 for one this key may not see. Without it every refusal would be
  // reported as a server error.
  sendApiResult: (requestId, result, error, status) =>
    ipcRenderer.send('argus:api-result', {requestId, result, error, status}),
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
  // A launch's start page asking for its own proxy to be re-checked. Answered
  // here rather than in main because the renderer is what can record the result
  // against the proxy row and compose the panel's next line -- see
  // recheckFromPage in main.cjs.
  onRecheckProxyRequest: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('argus:recheck-proxy-request', listener);
    return () => ipcRenderer.removeListener('argus:recheck-proxy-request', listener);
  },
  sendRecheckProxyResult: (requestId, result, error) =>
    ipcRenderer.send('argus:recheck-proxy-result', {requestId, result, error}),
});
