// Reading a browser's exported bookmarks file.
//
// Chrome, Edge, Firefox, Safari and Brave all export the same thing: the
// Netscape bookmark format, a nest of <DL>/<DT> lists where every bookmark is
// an <A HREF>. Folders are <H3> headings around nested lists. So one parser
// covers every browser the user is likely to be coming from, and "export
// bookmarks to an HTML file" is the one instruction that works everywhere.
//
// The nesting is not preserved. Shared bookmarks are a flat list injected into
// a start page, so a folder tree has nowhere to go; the folder a bookmark came
// from is kept only as a label on the preview row, to help the user recognise
// what they are about to import.
import {normalizeBookmarkUrl} from './bookmarks';
import type {SharedBookmark} from '../types';

export type ParsedBookmark = {
  title: string;
  url: string;
  icon?: string;
  // The folder path it came from, for the preview only -- 'Bookmarks bar/News'.
  folder: string;
  // Already in the workspace, or named twice in this same file.
  duplicate: boolean;
};

// Chrome inlines each favicon as a base64 data: URI in an ICON attribute, which
// is free iconography for the imported tiles -- no favicon fetch, no network.
// But a few sites ship a 100KB PNG, and these rows go to Supabase and then into
// every generated home page, so anything above this is dropped and left to the
// normal favicon resolver instead.
const MAX_ICON_BYTES = 8 * 1024;

// Everything else a bookmarks file can contain -- `javascript:` bookmarklets,
// Firefox's `place:` smart folders, `chrome://` internals -- cannot be opened
// from another browser's start page, so it is not worth importing.
function isImportable(href: string) {
  return /^https?:\/\//i.test(href);
}

export function parseBookmarkFile(
    html: string, existing: SharedBookmark[]): ParsedBookmark[] {
  // text/html parsing does not run scripts or fetch subresources, so an
  // arbitrary file off the user's disk is safe to hand to it. Doing this with
  // regexes over nested <DL>s is what the DOM parser is for.
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const seen = new Set(existing.map((bookmark) =>
    normalizeBookmarkUrl(bookmark.url).toLowerCase()));

  const parsed: ParsedBookmark[] = [];
  for (const anchor of Array.from(doc.querySelectorAll('a[href]'))) {
    const href = (anchor.getAttribute('href') || '').trim();
    if (!isImportable(href)) {
      continue;
    }
    const url = normalizeBookmarkUrl(href);
    const key = url.toLowerCase();
    const icon = anchor.getAttribute('icon') || '';
    parsed.push({
      title: (anchor.textContent || '').trim() || url,
      url,
      icon: icon.length <= MAX_ICON_BYTES ? icon || undefined : undefined,
      folder: folderPathOf(anchor),
      duplicate: seen.has(key),
    });
    // Added even when it is a duplicate, so a file listing the same site twice
    // marks the second one as a duplicate rather than importing it again.
    seen.add(key);
  }
  return parsed;
}

// The <H3> headings above this bookmark, outermost first. In the Netscape
// format a folder is an <H3> followed by a sibling <DL> holding its contents,
// so the heading is not an ancestor of the bookmark -- it is the previous
// element sibling of the <DL> the bookmark sits in.
function folderPathOf(anchor: Element): string {
  const parts: string[] = [];
  let node: Element | null = anchor.closest('dl');
  while (node) {
    const heading = node.previousElementSibling;
    const label = heading?.tagName === 'H3' ? (heading.textContent || '').trim() : '';
    if (label) {
      parts.unshift(label);
    }
    node = node.parentElement?.closest('dl') || null;
  }
  return parts.join('/');
}
