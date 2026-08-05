// The signed-in person, as opposed to the organization they work in.
//
// Everything here talks to Supabase Auth (and, for the avatar, to the same
// public `global` bucket the extension and cookie uploads use). It lives beside
// the table modules because it follows their conventions -- requireClient(),
// one job per function, errors thrown rather than returned -- but note that
// none of it is org-scoped: an account belongs to a user, not to a tenant.
import type {User} from '@supabase/supabase-js';
import {optionalClient, requireClient, STORAGE_BUCKET} from './client';

// Our own avatar key, deliberately NOT `avatar_url`.
//
// Supabase refreshes user_metadata from the identity provider on every Google
// sign-in, so anything written under a key the provider also owns (`avatar_url`,
// `picture`, `full_name`) is liable to be replaced by Google's copy the next
// time the user signs in. A private key survives that.
const AVATAR_KEY = 'argus_avatar_url';
const NAME_KEY = 'argus_display_name';

// 5 MB. The bucket itself allows 50 (see docs/supabase-migrations.sql), which is
// sized for extension zips; an avatar that large is a mistake worth catching at
// the point the user picks the file rather than after a long upload.
export const AVATAR_MAX_BYTES = 5 * 1024 * 1024;

function metadata(user: User | null | undefined): Record<string, unknown> {
  return (user?.user_metadata as Record<string, unknown> | undefined) || {};
}

function httpsString(value: unknown): string {
  return typeof value === 'string' && /^https:\/\//.test(value) ? value : '';
}

// Ours first, then whatever the provider supplied: Google's OIDC claim is
// `picture`, while Supabase's normalized field is `avatar_url`. Removing a
// custom avatar therefore falls back to the Google picture rather than to
// nothing, which is what "Remove" should mean for a Google account.
export function accountAvatarUrl(user: User | null | undefined): string {
  const data = metadata(user);
  return httpsString(data[AVATAR_KEY]) || httpsString(data.avatar_url) || httpsString(data.picture);
}

// Whether the picture on screen is one the user uploaded, as opposed to the one
// Google supplied. Settings offers "Remove" only in the first case: removing a
// provider picture is not something this app can do, and a button that appears
// to do nothing is worse than no button.
export function accountHasCustomAvatar(user: User | null | undefined): boolean {
  return Boolean(httpsString(metadata(user)[AVATAR_KEY]));
}

// Same precedence for the name. `full_name` is the provider's, so an edit here
// would be overwritten on the next Google sign-in if it were written back to
// that key -- hence NAME_KEY.
export function accountDisplayName(user: User | null | undefined): string {
  const data = metadata(user);
  for (const value of [data[NAME_KEY], data.full_name, data.name]) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return '';
}

// Which sign-in methods are linked. Supabase calls the email-code identity
// 'email'; the launcher only ever offers codes, never a password, so that is
// what the label says.
export function accountProviders(user: User | null | undefined): string[] {
  const identities = user?.identities || [];
  const seen = new Set<string>();
  for (const identity of identities) {
    if (identity.provider) {
      seen.add(identity.provider);
    }
  }
  // An account created before identities were populated still signed in somehow.
  if (seen.size === 0 && user?.email) {
    seen.add('email');
  }
  return [...seen];
}

export function describeProvider(provider: string): string {
  if (provider === 'email') {
    return 'Email code';
  }
  return provider.charAt(0).toUpperCase() + provider.slice(1);
}

// The current user, re-fetched from the server rather than read off the cached
// session: updateUser() returns the new record, but a sign-in that happened in
// another window would not be reflected in a stale session object.
export async function currentUser(): Promise<User | null> {
  const client = optionalClient();
  if (!client) {
    return null;
  }
  const {data} = await client.auth.getUser();
  return data.user || null;
}

export async function updateDisplayName(name: string): Promise<User | null> {
  const client = requireClient();
  const trimmed = name.trim();
  const {data, error} = await client.auth.updateUser({
    data: {[NAME_KEY]: trimmed || null},
  });
  if (error) {
    throw new Error(error.message || 'Could not save your name.');
  }
  return data.user;
}

const EXTENSION_BY_TYPE: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

// The object-path suffix for a picked image. Exported because profiles.ts
// uploads avatars too and a second copy of this map would be a second place for
// "we accept webp" to be answered differently.
//
// The browser is the authority on the type, but a file dragged from a share or
// picked on a system with no mapping arrives with an empty `type`, so the name
// is the fallback and `png` the last resort -- Storage needs *a* suffix and a
// wrong one costs a content-type header, not the picture.
export function imageExtensionFor(file: File): string {
  return EXTENSION_BY_TYPE[file.type] ||
    (file.name.split('.').pop() || 'png').toLowerCase().replace(/[^a-z0-9]/g, '') ||
    'png';
}

// Uploads to `avatars/<user id>/<timestamp>.<ext>` and records the public URL on
// the user's metadata, which is what both this app and the website read.
//
// The object path is timestamped rather than fixed so the new picture appears
// immediately: a stable path would be served from cache by URL alone, and every
// surface showing the old image would keep showing it. Superseded objects are
// left in place -- they are a few KB each, and deleting the previous one on
// upload would race a second device still rendering it.
export async function uploadAvatar(file: File): Promise<User | null> {
  const client = requireClient();
  if (file.size > AVATAR_MAX_BYTES) {
    throw new Error('That image is larger than 5 MB. Pick a smaller one.');
  }
  const {data: userData} = await client.auth.getUser();
  const userId = userData.user?.id;
  if (!userId) {
    throw new Error('You are not signed in.');
  }
  const objectPath = `avatars/${userId}/${Date.now()}.${imageExtensionFor(file)}`;
  const {error: uploadError} = await client.storage
      .from(STORAGE_BUCKET)
      .upload(objectPath, file, {contentType: file.type || 'image/png', upsert: true});
  if (uploadError) {
    throw new Error(`Could not upload the image: ${uploadError.message}`);
  }
  const {data: publicData} = client.storage.from(STORAGE_BUCKET).getPublicUrl(objectPath);
  const {data, error} = await client.auth.updateUser({
    data: {[AVATAR_KEY]: publicData.publicUrl},
  });
  if (error) {
    throw new Error(error.message || 'The image uploaded but could not be saved to your account.');
  }
  return data.user;
}

// Drops our key only. A Google account keeps its provider picture; an
// email-code account falls back to the initials circle.
export async function clearAvatar(): Promise<User | null> {
  const client = requireClient();
  const {data, error} = await client.auth.updateUser({data: {[AVATAR_KEY]: null}});
  if (error) {
    throw new Error(error.message || 'Could not remove the picture.');
  }
  return data.user;
}

// Revokes every refresh token for this user, not just this device's. The local
// session is cleared too, so the caller does not need a separate signOut().
export async function signOutEverywhere(): Promise<void> {
  const client = requireClient();
  const {error} = await client.auth.signOut({scope: 'global'});
  if (error) {
    throw new Error(error.message || 'Could not sign out of your other sessions.');
  }
}
