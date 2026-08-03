import {Bookmark, Bot, Cookie, Monitor, Plug, SquareTerminal, Waypoints} from 'lucide-react';
import type {LucideIcon} from 'lucide-react';

export type TabId = 'profiles' | 'proxies' | 'cookies' | 'bookmarks' | 'extensions' | 'integrations' | 'api';

export const tabs: Array<{id: TabId; label: string; icon: LucideIcon}> = [
  {id: 'profiles', label: 'Profiles', icon: Monitor},
  {id: 'proxies', label: 'Proxies', icon: Waypoints},
  {id: 'cookies', label: 'Cookies', icon: Cookie},
  {id: 'bookmarks', label: 'Bookmarks', icon: Bookmark},
  {id: 'extensions', label: 'Extensions', icon: Plug},
  {id: 'integrations', label: 'Integrations', icon: Bot},
  {id: 'api', label: 'API', icon: SquareTerminal},
];
