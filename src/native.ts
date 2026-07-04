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
  extensionPaths?: string[];
  commandLineSwitches?: string;
  fingerprintTimezone?: string | null;
  fingerprintLanguage?: string | null;
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

type ArgusNative = {
  launchProfile(payload: LaunchProfilePayload): Promise<{
    ok: boolean;
    pid?: number;
    appPath?: string;
    launcherAppPath?: string;
    error?: string;
  }>;
  checkProxy?(proxy: ProxyConfig): Promise<ProxyCheckResult>;
  selectExtensionFolder?(): Promise<string | null>;
  selectCookieFile?(): Promise<CookieFileSelection | null>;
  selectCookieFolder?(): Promise<string | null>;
  matchCookieFiles?(
    folderPath: string,
    profileNames: string[],
  ): Promise<Record<string, CookieFileSelection | null>>;
  saveTextFile?(defaultName: string, content: string): Promise<string | null>;
  selectImportCsv?(): Promise<{path: string; content: string} | null>;
};

declare global {
  interface Window {
    argusNative?: ArgusNative;
  }
}

export const native = window.argusNative;
