import type {SharedBookmark} from '../types';
import {optionalClient, raise, requireClient} from './client';
import {rowToBookmark} from './mappers';
import type {SharedBookmarkRow} from './rows';

// The UI has always identified a shared bookmark by its normalized url -- the
// edit dialog carries `originalUrl`, and mergeBookmarks() dedupes on it. So the
// writes below are url-keyed too, and the row's uuid id is carried on the type
// only for ordering and debugging. Duplicates cannot arise: the client dedupes
// before every write.
export async function list(orgId: string): Promise<SharedBookmark[]> {
  const client = optionalClient();
  if (!client) {
    return [];
  }
  const {data, error} = await client
      .from('shared_bookmarks')
      .select('id,org_id,title,url,position,icon')
      .eq('org_id', orgId)
      .order('position', {ascending: true, nullsFirst: false});
  raise(error, 'bookmarks.list');
  return ((data || []) as unknown as SharedBookmarkRow[]).map(rowToBookmark);
}

// id comes from the column default (uuid), so the caller gets it back here
// rather than generating one.
export async function create(orgId: string, bookmark: SharedBookmark): Promise<SharedBookmark> {
  const client = requireClient();
  const {data, error} = await client
      .from('shared_bookmarks')
      .insert({
        org_id: orgId,
        title: bookmark.title,
        url: bookmark.url,
        icon: bookmark.icon ?? null,
        position: bookmark.position ?? null,
      })
      .select('id,org_id,title,url,position,icon')
      .single();
  raise(error, 'bookmarks.create');
  return rowToBookmark(data as unknown as SharedBookmarkRow);
}

// One statement for a whole imported file. A browser export routinely carries
// hundreds of bookmarks, and create()-in-a-loop would be that many round trips
// -- slow enough to look hung, and able to stop half done. The caller has
// already dropped duplicates, so this cannot collide.
export async function createMany(
    orgId: string, bookmarks: SharedBookmark[]): Promise<SharedBookmark[]> {
  if (!bookmarks.length) {
    return [];
  }
  const client = requireClient();
  const {data, error} = await client
      .from('shared_bookmarks')
      .insert(bookmarks.map((bookmark) => ({
        org_id: orgId,
        title: bookmark.title,
        url: bookmark.url,
        icon: bookmark.icon ?? null,
        position: bookmark.position ?? null,
      })))
      .select('id,org_id,title,url,position,icon');
  raise(error, 'bookmarks.createMany');
  return ((data || []) as unknown as SharedBookmarkRow[]).map(rowToBookmark);
}

// Replaces the row whose url is `originalUrl` -- the url itself is editable, so
// it cannot be both the lookup key and part of the patch.
export async function updateByUrl(
    orgId: string, originalUrl: string, bookmark: SharedBookmark): Promise<void> {
  const client = requireClient();
  const {error} = await client
      .from('shared_bookmarks')
      .update({
        title: bookmark.title,
        url: bookmark.url,
        icon: bookmark.icon ?? null,
        position: bookmark.position ?? null,
      })
      .eq('org_id', orgId)
      .eq('url', originalUrl);
  raise(error, 'bookmarks.updateByUrl');
}

export async function removeByUrl(orgId: string, url: string): Promise<void> {
  const client = requireClient();
  const {error} = await client
      .from('shared_bookmarks')
      .delete()
      .eq('org_id', orgId)
      .eq('url', url);
  raise(error, 'bookmarks.removeByUrl');
}

// Keeps display order in sync with the array the UI renders. One statement per
// moved bookmark, and only for the ones whose index actually changed.
export async function setPositions(orgId: string, urls: string[]): Promise<void> {
  const client = requireClient();
  for (let index = 0; index < urls.length; index++) {
    const {error} = await client
        .from('shared_bookmarks')
        .update({position: index})
        .eq('org_id', orgId)
        .eq('url', urls[index]);
    raise(error, 'bookmarks.setPositions');
  }
}
