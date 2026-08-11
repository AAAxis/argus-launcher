import {useEffect, useState} from 'react';
import {bookmarkInitial, faviconCache, normalizeBookmarkUrl} from '../../lib/bookmarks';
import {native} from '../../native';
import type {SharedBookmark} from '../../types';

/**
 * A bookmark's icon: the manually entered one wins, then the favicon fetched
 * from the site itself, then a letter monogram. The manual field used to be
 * stored and edited but never rendered anywhere.
 */
export function BookmarkFavicon({bookmark}: {bookmark: SharedBookmark}) {
  const url = normalizeBookmarkUrl(bookmark.url);
  const [icon, setIcon] = useState<string | null>(
    () => bookmark.icon || faviconCache.get(url) || null,
  );
  // Having a src is not the same as that src rendering: a manually entered Icon
  // URL that 404s, or a site whose declared icon has moved, both leave an <img>
  // with alt="" -- an empty box where the monogram should be. onError flips
  // this and the monogram gets its turn.
  const [broken, setBroken] = useState(false);

  // A new icon deserves a fresh attempt; otherwise one failure would keep the
  // monogram forever, including after the user corrects the Icon URL.
  useEffect(() => {
    setBroken(false);
  }, [icon]);

  useEffect(() => {
    if (bookmark.icon) {
      setIcon(bookmark.icon);
      return;
    }
    if (!url || !native?.bookmarkFavicon) {
      return;
    }
    if (faviconCache.has(url)) {
      setIcon(faviconCache.get(url) ?? null);
      return;
    }
    let cancelled = false;
    void native.bookmarkFavicon(url)
        .then((dataUri) => {
          faviconCache.set(url, dataUri);
          if (!cancelled) {
            setIcon(dataUri);
          }
        })
        .catch((error) => {
          // Cached as a miss either way, but not silently: a resolver that is
          // failing for every host looks identical to a set of sites that
          // genuinely have no icon, and only the console tells them apart.
          console.warn('[favicon] resolve failed for', url, error);
          faviconCache.set(url, null);
        });
    return () => {
      cancelled = true;
    };
  }, [url, bookmark.icon]);

  if (icon && !broken) {
    return <img alt="" className="bookmark-favicon" src={icon} onError={() => setBroken(true)} />;
  }
  return <span className="bookmark-favicon bookmark-monogram">{bookmarkInitial(bookmark)}</span>;
}
