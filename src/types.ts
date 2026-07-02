export type ArgusProfile = {
  id: string;
  name: string;
  status?: string;
  color?: string;
  tags?: string[];
  folder_id?: string | null;
  proxy_id?: string | null;
  start_url?: string | null;
  command_line_switches?: string | null;
  fingerprint?: {
    os?: string;
    browser_version?: string;
    user_agent?: string;
    language?: string;
    timezone?: string;
    geolocation?: string;
    webrtc?: string;
    canvas?: string;
    webgl?: string;
    webgl_vendor?: string;
    webgl_renderer?: string;
    screen?: string;
    cpu_cores?: number | null;
    memory_gb?: number | null;
    rotate_on_launch?: boolean;
  };
  created_at?: string;
};

export type ArgusFolder = {
  id: string;
  name: string;
  created_at?: string;
};

export type ArgusProxy = {
  id: string;
  name: string;
  type?: 'http' | 'socks5';
  host: string;
  port: number;
  username?: string;
  password?: string;
};

export type SharedExtension = {
  id?: string;
  path: string;
  name?: string;
};

export type SharedBookmark = {
  title: string;
  url: string;
  icon?: string;
};

export type CloudState = {
  profiles: ArgusProfile[];
  folders: ArgusFolder[];
  proxies: ArgusProxy[];
  shared_extensions: SharedExtension[];
  shared_bookmarks: SharedBookmark[];
};
