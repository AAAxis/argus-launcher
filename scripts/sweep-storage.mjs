#!/usr/bin/env node
// Deletes Storage objects that nothing points at any more.
//
//   node scripts/sweep-storage.mjs            # dry run, prints what it would do
//   node scripts/sweep-storage.mjs --apply    # actually deletes
//
// Every uploader in this app names its object with Date.now() and never removes
// the one it replaces -- src/db/cookieSets.ts, src/db/profiles.ts,
// src/db/account.ts, src/db/orgLogo.ts, and landing/lib/avatar.ts all do it, on
// purpose, because a stable key would be served from the CDN as the previous
// file. For a 5 MB avatar changed twice a year that is a fine trade. For the
// cookie jar it is not: the cookie-manager extension pushes on a six-second
// floor, so a running profile leaves roughly ten dead 30 KB objects a minute.
//
// uploadCookieFile now removes its own predecessor, so this is not a job that
// needs to run on a schedule. It exists for the backlog that accumulated before
// that landed, and for the objects stranded by a purge -- deleting a profile or
// a cookie set has never touched the files behind it.
//
// It is not part of the pg_cron retention job in
// supabase/migrations/20260816000000_data_retention.sql, and cannot be:
// deleting a row from storage.objects does not delete the file it describes, it
// only orphans it, so Storage has to be swept over the API and not in SQL.
//
// Needs the service role. The bucket's own delete policy is scoped to
// `owner = auth.uid()`, which is exactly what stops a signed-in user from
// tidying up after a teammate.
//
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/sweep-storage.mjs
import {createClient} from '@supabase/supabase-js';

const BUCKET = 'global';
// Anything newer than this is left alone whatever the database says about it. A
// push that is mid-flight has its object up before the source_url column
// catches up, and the difference between "superseded" and "not committed yet"
// is not visible from here.
const GRACE_MS = 24 * 60 * 60 * 1000;
const PAGE = 1000;
const DELETE_CHUNK = 100;

const apply = process.argv.includes('--apply');
const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error(
      'Set SUPABASE_URL (or VITE_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY.\n' +
      'The service key is in the umbrella repo secrets, not in this one.');
  process.exit(1);
}

const client = createClient(url, key, {auth: {persistSession: false}});
const storage = client.storage.from(BUCKET);

// ---- what the database still points at -----------------------------------

// Soft-deleted rows count as live. A set in Trash can be restored for thirty
// days, and restoring it to a source_url whose file this script removed would
// be a silent data loss discovered at the next launch.
async function referencedPaths() {
  const marker = `/storage/v1/object/public/${BUCKET}/`;
  const paths = new Set();
  const add = (value) => {
    if (typeof value !== 'string') {
      return;
    }
    const at = value.indexOf(marker);
    if (at === -1) {
      return;
    }
    paths.add(decodeURIComponent(value.slice(at + marker.length).split('?')[0]));
  };

  const sources = [
    ['cookie_sets', 'source_url'],
    ['profiles', 'cookie_import_url'],
    ['profiles', 'avatar'],
    ['organizations', 'logo_url'],
    ['shared_extensions', 'storage_url'],
  ];
  for (const [table, column] of sources) {
    const {data, error} = await client.from(table).select(column);
    if (error) {
      // Refusing rather than guessing. A column this script cannot read reads
      // as "nothing references anything", and the classifier below would take
      // that as licence to empty the bucket.
      throw new Error(`Could not read ${table}.${column}: ${error.message}`);
    }
    for (const row of data || []) {
      add(row[column]);
    }
  }

  // Account avatars are the exception: src/db/account.ts records the URL on
  // auth.users.raw_user_meta_data under `monti_avatar_url`, not in a public
  // table, so PostgREST cannot see it and the Admin API is the only reader.
  for (let page = 1; ; page += 1) {
    const {data, error} = await client.auth.admin.listUsers({page, perPage: 200});
    if (error) {
      throw new Error(`Could not list users for avatar URLs: ${error.message}`);
    }
    for (const user of data.users) {
      add(user.user_metadata?.monti_avatar_url);
    }
    if (data.users.length < 200) {
      break;
    }
  }
  return paths;
}

// ---- what is actually in the bucket --------------------------------------

async function walk(prefix, out = []) {
  for (let offset = 0; ; offset += PAGE) {
    const {data, error} = await storage.list(prefix, {limit: PAGE, offset});
    if (error) {
      throw new Error(`list(${prefix || '/'}) failed: ${error.message}`);
    }
    for (const entry of data) {
      if (entry.name.startsWith('.')) {
        continue;
      }
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.id === null) {
        await walk(path, out);
      } else {
        out.push({
          path,
          folder: path.slice(0, path.lastIndexOf('/')),
          createdAt: Date.parse(entry.created_at || entry.updated_at || 0) || 0,
          size: Number(entry.metadata?.size) || 0,
        });
      }
    }
    if (data.length < PAGE) {
      return out;
    }
  }
}

// ---- the rule ------------------------------------------------------------

// Keyed by the top-level prefix, because the prefixes mean different things.
// shared-extensions/ is absent deliberately: src/db/extensions.ts is the one
// uploader here that uses a stable key, so it has no supersedes to collect and
// every object under it is live.
const SWEPT = new Set(['profile-cookies', 'avatars', 'profile-avatars', 'org-logos']);

function classify(objects, referenced, now) {
  // Newest per folder is kept whether or not the database mentions it. It is
  // belt and braces against a source_url this script failed to parse -- a
  // legacy data: URL, a row shape nobody remembers -- and it costs one small
  // object per folder against the several hundred this reclaims.
  const newestPerFolder = new Map();
  for (const object of objects) {
    const best = newestPerFolder.get(object.folder);
    if (!best || object.createdAt > best.createdAt) {
      newestPerFolder.set(object.folder, object);
    }
  }

  const doomed = [];
  const skipped = [];
  for (const object of objects) {
    const top = object.path.split('/')[0];
    if (!SWEPT.has(top)) {
      skipped.push(object);
      continue;
    }
    if (referenced.has(object.path)) {
      continue;
    }
    if (now - object.createdAt < GRACE_MS) {
      continue;
    }
    if (newestPerFolder.get(object.folder) === object) {
      continue;
    }
    doomed.push(object);
  }
  return {doomed, skipped};
}

// ---- report and act ------------------------------------------------------

function mb(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function summarize(label, objects) {
  const byPrefix = new Map();
  for (const object of objects) {
    const top = object.path.split('/')[0];
    const row = byPrefix.get(top) || {count: 0, bytes: 0};
    row.count += 1;
    row.bytes += object.size;
    byPrefix.set(top, row);
  }
  console.log(`\n${label}`);
  if (byPrefix.size === 0) {
    console.log('  (nothing)');
    return;
  }
  for (const [prefix, row] of [...byPrefix].sort((a, b) => b[1].count - a[1].count)) {
    console.log(`  ${prefix.padEnd(20)} ${String(row.count).padStart(5)} objects  ${mb(row.bytes)}`);
  }
}

const referenced = await referencedPaths();
if (referenced.size === 0) {
  console.error('No live object paths found in the database. Refusing to delete anything.');
  process.exit(1);
}

const objects = await walk('');
const {doomed, skipped} = classify(objects, referenced, Date.now());

console.log(`bucket ${BUCKET}: ${objects.length} objects, ${mb(objects.reduce((n, o) => n + o.size, 0))}`);
console.log(`${referenced.size} of them are referenced by a row.`);
summarize('Would delete:', doomed);
if (skipped.length) {
  summarize('Left alone (prefix not swept):', skipped);
}

if (!apply) {
  console.log('\nDry run. Re-run with --apply to delete.');
  process.exit(0);
}

let removed = 0;
for (let at = 0; at < doomed.length; at += DELETE_CHUNK) {
  const chunk = doomed.slice(at, at + DELETE_CHUNK).map((object) => object.path);
  const {error} = await storage.remove(chunk);
  if (error) {
    console.error(`\nremove() failed after ${removed} objects: ${error.message}`);
    process.exit(1);
  }
  removed += chunk.length;
  process.stdout.write(`\rdeleted ${removed}/${doomed.length}`);
}
console.log(`\nDone. Removed ${removed} objects, ${mb(doomed.reduce((n, o) => n + o.size, 0))}.`);
