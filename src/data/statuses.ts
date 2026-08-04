import type {CloudState} from '../types';

export const baseProfileStatuses = ['Ready', 'Active', 'Warmup', 'Ban', 'Review'];

// Custom statuses (user-created) fall through to the neutral default tone --
// only the known built-in ones get a distinct colour. The tone names match the
// --status-<tone>-{bg,border,ink} triples in styles.css.
export function statusToneClass(status: string): string {
  switch (status) {
    case 'Active':
      return 'status-active';
    case 'Warmup':
      return 'status-warmup';
    case 'Ban':
      return 'status-ban';
    case 'Review':
      return 'status-review';
    default:
      return 'status-neutral';
  }
}

export const defaultCloudState: CloudState = {
  profiles: [],
  folders: [],
  proxy_folders: [],
  cookie_folders: [],
  proxies: [],
  cookies: [],
  shared_extensions: [],
  shared_bookmarks: [],
  custom_statuses: [],
  automations: [],
};

// BUILT_IN_EXTENSIONS moved to data/extensionCatalog.ts, where it sits next to
// the Web Store catalog the Discover view browses and to the artwork both
// render.
