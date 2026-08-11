import type {SharedBookmark} from '../types';

export const socialBookmarks: SharedBookmark[] = [
  {title: 'Reddit', url: 'https://www.reddit.com/'},
  {title: 'Instagram', url: 'https://www.instagram.com/'},
  {title: 'TikTok', url: 'https://www.tiktok.com/'},
  {title: 'Facebook', url: 'https://www.facebook.com/'},
];

// `host:port` is not a scheme. `localhost:3000` and `10.0.0.5:8080` both match
// the generic scheme pattern -- a word, then a colon -- but what follows the
// colon is a port, and leaving them alone produced hrefs the browser tried to
// open as a `localhost:` protocol. A real scheme is never followed by a bare
// port and nothing else.
function hasScheme(url: string) {
  return /^[a-z][a-z0-9+.-]*:/i.test(url) && !/^[a-z0-9.-]+:\d+([/?#]|$)/i.test(url);
}

export function normalizeBookmarkUrl(url: string) {
  const trimmed = url.trim();
  if (!trimmed) {
    return '';
  }
  return hasScheme(trimmed) ? trimmed : `https://${trimmed}`;
}

// displayBookmarkUrl lived here: the url with the scheme and a bare `www.`
// stripped, for the second line of the old bookmark card. The Start page tile
// shows a title under the favicon and carries the full url in its title
// attribute instead, so nothing called it any more.

// The fallback mark when a site exposes no favicon. Shared by the launcher's
// bookmark card and the injected browser home page so the two agree.
export function bookmarkInitial(bookmark: SharedBookmark) {
  const source = bookmark.title || normalizeBookmarkUrl(bookmark.url);
  return source.trim()[0]?.toUpperCase() || 'A';
}

// Resolved favicons, keyed by normalized url. The main process already caches
// to disk; this second layer just stops every re-render from crossing IPC.
// `null` is a real value here -- it means "this host has no icon, stop asking".
export const faviconCache = new Map<string, string | null>();

// Hosts the background warmer has already asked for. Separate from faviconCache
// so "asked, still waiting" and "answered" stay distinguishable -- writing a
// placeholder into the cache instead would make BookmarkFavicon read it as a
// settled miss and draw a monogram it never revisits.
export const faviconWarmed = new Set<string>();

export function mergeBookmarks(bookmarks: SharedBookmark[], presets: SharedBookmark[]) {
  const byUrl = new Map(bookmarks.map((bookmark) => [
    normalizeBookmarkUrl(bookmark.url).toLowerCase(),
    bookmark,
  ]));
  let changed = false;
  for (const preset of presets) {
    const key = normalizeBookmarkUrl(preset.url).toLowerCase();
    if (!byUrl.has(key)) {
      byUrl.set(key, preset);
      changed = true;
    }
  }
  return {bookmarks: [...byUrl.values()], changed};
}
