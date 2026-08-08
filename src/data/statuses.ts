import type {CloudState} from '../types';

// The built-in labels, one list per table that carries a status.
//
// They diverge because the tables do: a proxy is never in Warmup and a
// cookie-set is never Banned, so offering those would be three quarters of a
// picker the user has to read past. What does NOT diverge is the custom
// vocabulary -- a label the user invents lives in the org-wide custom_statuses
// table and is offered by all three pickers, because "Farm" or "Sold" is a word
// about the work rather than about the kind of row. That is why custom_statuses
// has no `kind` column, and why the divergence lives here in the client.
//
// The FIRST entry of each list is load-bearing: a row with no stored status
// renders as it, which is how every row that predates the column reads as
// something sensible without a backfill. Do not reorder these to put a
// terminal state first.
export const baseProfileStatuses = ['Ready', 'Active', 'Warmup', 'Ban', 'Review'];
export const baseProxyStatuses = ['Ready', 'Active', 'Slow', 'Dead'];
export const baseCookieStatuses = ['Fresh', 'Active', 'Stale', 'Expired'];

// What an unset status reads as, per table. Kept next to the lists above so the
// cell, the sort and the picker's selected row cannot disagree about it.
export const defaultProfileStatus = baseProfileStatuses[0];
export const defaultProxyStatus = baseProxyStatuses[0];
export const defaultCookieStatus = baseCookieStatuses[0];

// Custom statuses (user-created) fall through to the neutral default tone --
// only the known built-in ones get a distinct colour. The tone names match the
// --status-<tone>-{bg,border,ink} triples in styles.css.
//
// The nine built-ins share four tones rather than getting nine of their own:
// what the colour says is how alarmed to be, and "Slow" and "Warmup" are the
// same amount of alarmed. A fifth tone would have to be invented in both themes
// to say nothing new.
export function statusToneClass(status: string): string {
  switch (status) {
    case 'Active':
    case 'Fresh':
      return 'status-active';
    case 'Warmup':
    case 'Slow':
    case 'Stale':
      return 'status-warmup';
    case 'Ban':
    case 'Dead':
    case 'Expired':
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
  connectors: [],
  notifications: [],
  members: [],
  note_summaries: [],
};

// BUILT_IN_EXTENSIONS moved to data/extensionCatalog.ts, where it sits next to
// the Web Store catalog the Discover view browses and to the artwork both
// render.
