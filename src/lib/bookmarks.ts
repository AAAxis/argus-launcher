import type {SharedBookmark} from '../types';

export const socialBookmarks: SharedBookmark[] = [
  {title: 'Reddit', url: 'https://www.reddit.com/'},
  {title: 'Instagram', url: 'https://www.instagram.com/'},
  {title: 'TikTok', url: 'https://www.tiktok.com/'},
  {title: 'Facebook', url: 'https://www.facebook.com/'},
];

export function normalizeBookmarkUrl(url: string) {
  const trimmed = url.trim();
  if (!trimmed) {
    return '';
  }
  return /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

// What the card shows on its url line. The scheme and a bare `www.` carry no
// information and cost about half the line -- `https://www.instagram.com/` is
// 26 characters of which 12 say nothing -- so they are dropped for display
// only. The card keeps the full url in its title attribute.
export function displayBookmarkUrl(url: string) {
  const normalized = normalizeBookmarkUrl(url);
  try {
    const parsed = new URL(normalized);
    const path = parsed.pathname === '/' ? '' : parsed.pathname;
    return `${parsed.hostname.replace(/^www\./, '')}${path}${parsed.search}`;
  } catch {
    // Not parseable as a url -- show whatever the user typed rather than
    // nothing, since they still need to recognise the row to fix it.
    return normalized;
  }
}

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
