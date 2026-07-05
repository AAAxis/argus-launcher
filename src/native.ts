import type {RuntimeFingerprint, SharedExtension} from './types';

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
};

export type CookieFileSelection = {
  path: string;
  count: number;
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

type ArgusNative = {
  launchProfile(payload: LaunchProfilePayload): Promise<{
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
  checkProxy?(proxy: ProxyConfig): Promise<ProxyCheckResult>;
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
};

declare global {
  interface Window {
    argusNative?: ArgusNative;
  }
}

export const native = window.argusNative;
