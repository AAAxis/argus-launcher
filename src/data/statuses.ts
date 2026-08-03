import type {BuiltInExtensionToggles, CloudState} from '../types';

export const baseProfileStatuses = ['Ready', 'Active', 'Warmup', 'Ban', 'Review'];

// Custom statuses (user-created) fall through to the neutral default class --
// only the known built-in ones get a distinct color.
export function statusSelectClass(status: string): string {
  switch (status) {
    case 'Active':
      return 'status-select status-active';
    case 'Warmup':
      return 'status-select status-warmup';
    case 'Ban':
      return 'status-select status-ban';
    case 'Review':
      return 'status-select status-review';
    default:
      return 'status-select';
  }
}

export const defaultCloudState: CloudState = {
  profiles: [],
  folders: [],
  proxies: [],
  cookies: [],
  shared_extensions: [],
  shared_bookmarks: [],
  custom_statuses: [],
};

// The bundled (non-removable) extensions every install ships with. Their
// toggles live on the organization, not on the individual user, so one worker
// cannot silently change what their colleagues' profiles launch with.
export const BUILT_IN_EXTENSIONS: Array<{
  key: keyof BuiltInExtensionToggles;
  name: string;
  description: string;
}> = [
  {
    key: 'cookie_manager',
    name: 'Argys Cookie Manager',
    description: 'Manual cookie export/import UI, bundled into every profile.',
  },
  {
    key: 'sms_activate',
    name: 'SMSActivate',
    description: 'Bundled into every profile regardless of proxy mode.',
  },
  {
    key: 'foxywall_free_proxy',
    name: 'FoxyWall Proxy',
    description: 'Bundled into every profile; only auto-connects for profiles set to Free Proxy mode. This switch turns off bundling it entirely.',
  },
];
