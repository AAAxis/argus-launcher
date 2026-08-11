const {contextBridge, ipcRenderer} = require('electron');
const {routes: apiRoutes} = require('./api/routes.json');

// The channels a table-driven API route may use. An allow-list, not a
// pass-through: onApiRequest takes a channel name from the renderer, and a
// renderer that could name any channel could subscribe to every one of them.
const API_CHANNELS = new Set(
    apiRoutes.map((route) => route.channel).filter(Boolean));

contextBridge.exposeInMainWorld('montiNative', {
  launchProfile: (payload, extraArgs) => ipcRenderer.invoke('monti:launch-profile', payload, extraArgs),
  listApiKeys: (ownerUserId) => ipcRenderer.invoke('monti:list-api-keys', ownerUserId),
  createApiKey: (name, folderScope, meta) =>
    ipcRenderer.invoke('monti:create-api-key', {name, folderScope, ...(meta || {})}),
  revokeApiKey: (id) => ipcRenderer.invoke('monti:revoke-api-key', id),
  applyIntegrationConfig: (integrationId, token) =>
    ipcRenderer.invoke('monti:apply-integration-config', {integrationId, token}),
  integrationStatus: (integrationId) =>
    ipcRenderer.invoke('monti:integration-status', {integrationId}),
  removeIntegrationConfig: (integrationId) =>
    ipcRenderer.invoke('monti:remove-integration-config', {integrationId}),
  repairIntegration: (integrationId) =>
    ipcRenderer.invoke('monti:repair-integration', {integrationId}),
  verifyIntegration: (integrationId) =>
    ipcRenderer.invoke('monti:verify-integration', {integrationId}),
  detectIntegrations: () => ipcRenderer.invoke('monti:detect-integrations'),
  checkProxy: (proxy) => ipcRenderer.invoke('monti:check-proxy', proxy),
  checkSelector: (profileId, selector) =>
    ipcRenderer.invoke('monti:check-selector', {profileId, selector}),
  openExternal: (url) => ipcRenderer.invoke('monti:open-external', url),
  bookmarkFavicon: (url) => ipcRenderer.invoke('monti:bookmark-favicon', url),
  setTheme: (preference) => ipcRenderer.invoke('monti:set-theme', preference),
  getLoginItem: () => ipcRenderer.invoke('monti:get-login-item'),
  setLoginItem: (enabled) => ipcRenderer.invoke('monti:set-login-item', enabled),
  resolveProfileRoot: (root) => ipcRenderer.invoke('monti:resolve-profile-root', root),
  revealPath: (target) => ipcRenderer.invoke('monti:reveal-path', target),

  // ── automation runs ──────────────────────────────────────────────────────
  // These are the runner's own IPC and deliberately do not go through the
  // HTTP-forwarding request/result pattern below: nothing here is answering a
  // loopback API call, so there is no requestId to match back.
  reserveCdpPort: () => ipcRenderer.invoke('monti:reserve-cdp-port'),
  resolveProfileCdp: (profileId) =>
    ipcRenderer.invoke('monti:resolve-profile-cdp', {profileId}),
  mintRunToken: (profileId, profileName, orgId, cdpPort, automations) =>
    ipcRenderer.invoke('monti:mint-run-token',
        {profileId, profileName, orgId, cdpPort, automations}),
  waitForCdp: (port, timeoutMs) =>
    ipcRenderer.invoke('monti:wait-for-cdp', {port, timeoutMs}),
  startAutomationRun: (payload) => ipcRenderer.invoke('monti:start-automation-run', payload),
  cancelAutomationRun: (runId) => ipcRenderer.invoke('monti:cancel-automation-run', {runId}),
  activeAutomationRuns: () => ipcRenderer.invoke('monti:active-automation-runs'),
  readRunScreenshot: (runId, name) =>
    ipcRenderer.invoke('monti:read-run-screenshot', {runId, name}),
  pendingAutomationRuns: () => ipcRenderer.invoke('monti:pending-automation-runs'),
  markAutomationRunFlushed: (runId) =>
    ipcRenderer.invoke('monti:mark-automation-run-flushed', {runId}),
  onAutomationRunEvent: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('monti:automation-run-event', listener);
    return () => ipcRenderer.removeListener('monti:automation-run-event', listener);
  },

  // ── Connectors ───────────────────────────────────────────────────────────
  // One way, renderer to main. The renderer reads `connectors` from Supabase --
  // this process holds no Supabase credentials and must not start -- and hands
  // the resolved list over so an AI or notify step can make its outbound call.
  // Held in memory over there and never written to disk.
  setConnectors: (connectors) => ipcRenderer.invoke('monti:set-connectors', {connectors}),
  // The Test button: the smallest real thing the service allows -- one tiny
  // completion for an AI connector, one real message for a messaging one.
  // Takes the config directly rather than an id so an unsaved edit can be
  // tried before it is written.
  testConnector: (connector) => ipcRenderer.invoke('monti:test-connector', {connector}),
  telegramLinkPoll: (token, code, welcome) =>
    ipcRenderer.invoke('monti:telegram-link-poll', {token, code, welcome}),
  // `parseMode` is Telegram's rich text switch -- 'HTML' for the marked-up
  // run summaries, absent for anything composed as plain text.
  telegramSend: (token, chatId, text, parseMode) =>
    ipcRenderer.invoke('monti:telegram-send', {token, chatId, text, parseMode}),
  // The endpoint's own model listing, for the form's model picker. Draft in,
  // like testConnector, so an unsaved key can prove itself.
  listConnectorModels: (connector) =>
    ipcRenderer.invoke('monti:list-connector-models', {connector}),
  onDeepLink: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('monti:deep-link', listener);
    return () => ipcRenderer.removeListener('monti:deep-link', listener);
  },
  deepLinkReady: () => ipcRenderer.invoke('monti:deep-link-ready'),
  getUpdateStatus: () => ipcRenderer.invoke('monti:update-status'),
  getReleaseNotes: (options) => ipcRenderer.invoke('monti:release-notes', options || {}),
  runningSessionCount: () => ipcRenderer.invoke('monti:running-session-count'),
  checkForUpdates: () => ipcRenderer.invoke('monti:check-for-updates'),
  downloadUpdate: () => ipcRenderer.invoke('monti:download-update'),
  installUpdate: () => ipcRenderer.invoke('monti:install-update'),
  onUpdateState: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('monti:update-state', listener);
    return () => ipcRenderer.removeListener('monti:update-state', listener);
  },
  getResourceStatus: () => ipcRenderer.invoke('monti:resource-status'),
  checkBrowserResource: () => ipcRenderer.invoke('monti:check-browser-resource'),
  downloadBrowserResource: () => ipcRenderer.invoke('monti:download-browser-resource'),
  onResourceState: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('monti:resource-state', listener);
    return () => ipcRenderer.removeListener('monti:resource-state', listener);
  },
  getApiStatus: () => ipcRenderer.invoke('monti:api-status'),
  onApiState: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('monti:api-state', listener);
    return () => ipcRenderer.removeListener('monti:api-state', listener);
  },
  selectExtensionFolder: () => ipcRenderer.invoke('monti:select-extension-folder'),
  zipExtensionFolder: (folderPath) => ipcRenderer.invoke('monti:zip-extension-folder', folderPath),
  installBuiltInExtension: (key) =>
    ipcRenderer.invoke('monti:install-built-in-extension', {key}),
  builtInExtensionStatus: () => ipcRenderer.invoke('monti:built-in-extension-status'),
  catchUpBuiltInExtensions: (toggles) =>
    ipcRenderer.invoke('monti:catch-up-built-in-extensions', {toggles}),
  onBuiltInDownloadProgress: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('monti:built-in-download-progress', listener);
    return () => ipcRenderer.removeListener('monti:built-in-download-progress', listener);
  },
  selectCookieFile: () => ipcRenderer.invoke('monti:select-cookie-file'),
  selectCookieFiles: () => ipcRenderer.invoke('monti:select-cookie-files'),
  selectCookieFolder: () => ipcRenderer.invoke('monti:select-cookie-folder'),
  matchCookieFiles: (folderPath, profileNames) =>
    ipcRenderer.invoke('monti:match-cookie-files', {folderPath, profileNames}),
  saveTextFile: (defaultName, content) =>
    ipcRenderer.invoke('monti:save-text-file', {defaultName, content}),
  selectImportCsv: () => ipcRenderer.invoke('monti:select-import-csv'),
  selectProxyFile: () => ipcRenderer.invoke('monti:select-proxy-file'),
  selectBookmarkFile: () => ipcRenderer.invoke('monti:select-bookmark-file'),
  onBulkMatchCookiesRequest: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('monti:bulk-match-cookies-request', listener);
    return () => ipcRenderer.removeListener('monti:bulk-match-cookies-request', listener);
  },
  sendBulkMatchCookiesResult: (requestId, result, error) =>
    ipcRenderer.send('monti:bulk-match-cookies-result', {requestId, result, error}),
  onPushLocalCookiesRequest: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('monti:push-local-cookies-request', listener);
    return () => ipcRenderer.removeListener('monti:push-local-cookies-request', listener);
  },
  sendPushLocalCookiesResult: (requestId, result, error) =>
    ipcRenderer.send('monti:push-local-cookies-result', {requestId, result, error}),
  onCookieSyncPushRequest: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('monti:cookie-sync-push-request', listener);
    return () => ipcRenderer.removeListener('monti:cookie-sync-push-request', listener);
  },
  // The page-route pairs carry a fourth `status` argument the others do not:
  // their callers are the side panel and the start page, which act on the code
  // (409 means "switch workspace", 403 means "not yours", 500 means "we broke").
  // main.cjs defaults a missing one to 500, so an omitted status is the old
  // behaviour rather than a crash.
  sendCookieSyncPushResult: (requestId, result, error, status) =>
    ipcRenderer.send('monti:cookie-sync-push-result', {requestId, result, error, status}),
  onCookieSyncPullRequest: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('monti:cookie-sync-pull-request', listener);
    return () => ipcRenderer.removeListener('monti:cookie-sync-pull-request', listener);
  },
  sendCookieSyncPullResult: (requestId, result, error, status) =>
    ipcRenderer.send('monti:cookie-sync-pull-result', {requestId, result, error, status}),
  onCookieListRequest: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('monti:cookie-list-request', listener);
    return () => ipcRenderer.removeListener('monti:cookie-list-request', listener);
  },
  sendCookieListResult: (requestId, result, error, status) =>
    ipcRenderer.send('monti:cookie-list-result', {requestId, result, error, status}),
  onCookieSetsRequest: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('monti:cookie-sets-request', listener);
    return () => ipcRenderer.removeListener('monti:cookie-sets-request', listener);
  },
  sendCookieSetsResult: (requestId, result, error, status) =>
    ipcRenderer.send('monti:cookie-sets-result', {requestId, result, error, status}),
  onPanelAutomationsRequest: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('monti:panel-automations-request', listener);
    return () => ipcRenderer.removeListener('monti:panel-automations-request', listener);
  },
  sendPanelAutomationsResult: (requestId, result, error, status) =>
    ipcRenderer.send('monti:panel-automations-result', {requestId, result, error, status}),
  onPanelResolveAutomationRequest: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('monti:panel-resolve-automation-request', listener);
    return () =>
      ipcRenderer.removeListener('monti:panel-resolve-automation-request', listener);
  },
  sendPanelResolveAutomationResult: (requestId, result, error, status) =>
    ipcRenderer.send('monti:panel-resolve-automation-result',
        {requestId, result, error, status}),
  onReimportProxiesRequest: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('monti:reimport-proxies-request', listener);
    return () => ipcRenderer.removeListener('monti:reimport-proxies-request', listener);
  },
  sendReimportProxiesResult: (requestId, result, error) =>
    ipcRenderer.send('monti:reimport-proxies-result', {requestId, result, error}),
  onAssignProfileProxyRequest: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('monti:assign-profile-proxy-request', listener);
    return () => ipcRenderer.removeListener('monti:assign-profile-proxy-request', listener);
  },
  sendAssignProfileProxyResult: (requestId, result, error) =>
    ipcRenderer.send('monti:assign-profile-proxy-result', {requestId, result, error}),
  onGetProfileRequest: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('monti:get-profile-request', listener);
    return () => ipcRenderer.removeListener('monti:get-profile-request', listener);
  },
  sendGetProfileResult: (requestId, result, error) =>
    ipcRenderer.send('monti:get-profile-result', {requestId, result, error}),
  onListProxiesRequest: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('monti:list-proxies-request', listener);
    return () => ipcRenderer.removeListener('monti:list-proxies-request', listener);
  },
  sendListProxiesResult: (requestId, result, error) =>
    ipcRenderer.send('monti:list-proxies-result', {requestId, result, error}),
  onCreateProxyRequest: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('monti:create-proxy-request', listener);
    return () => ipcRenderer.removeListener('monti:create-proxy-request', listener);
  },
  sendCreateProxyResult: (requestId, result, error) =>
    ipcRenderer.send('monti:create-proxy-result', {requestId, result, error}),
  onUpdateProxyRequest: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('monti:update-proxy-request', listener);
    return () => ipcRenderer.removeListener('monti:update-proxy-request', listener);
  },
  sendUpdateProxyResult: (requestId, result, error) =>
    ipcRenderer.send('monti:update-proxy-result', {requestId, result, error}),
  onDeleteProxyRequest: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('monti:delete-proxy-request', listener);
    return () => ipcRenderer.removeListener('monti:delete-proxy-request', listener);
  },
  sendDeleteProxyResult: (requestId, result, error) =>
    ipcRenderer.send('monti:delete-proxy-result', {requestId, result, error}),
  onUpdateProfileRequest: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('monti:update-profile-request', listener);
    return () => ipcRenderer.removeListener('monti:update-profile-request', listener);
  },
  sendUpdateProfileResult: (requestId, result, error) =>
    ipcRenderer.send('monti:update-profile-result', {requestId, result, error}),
  onDeleteProfileRequest: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('monti:delete-profile-request', listener);
    return () => ipcRenderer.removeListener('monti:delete-profile-request', listener);
  },
  sendDeleteProfileResult: (requestId, result, error) =>
    ipcRenderer.send('monti:delete-profile-result', {requestId, result, error}),
  onUpdateFingerprintRequest: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('monti:update-fingerprint-request', listener);
    return () => ipcRenderer.removeListener('monti:update-fingerprint-request', listener);
  },
  sendUpdateFingerprintResult: (requestId, result, error) =>
    ipcRenderer.send('monti:update-fingerprint-result', {requestId, result, error}),
  onLaunchAutomationRequest: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('monti:launch-automation-request', listener);
    return () => ipcRenderer.removeListener('monti:launch-automation-request', listener);
  },
  sendLaunchAutomationResult: (requestId, result, error) =>
    ipcRenderer.send('monti:launch-automation-result', {requestId, result, error}),
  onListProfilesRequest: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('monti:list-profiles-request', listener);
    return () => ipcRenderer.removeListener('monti:list-profiles-request', listener);
  },
  sendListProfilesResult: (requestId, result, error) =>
    ipcRenderer.send('monti:list-profiles-result', {requestId, result, error}),
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
    ipcRenderer.send('monti:api-result', {requestId, result, error, status}),
  onMonitoringReportRequest: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('monti:monitoring-report-request', listener);
    return () => ipcRenderer.removeListener('monti:monitoring-report-request', listener);
  },
  sendMonitoringReportResult: (requestId, result, error) =>
    ipcRenderer.send('monti:monitoring-report-result', {requestId, result, error}),
  onOAuthAuthorizeRequest: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('monti:oauth-authorize-request', listener);
    return () => ipcRenderer.removeListener('monti:oauth-authorize-request', listener);
  },
  sendOAuthAuthorizeResult: (requestId, approved, folderScope, keyName) =>
    ipcRenderer.send('monti:oauth-authorize-result', {requestId, approved, folderScope, keyName}),
  // A launch's start page asking for its own proxy to be re-checked. Answered
  // here rather than in main because the renderer is what can record the result
  // against the proxy row and compose the panel's next line -- see
  // recheckFromPage in main.cjs.
  onRecheckProxyRequest: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('monti:recheck-proxy-request', listener);
    return () => ipcRenderer.removeListener('monti:recheck-proxy-request', listener);
  },
  sendRecheckProxyResult: (requestId, result, error) =>
    ipcRenderer.send('monti:recheck-proxy-result', {requestId, result, error}),
  // A launch's start page asking for one of its own automations to be opened
  // here. One-way, unlike the pair above: main has already raised the window,
  // and there is no answer the page could show even if this failed -- see
  // openInLauncherFromPage in main.cjs.
  onOpenAutomationRequest: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('monti:open-automation-request', listener);
    return () => ipcRenderer.removeListener('monti:open-automation-request', listener);
  },
});
