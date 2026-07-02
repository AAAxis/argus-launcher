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
  startUrl?: string;
};

type ArgusNative = {
  launchProfile(payload: LaunchProfilePayload): Promise<{
    ok: boolean;
    pid?: number;
    appPath?: string;
    launcherAppPath?: string;
    error?: string;
  }>;
  getBrowserPath(): Promise<string>;
  setBrowserPath(browserAppPath: string): Promise<string>;
};

declare global {
  interface Window {
    argusNative?: ArgusNative;
  }
}

export const native = window.argusNative;
