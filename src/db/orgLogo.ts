// The workspace's brand logo.
//
// Its own module rather than a function on orgs.ts, which owns table access and
// has no other reason to know about Storage -- the same split account.ts makes
// for user avatars, and this is deliberately the same shape as
// account.uploadAvatar down to the timestamped object path.
//
// The launcher and the website upload to the SAME bucket under the SAME prefix
// (`org-logos/<org id>/`), so a logo set on either surface appears on the other
// with no sync code. landing/lib/org-profile.ts holds the web half; the two must
// agree on the path or they become two logos.
import {requireClient, STORAGE_BUCKET} from './client';
import {imageExtensionFor} from './account';

// 2 MB. The bucket allows 50, which is sized for extension zips; a logo that
// large is a mistake worth catching when the file is picked rather than after a
// long upload. Smaller than the 5 MB avatar ceiling because this one is drawn at
// 24px in a sidebar.
export const LOGO_MAX_BYTES = 2 * 1024 * 1024;

// Returns the public URL. Writing it to organizations.logo_url is the caller's
// job -- the setup prompt folds it into one update alongside the other answers,
// and Settings writes it on its own.
//
// The path is timestamped rather than fixed for the reason account.ts documents:
// a stable path is served from cache by URL alone, so a replaced logo would keep
// rendering as the old one on every surface at once. Superseded objects are left
// in place; they are a few KB and deleting the previous one would race a second
// device still drawing it.
export async function uploadOrgLogo(orgId: string, file: File): Promise<string> {
  const client = requireClient();
  if (file.size > LOGO_MAX_BYTES) {
    throw new Error('That image is larger than 2 MB. Pick a smaller one.');
  }
  const objectPath = `org-logos/${orgId}/${Date.now()}.${imageExtensionFor(file)}`;
  const {error} = await client.storage
      .from(STORAGE_BUCKET)
      .upload(objectPath, file, {contentType: file.type || 'image/png', upsert: true});
  if (error) {
    throw new Error(`Could not upload the logo: ${error.message}`);
  }
  const {data} = client.storage.from(STORAGE_BUCKET).getPublicUrl(objectPath);
  return data.publicUrl;
}
