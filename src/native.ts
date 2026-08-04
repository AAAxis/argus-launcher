import type {ArgusProfile, ArgusProxy, RuntimeFingerprint, SharedExtension} from './types';

export type ProxyConfig = {
  id?: string;
  host?: string;
  port?: number;
  type?: 'http' | 'socks5';
  username?: string;
  password?: string;
};

export type LaunchProfilePayload = {
  id: string;
  name: string;
  userDataDir: string;
  // The profile's colour, exactly as `profiles.color` stores it: one of the six
  // preset keys, or a custom hex. Not a browser argument -- on macOS the main
  // process picks the wrapper bundle's Dock icon from it, so an open session is
  // identifiable by the same colour its row carries in the table.
  color?: string | null;
  proxy?: ProxyConfig | null;
  // True only when the profile's proxy_mode is explicitly 'free_proxy':
  // bundles the FoxyWall Proxy extension as a fallback. Never set for
  // 'direct' (no proxy, no fallback extension either) or 'assigned' (a real
  // proxy is present in `proxy` instead).
  useFreeProxy?: boolean;
  extensionPaths?: string[];
  // Team-synced extensions (see SharedExtension in ./types) -- main.cjs
  // materializes each into a local cache (downloading from the Web Store or
  // Supabase Storage on first use) before launch.
  sharedExtensions?: SharedExtension[];
  commandLineSwitches?: string;
  // Full resolved fingerprint, keyed exactly like argus::Fingerprint's JSON
  // dict. electron/main.cjs resolves any proxy-derived fields still missing
  // (timezone/languages/lat-long) and serializes this into
  // --argus-fingerprint-json for the browser to apply before first navigation.
  runtimeFingerprint?: RuntimeFingerprint | null;
  startUrl?: string;
  homeHtml?: string;
  cookieImportPath?: string | null;
  cookieImportUrl?: string | null;
  cookieImportName?: string | null;
  // Global on/off switches for the bundled "stock" extensions (Extensions
  // tab). Undefined/missing means enabled, for backward compatibility.
  enableCookieManager?: boolean;
  enableSmsActivate?: boolean;
  enableFoxywallFreeProxy?: boolean;
};

export type CookieFileSelection = {
  path: string;
  name?: string;
  count: number;
  base64?: string;
};

export type ProxyCheckResult = {
  ok: boolean;
  ip?: string;
  country?: string;
  countryCode?: string;
  pingMs?: number;
  error?: string;
};

export type UpdateState = {
  status:
    | 'disabled'
    | 'idle'
    | 'checking'
    | 'available'
    | 'not-available'
    | 'downloading'
    | 'downloaded'
    | 'error';
  currentVersion: string;
  updateInfo: {
    version: string;
    releaseName?: string;
    releaseDate?: string;
    releaseNotes?: string;
  } | null;
  progress: {
    percent: number;
    bytesPerSecond: number;
    transferred: number;
    total: number;
  } | null;
  downloaded: boolean;
  error: string | null;
  canCheck: boolean;
  provider: 'github' | 'generic' | 'disabled';
};

export type ResourceState = {
  browserStatus: 'idle' | 'checking' | 'downloading' | 'installing' | 'ready' | 'error';
  browserVersion: string;
  browserPath: string;
  progress: {
    percent: number;
    transferred: number;
    total: number;
  } | null;
  error: string | null;
};

export type ApiState = {
  status: 'starting' | 'ready' | 'error';
  port: number;
  url: string;
  error: string | null;
};

export type LoginItemState = {
  openAtLogin: boolean;
  // False in a dev run (`npm run dev`), where the login item would point at the
  // Electron binary rather than at Argus Launcher.
  packaged: boolean;
};

export type ApiKey = {
  id: string;
  name: string;
  tokenPreview: string;
  // null means every folder (full access); an array (possibly empty) is an
  // explicit allow-list of folder ids.
  folderScope: string[] | null;
  // Who created it. The key store is per-install, so this is the only thing
  // separating one signed-in account's keys from another's on a shared machine.
  ownerUserId: string | null;
  orgId: string | null;
  // Set only by the Integrations connect flow. A key created by hand on the API
  // tab has none, which is what stops a key merely *named* "Claude Code" from
  // reading as a live connection.
  integrationId: string | null;
  // Predates ownership being recorded: still listed so it can be revoked, never
  // counted as a connection.
  legacy: boolean;
  createdAt: string;
  lastUsedAt: string | null;
};

// What the target tool's config says right now, as opposed to what this app's
// key store says. Both have to agree before an integration is really connected
// -- a key can exist while the config entry has been deleted, and an entry can
// exist while pointing at something that no longer runs.
export type IntegrationStatus = {
  configPath: string | null;
  // Hive and the generic MCP card have no config file for us to write; they
  // connect by showing the user a snippet instead.
  manual: boolean;
  // Whether the tool itself was found on this machine: an application bundle,
  // an executable, or a file only that tool writes -- never the config file
  // this app writes, and never the dot-directory holding it, which is what used
  // to make an uninstalled Cursor read as Connected.
  //
  // It gates what a card may claim, never whether you can connect: a false
  // negative would otherwise make a working install unconnectable.
  installed: boolean;
  // The exact path that proved it, so the UI can show a fact instead of making
  // a claim. Empty when nothing was found, and for the manual integrations.
  installedEvidence: string;
  hasEntry: boolean;
  // The entry names the server this build ships, rather than an older install's
  // path or the Python bridge that no longer exists.
  entryIsCurrent: boolean;
  stale: boolean;
  commandExists: boolean;
  apiReady: boolean;
};

// One row per thing that can independently be broken, so the dialog can say
// which step failed instead of one blended verdict.
export type IntegrationCheck = {
  id: string;
  label: string;
  ok: boolean;
  detail: string;
};

export type IntegrationVerification = {
  ok: boolean;
  checks: IntegrationCheck[];
};

type ArgusNative = {
  launchProfile(payload: LaunchProfilePayload, extraArgs?: string[]): Promise<{
    ok: boolean;
    pid?: number;
    appPath?: string;
    // Path to the per-profile wrapper .app that was actually spawned (see
    // electron/main.cjs's writeProfileLauncherApp) -- its Dock/Cmd+Tab name is
    // the profile's own name, since that identity comes from the bundle, not
    // from the shared Argys Browser binary or any window title.
    launcherAppPath?: string;
    error?: string;
  }>;
  // Named, scoped keys enforced on every /v1/* request to the local
  // automation API (see AUTOMATION_KEYS_PATH in main.cjs). Raw token is only
  // ever returned from createApiKey, at creation time -- only its hash is
  // persisted, so it can't be recovered later.
  // Takes the signed-in user's id: the store is shared by every account that
  // has ever signed in on this machine, so the filtering has to happen here.
  listApiKeys?(ownerUserId: string | null): Promise<ApiKey[]>;
  createApiKey?(
    name: string,
    folderScope: string[] | null,
    meta?: {ownerUserId?: string | null; orgId?: string | null; integrationId?: string | null},
  ): Promise<ApiKey & {token: string}>;
  revokeApiKey?(id: string): Promise<{revoked: boolean}>;
  // Writes the MCP server registration directly into the target tool's own
  // config file (~/.claude.json, ~/.codex/config.toml, ...) instead of handing
  // back a snippet to copy/paste -- see electron/integrations.cjs for why
  // (every CLI-command form proved unreliable on Windows). What it points at is
  // the server bundled in this app, so connecting installs nothing.
  applyIntegrationConfig?(
    integrationId: string,
    token: string,
  ): Promise<{ok: boolean; path?: string; error?: string}>;
  // Reads the target tool's config back. Needed because applyIntegrationConfig
  // is fire-and-forget: nothing else notices if the user later edits or deletes
  // the block it wrote.
  integrationStatus?(integrationId: string): Promise<IntegrationStatus>;
  // Deletes the argus entry this app wrote. Pairs with revokeApiKey -- revoking
  // alone leaves the tool pointed at a dead token.
  removeIntegrationConfig?(integrationId: string): Promise<{ok: boolean; path?: string | null; error?: string}>;
  // Repoints a stale entry at this build's server, keeping the token already in
  // the file. needsKey means that token is gone or revoked, so the caller has
  // to run the normal connect flow (which needs an owner id only it knows).
  repairIntegration?(
    integrationId: string,
  ): Promise<{ok: boolean; path?: string; needsKey?: boolean; error?: string}>;
  // Actually starts what the config says to start and speaks MCP to it. The
  // only check that can tell a live integration from a dead one.
  verifyIntegration?(integrationId: string): Promise<IntegrationVerification>;
  // Which agent tools look present on this machine, in one call.
  detectIntegrations?(): Promise<Record<string, boolean>>;
  checkProxy?(proxy: ProxyConfig): Promise<ProxyCheckResult>;
  // Opens a page in the user's real browser. The main process only honours
  // https: URLs on hosts we own (plus localhost in dev), so a rejected URL
  // resolves false rather than throwing.
  openExternal?(url: string): Promise<boolean>;
  // Resolves a bookmark's favicon to a data: URI, fetched from the site itself
  // and cached on disk by host. Null when the site exposes no usable icon --
  // the bookmark card falls back to a letter monogram.
  bookmarkFavicon?(url: string): Promise<string | null>;
  // Keeps the native window chrome in step with the in-app theme, so the shell
  // does not paint light behind a dark renderer. Takes the preference, not the
  // resolved theme -- 'system' must stay 'system' in the main process or
  // prefers-color-scheme stops updating in the renderer.
  setTheme?(preference: 'system' | 'light' | 'dark'): Promise<boolean>;
  // Open-at-login, read from and written to the OS. `packaged` is false in a
  // dev run, where the entry would register the Electron binary rather than the
  // app, so Settings shows the row disabled instead of lying about it.
  getLoginItem?(): Promise<LoginItemState>;
  setLoginItem?(enabled: boolean): Promise<LoginItemState>;
  // Turns the renderer's profile-data root into the absolute path this process
  // will actually use. A relative root resolves against the app's userData
  // directory, which only the main process knows -- see resolveProfileUserDataDir
  // in electron/main.cjs.
  resolveProfileRoot?(root: string): Promise<{path: string; exists: boolean}>;
  revealPath?(target: string): Promise<{ok: boolean; error?: string}>;
  // argus:// deep links. `auth` carries the PKCE authorization code back from
  // Google-via-Supabase; `open` just means "focus the app" and carries nothing.
  // Call deepLinkReady() after subscribing -- links that arrived during a cold
  // start are queued in the main process and replayed on that signal.
  onDeepLink?(
    callback: (payload: {action: 'auth'; code?: string; error?: string} | {action: 'open'}) => void,
  ): () => void;
  deepLinkReady?(): Promise<boolean>;
  getUpdateStatus?(): Promise<UpdateState>;
  checkForUpdates?(): Promise<UpdateState>;
  downloadUpdate?(): Promise<UpdateState>;
  installUpdate?(): Promise<{ok: boolean; error?: string}>;
  onUpdateState?(callback: (state: UpdateState) => void): () => void;
  getResourceStatus?(): Promise<ResourceState>;
  downloadBrowserResource?(): Promise<ResourceState>;
  onResourceState?(callback: (state: ResourceState) => void): () => void;
  getApiStatus?(): Promise<ApiState>;
  onApiState?(callback: (state: ApiState) => void): () => void;
  selectExtensionFolder?(): Promise<string | null>;
  zipExtensionFolder?(folderPath: string): Promise<{ok: boolean; base64?: string; error?: string}>;
  selectCookieFile?(): Promise<CookieFileSelection | null>;
  selectCookieFolder?(): Promise<string | null>;
  matchCookieFiles?(
    folderPath: string,
    profileNames: string[],
  ): Promise<Record<string, CookieFileSelection | null>>;
  saveTextFile?(defaultName: string, content: string): Promise<string | null>;
  selectImportCsv?(): Promise<{path: string; content: string} | null>;
  // Raw text of a proxy list file (.txt/.csv/.list); parsed by lib/proxies.ts.
  selectProxyFile?(): Promise<{path: string; content: string} | null>;
  // Raw text of a browser's exported bookmarks (Netscape bookmark HTML);
  // parsed by lib/bookmarkImport.ts.
  selectBookmarkFile?(): Promise<{path: string; content: string} | null>;
  // Local automation API (POST http://127.0.0.1:39219/v1/cookies/bulk-match)
  // support: main.cjs forwards a bulk cookie-match request here so it can run
  // against the signed-in renderer's cloud state, then reports the result
  // back over sendBulkMatchCookiesResult so the HTTP caller gets a response.
  onBulkMatchCookiesRequest?(
    callback: (payload: {requestId: string; folderPath: string; profileIds: string[] | null}) => void,
  ): () => void;
  sendBulkMatchCookiesResult?(
    requestId: string,
    result?: {matched: number; total: number},
    error?: string,
  ): void;
  onPushLocalCookiesRequest?(
    callback: (payload: {requestId: string; profileId: string; profileName: string; cookies: unknown[]}) => void,
  ): () => void;
  sendPushLocalCookiesResult?(
    requestId: string,
    result?: {matched: boolean; count: number},
    error?: string,
  ): void;
  onReimportProxiesRequest?(
    callback: (payload: {requestId: string; proxies: Array<Record<string, unknown>>}) => void,
  ): () => void;
  sendReimportProxiesResult?(
    requestId: string,
    result?: {updated: number; created: number; total: number},
    error?: string,
  ): void;
  onAssignProfileProxyRequest?(
    callback: (payload: {requestId: string; profileId: string; proxyId?: string; proxyHost?: string; proxyPort?: number}) => void,
  ): () => void;
  sendAssignProfileProxyResult?(
    requestId: string,
    result?: {matched: boolean; profileId: string; proxyId?: string},
    error?: string,
  ): void;
  // POST /v1/profiles/get: full profile detail by id, including credentials --
  // deliberately separate from the bulk list-profiles endpoint (which only
  // returns id+name) so a broad "list all profiles" call never bulk-exposes
  // every stored password at once.
  onGetProfileRequest?(
    callback: (payload: {requestId: string; profileId: string; allowedFolders: string[] | null}) => void,
  ): () => void;
  sendGetProfileResult?(
    requestId: string,
    result?: {profile: ArgusProfile | null},
    error?: string,
  ): void;
  // GET /v1/proxies: full proxy list, each annotated with which profiles
  // currently use it -- lets an MCP-driven agent find an unassigned proxy
  // to swap in without cross-referencing list_profiles itself.
  onListProxiesRequest?(
    callback: (payload: {requestId: string}) => void,
  ): () => void;
  sendListProxiesResult?(
    requestId: string,
    result?: {proxies: Array<ArgusProxy & {assignedProfileIds: string[]}>},
    error?: string,
  ): void;
  // POST /v1/proxies/create
  onCreateProxyRequest?(
    callback: (payload: {
      requestId: string;
      name: string;
      type: 'http' | 'socks5';
      host: string;
      port: number;
      username?: string;
      password?: string;
    }) => void,
  ): () => void;
  sendCreateProxyResult?(
    requestId: string,
    result?: {proxyId: string},
    error?: string,
  ): void;
  // POST /v1/proxies/update: partial field patch, same shape as update-profile.
  onUpdateProxyRequest?(
    callback: (payload: {
      requestId: string;
      proxyId: string;
      fields: Partial<Pick<ArgusProxy, 'name' | 'type' | 'host' | 'port' | 'username' | 'password'>>;
    }) => void,
  ): () => void;
  sendUpdateProxyResult?(
    requestId: string,
    result?: {matched: boolean},
    error?: string,
  ): void;
  // POST /v1/proxies/delete: also unassigns (sets proxy_id null) any profile
  // currently using this proxy, so no profile is left pointing at a proxy_id
  // that no longer exists.
  onDeleteProxyRequest?(
    callback: (payload: {requestId: string; proxyId: string}) => void,
  ): () => void;
  sendDeleteProxyResult?(
    requestId: string,
    result?: {deleted: boolean; unassignedProfileIds: string[]},
    error?: string,
  ): void;
  // POST /v1/profiles/update: partial field patch (name/tags/status/color/folder_id/email/password).
  // Proxy has its own endpoint (assign-proxy, above) and fingerprint has its
  // own endpoint (update-fingerprint, below) since both need extra handling
  // beyond a plain field overwrite.
  onUpdateProfileRequest?(
    callback: (payload: {
      requestId: string;
      profileId: string;
      fields: Partial<Pick<ArgusProfile, 'name' | 'tags' | 'status' | 'color' | 'folder_id' | 'email' | 'password'>>;
    }) => void,
  ): () => void;
  sendUpdateProfileResult?(
    requestId: string,
    result?: {matched: boolean; profileId: string},
    error?: string,
  ): void;
  // POST /v1/profiles/delete: soft-deletes (moves to Trash, same as the
  // Delete button in the UI) unless permanent is true. allowedFolders scopes
  // which profiles a folder-restricted key may delete, same as get/launch.
  onDeleteProfileRequest?(
    callback: (payload: {
      requestId: string;
      profileId: string;
      permanent: boolean;
      allowedFolders: string[] | null;
    }) => void,
  ): () => void;
  sendDeleteProfileResult?(
    requestId: string,
    result?: {deleted: boolean; permanent: boolean},
    error?: string,
  ): void;
  // POST /v1/profiles/update-fingerprint: merges the given fields into the
  // profile's existing fingerprint object rather than replacing it wholesale.
  onUpdateFingerprintRequest?(
    callback: (payload: {requestId: string; profileId: string; fingerprint: Record<string, unknown>}) => void,
  ): () => void;
  sendUpdateFingerprintResult?(
    requestId: string,
    result?: {matched: boolean; profileId: string},
    error?: string,
  ): void;
  // POST /v1/profiles/launch-automation: main.cjs already chose a free CDP
  // port before forwarding this -- the renderer's job is only to resolve the
  // profileId against cloud state and launch it, same as a manual Launch
  // click, just with --remote-debugging-port appended and no interactive
  // proxy-check/error-dialog UI (main process's spawnProfileUnchecked is the
  // authoritative proxy gate either way).
  onLaunchAutomationRequest?(
    callback: (payload: {
      requestId: string;
      profileId: string;
      cdpPort: number;
      // null = the calling key has full access; an array is the folder
      // allow-list it was scoped to when created/approved.
      allowedFolders: string[] | null;
    }) => void,
  ): () => void;
  sendLaunchAutomationResult?(
    requestId: string,
    result?: {ok: boolean; pid?: number; error?: string},
    error?: string,
  ): void;
  onListProfilesRequest?(
    callback: (payload: {requestId: string; folder: string | null; allowedFolders: string[] | null}) => void,
  ): () => void;
  sendListProfilesResult?(
    requestId: string,
    result?: {profiles: Array<{id: string; name: string}>},
    error?: string,
  ): void;
  onMonitoringReportRequest?(
    callback: (payload: {
      requestId: string;
      runId: string;
      profileId: string;
      ok: boolean;
      detail: string;
      screenshotBase64: string | null;
    }) => void,
  ): () => void;
  sendMonitoringReportResult?(requestId: string, result?: {ok: true}, error?: string): void;
  // Loopback "Connect" flow (GET /v1/oauth/authorize): an external app
  // (e.g. Hive) opens that URL in a real browser; this fires so the
  // renderer can show an approve/deny dialog, then reports back which
  // folders to actually grant (defaulting to what the caller requested, but
  // the human approving can narrow it).
  onOAuthAuthorizeRequest?(
    callback: (payload: {requestId: string; clientName: string; requestedScope: string}) => void,
  ): () => void;
  sendOAuthAuthorizeResult?(
    requestId: string,
    approved: boolean,
    folderScope: string[] | null,
    keyName: string,
  ): void;
};

declare global {
  interface Window {
    argusNative?: ArgusNative;
  }
}

export const native = window.argusNative;
