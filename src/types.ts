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
  proxies: ArgusProxy[];
  shared_extensions: SharedExtension[];
  shared_bookmarks: SharedBookmark[];
};
