// The built-in ("stock") extensions every profile can launch with, as one
// table instead of one bespoke function each.
//
// Before this file there were three near-identical paths in main.cjs --
// bundledExtensionPaths, writeProfileCookieManagerExtension and
// writeProfileFreeProxyExtension -- that all copied a folder into the
// profile's user-data-dir and differed only in where they put it and which
// extra files they wrote next to it. A fourth extension would have been a
// fourth copy of that code. Those two differences are now `placement` and
// `configure`, so a fifth extension is a row.
//
// Deliberately free of any `electron` require: the only Electron-owned value
// this needs is the shared-extension cache root, which arrives through `deps`.
// That keeps the table importable from vitest (see built-in-extensions.test.js,
// which asserts these keys match the UI's BUILT_IN_EXTENSIONS) without pulling
// an Electron app into the test process.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const EXTENSIONS_ROOT = path.join(__dirname, '../extensions');

// Web Store id of the CaptchaPlugin solver. Unlike the other three this one is
// not vendored into extensions/: it is ~80 MB unpacked, so it is downloaded
// once per machine into the shared cache and every profile loads that one copy
// rather than getting its own.
const CAPTCHA_PLUGIN_ID = 'iomcoelgdkghlligeempdbfcaobodacg';

// `key` matches a field of BuiltInExtensionToggles in src/types.ts, and the
// `key` of an entry in src/data/extensionCatalog.ts's BUILT_IN_EXTENSIONS --
// that string is the whole contract between this table and the card/toggle the
// user actually sees, since main.cjs is CommonJS and cannot import the
// TypeScript one.
//
// `defaultEnabled` is the polarity of a missing value, not decoration. The
// first three shipped before their toggle existed, so absent has to mean on or
// old cloud state would silently lose them. captcha_plugin is the opposite: it
// costs a ~56 MB download, so an org that has never heard of it must not read
// as having opted in.
const BUILT_IN_EXTENSIONS = [
  {
    key: 'cookie_manager',
    defaultEnabled: true,
    source: {kind: 'folder', dir: 'cookie-manager'},
    // Renamed from 'ArgysCookieManager' when the popup became a side panel.
    // Not cosmetic: Chrome caches an unpacked extension's service worker script
    // body against its directory path, independently of the manifest (see the
    // foxywall entry below for the CDP-confirmed details). A profile that had
    // already launched the old extension could have kept running a background.js
    // from before setPanelBehavior existed -- and with default_popup gone, a
    // worker that never registers the panel leaves the toolbar button doing
    // nothing at all. A new path is a new extension identity and therefore a
    // guaranteed-fresh worker.
    //
    // An unpacked extension's ID is derived from its path, so this also resets
    // chrome.storage.local once per existing profile: the seed-import watermark
    // and the sync watermark. Both are self-healing -- re-importing the same
    // seed cookies sets the same values again, and a reset sync watermark costs
    // one extra push -- and it happens once, at this release.
    placement: {kind: 'stable', name: 'ArgusPanel'},
    // The pre-rename directory, removed on launch so it does not sit in every
    // profile forever. Nothing loads it: it is not in --load-extension.
    retired: ['ArgysCookieManager'],
    // Given its own toolbar button rather than left inside the puzzle-piece
    // menu. This one is not an accessory to a page -- it is how you open the
    // session dashboard at all, and two clicks behind a menu is not a place a
    // primary surface can live. See seedPinnedExtensions below for how, and why
    // only a stable placement can ask for this.
    pinned: true,
    // The Argus Panel: the browser's side-panel dashboard. Cookie export/import
    // and sync, the session's proxy readout, and this launch's automations,
    // plus (when this profile has a cookie file assigned) the seed the
    // extension's own background.js imports once on first run.
    //
    // The key stays `cookie_manager` though the extension is no longer only
    // about cookies. It is the contract between this table, the card in
    // src/data/extensionCatalog.ts and the org's saved built_in_extensions
    // state -- renaming it would read as a missing key, fall back to
    // defaultEnabled, and silently discard every org's saved preference.
    configure: async (payload, extensionDir, deps) => {
      // Lets the panel show which profile it is attached to (Argys Browser
      // windows are otherwise unlabeled from the extension's point of view).
      fs.writeFileSync(path.join(extensionDir, 'profile-meta.json'), JSON.stringify({
        id: payload.id || '',
        name: payload.name || '',
      }, null, 2));
      // Everything the panel paints before it has talked to anyone: the proxy
      // verdict as homeProxyStatus composed it in the renderer, the theme to
      // paint it in, and the automations this launch may run. Written only when
      // the renderer supplied one, so the panel reads the file's absence as
      // "this window was not launched from Argus Launcher" -- the same contract
      // argus-launch.json already has for sync.
      //
      // No 0600 here, unlike argus-launch.json below: this file carries no
      // credential. The run token stays in that one.
      if (payload.sessionPanel) {
        fs.writeFileSync(path.join(extensionDir, 'argus-session.json'),
            JSON.stringify(payload.sessionPanel, null, 2));
      }
      // The per-launch credential the sync engine spends against the loopback
      // API (see /v1/cookies/push-from-profile in main.cjs). Written only when
      // the launch minted a token, so background.js reads the file's absence
      // as "sync unavailable" (e.g. the extension loaded outside a profile
      // launch). 0600 like the other file that carries this token.
      if (payload.startPage && payload.startPage.token) {
        fs.writeFileSync(path.join(extensionDir, 'argus-launch.json'), JSON.stringify({
          token: payload.startPage.token,
          apiPort: payload.startPage.port,
        }, null, 2), {mode: 0o600});
      }
      const seedPath = path.join(extensionDir, 'seed-cookies.json');
      const writeSeedCookies = (cookies) => {
        if (cookies.length) {
          fs.writeFileSync(seedPath, JSON.stringify({cookies}, null, 2));
        }
      };
      if (payload.cookieImportUrl) {
        try {
          writeSeedCookies(await deps.parseCookieUrl(payload.cookieImportUrl));
        } catch {
          // Fall back to a local path below if one is still available.
        }
      }
      if (!fs.existsSync(seedPath) && payload.cookieImportPath) {
        try {
          writeSeedCookies(deps.parseCookieFile(payload.cookieImportPath));
        } catch {
          // No seed file written: the extension's own fetch() of
          // seed-cookies.json simply finds nothing and skips seeding, so this
          // fails soft.
        }
      }
    },
  },
  {
    key: 'sms_activate',
    defaultEnabled: true,
    source: {kind: 'folder', dir: 'onlinesim-sms'},
    placement: {kind: 'stable', name: path.join('ArgysBundled', 'SMSActivate')},
  },
  {
    key: 'foxywall_free_proxy',
    defaultEnabled: true,
    source: {kind: 'folder', dir: 'foxywall'},
    // Chrome caches an unpacked (--load-extension) service worker's script body
    // independently of its manifest version or file content -- reloading the
    // browser against the same stable path on an already-used profile can keep
    // running a stale background.js from hours earlier no matter how many times
    // the source file changes or its manifest version is bumped (confirmed via
    // live CDP inspection: chrome.runtime.getManifest().version reflected a
    // fresh bump, but functions/consts only present in newer source were still
    // undefined). A fresh, uniquely-named directory per launch gives Chrome a
    // genuinely new extension identity every time, so it can never reuse a
    // stale cached service worker. Stale siblings are pruned before each write,
    // or they would accumulate one directory per launch forever.
    placement: {kind: 'per-launch', prefix: 'ArgysFreeProxy-'},
    // FoxyWall is bundled for every profile (so its toolbar icon/manual toggle
    // is always available), but must only auto-connect on launch when the user
    // actually picked Free Proxy mode -- never for 'direct' (no proxy at all)
    // or 'assigned' (a real proxy already owns the connection; this would be a
    // second, competing proxy source). This config file is the signal
    // background.js reads before deciding whether to auto-connect.
    configure: (payload, extensionDir) => {
      fs.writeFileSync(path.join(extensionDir, 'argus-config.json'), JSON.stringify({
        autoConnect: Boolean(payload.useFreeProxy),
      }));
    },
  },
  {
    key: 'captcha_plugin',
    defaultEnabled: false,
    source: {kind: 'webstore', id: CAPTCHA_PLUGIN_ID},
  },
];

const BUILT_IN_EXTENSION_KEYS = BUILT_IN_EXTENSIONS.map((entry) => entry.key);

function builtInExtension(key) {
  return BUILT_IN_EXTENSIONS.find((entry) => entry.key === key) || null;
}

// Undefined/missing falls back to the entry's own default rather than a blanket
// `!== false`, which is what lets captcha_plugin ship off while the other three
// ship on. `toggles` is BuiltInExtensionToggles as saved in cloud state.
function builtInEnabled(toggles, entry) {
  const value = toggles ? toggles[entry.key] : undefined;
  return value === undefined || value === null ? entry.defaultEnabled : Boolean(value);
}

function destinationFor(userDataDir, entry) {
  return entry.placement.kind === 'per-launch' ?
    path.join(userDataDir, `${entry.placement.prefix}${Date.now()}`) :
    path.join(userDataDir, entry.placement.name);
}

function pruneStaleCopies(userDataDir, prefix) {
  let entries;
  try {
    entries = fs.readdirSync(userDataDir, {withFileTypes: true});
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isDirectory() && entry.name.startsWith(prefix)) {
      fs.rmSync(path.join(userDataDir, entry.name), {recursive: true, force: true});
    }
  }
}

// Returns a ready-to-load directory for one enabled entry, or '' -- never
// throws and never blocks. A profile launching without an extension is always
// preferable to a profile that will not launch.
async function materializeBuiltIn(payload, entry, deps) {
  // Web Store entries are never copied per profile and are never downloaded
  // here: launch uses whatever is already in the shared machine cache and
  // silently goes without if it is missing. Fetching is the enable click's job
  // (and the catch-up pass at app start), so no launch can ever wait on a
  // 56 MB download.
  if (entry.source.kind === 'webstore') {
    const cached = deps.webstoreCachePath(entry.source.id);
    return deps.isLoadableExtensionDir(cached) ? cached : '';
  }
  if (!payload || !payload.userDataDir) {
    return '';
  }
  const sourceDir = path.join(EXTENSIONS_ROOT, entry.source.dir);
  if (!deps.isLoadableExtensionDir(sourceDir)) {
    console.warn(
        `Skipping built-in extension "${entry.key}": source folder is missing or has no ` +
        `valid manifest.json (${sourceDir}). Profile launch will continue without it.`);
    return '';
  }
  if (entry.placement.kind === 'per-launch') {
    pruneStaleCopies(payload.userDataDir, entry.placement.prefix);
  }
  for (const name of entry.retired || []) {
    fs.rmSync(path.join(payload.userDataDir, name), {recursive: true, force: true});
  }
  const extensionDir = destinationFor(payload.userDataDir, entry);
  fs.rmSync(extensionDir, {recursive: true, force: true});
  deps.copyDirectoryContents(sourceDir, extensionDir);
  if (!deps.isLoadableExtensionDir(extensionDir)) {
    console.warn(
        `Skipping built-in extension "${entry.key}": copy to ${extensionDir} did not ` +
        `produce a readable manifest.json. Profile launch will continue without it.`);
    fs.rmSync(extensionDir, {recursive: true, force: true});
    return '';
  }
  if (entry.configure) {
    try {
      await entry.configure(payload, extensionDir, deps);
    } catch (error) {
      // The extension itself is already copied and loadable; losing its
      // per-profile config file degrades that one feature rather than the
      // launch, so keep the directory.
      console.error(`Configuring built-in extension "${entry.key}" failed:`, error);
    }
  }
  return extensionDir;
}

// ---- toolbar pinning ---------------------------------------------------------
// An unpacked extension has no key in its manifest, so Chromium derives its id
// from where it sits on disk: SHA-256 of the absolute, symlink-resolved
// directory path, first 16 bytes, hex, with 0-9a-f mapped onto a-p (a numeric
// id would read as an IP address to some software). See
// crx_file::id_util::GenerateIdForPath and UnpackedInstaller::Load in the
// browser tree -- the path is passed through MakeAbsoluteFilePath first, which
// is realpath(), hence realpathSync here.
//
// Reproduced rather than asked for because the browser cannot be asked: the id
// has to be known *before* launch, to name the extension in a preference the
// browser reads on startup.
function unpackedExtensionId(extensionDir) {
  const resolved = fs.realpathSync(extensionDir);
  const digest = crypto.createHash('sha256').update(resolved, 'utf8').digest('hex');
  return digest.slice(0, 32).replace(/[0-9a-f]/g,
      (character) => String.fromCharCode(97 + parseInt(character, 16)));
}

// Pins every enabled built-in that asked for a toolbar button, by seeding
// Chromium's own `extensions.pinned_extensions` list in the profile's
// Preferences file before the browser opens it.
//
// That pref is a plain syncable list (ExtensionPrefs::RegisterProfilePrefs in
// the browser tree) and is *not* one of the MAC-signed tracked preferences, so
// writing it from out here is not something Chromium will detect and reset --
// unlike extensions.settings next to it. The enterprise ExtensionSettings
// policy has a `toolbar_pin: force_pinned` for the same job, but on macOS that
// needs a managed-preferences plist and therefore an MDM or an admin, which is
// not something an app can arrange for itself.
//
// Seeded once, not enforced: if the key already exists this leaves it alone, so
// a user who unpins the button keeps it unpinned. force_pinned would take that
// choice away, and this is a convenience, not a policy.
//
// Only stable placements are eligible. A per-launch directory gets a new path,
// and therefore a new id, every single launch -- pinning those would append a
// dead id to this list forever and never pin anything the user could see.
function seedPinnedExtensions(payload, deps) {
  const prefsPath = path.join(payload.userDataDir, 'Default', 'Preferences');
  let prefs;
  try {
    prefs = JSON.parse(fs.readFileSync(prefsPath, 'utf8'));
  } catch {
    // No Preferences file yet (a profile's very first launch), or an unreadable
    // one. Either way there is nothing to merge with and nothing to preserve.
    prefs = {};
  }
  // Chromium's JsonPrefStore treats the dots in a registered pref name as
  // nested object paths, so the on-disk shape is {"extensions":
  // {"pinned_extensions": [...]}} rather than a flat dotted key. Same rule
  // writeProfileProxyAssignment documents for argus.profile_data.
  const extensions = prefs.extensions || {};
  if (Array.isArray(extensions.pinned_extensions)) {
    return [];
  }
  const ids = [];
  for (const entry of BUILT_IN_EXTENSIONS) {
    if (!entry.pinned || !builtInEnabled(payload.builtInExtensions, entry)) continue;
    if (entry.placement?.kind !== 'stable') continue;
    const dir = path.join(payload.userDataDir, entry.placement.name);
    if (!deps.isLoadableExtensionDir(dir)) continue;
    try {
      ids.push(unpackedExtensionId(dir));
    } catch (error) {
      // A button that is one click further away is not worth failing a launch
      // over, or even worth a warning louder than this.
      console.warn(`Could not compute an extension id for "${entry.key}":`, error);
    }
  }
  if (!ids.length) {
    return [];
  }
  extensions.pinned_extensions = ids;
  prefs.extensions = extensions;
  fs.mkdirSync(path.dirname(prefsPath), {recursive: true});
  fs.writeFileSync(prefsPath, JSON.stringify(prefs));
  return ids;
}

// Every enabled built-in's directory, in table order.
async function materializeBuiltIns(payload, deps) {
  const enabled = BUILT_IN_EXTENSIONS.filter(
      (entry) => builtInEnabled(payload.builtInExtensions, entry));
  const paths = await Promise.all(
      enabled.map((entry) => materializeBuiltIn(payload, entry, deps)));
  // After the copies land, never before: the id is derived from a directory
  // that has to exist to be realpath()ed.
  try {
    seedPinnedExtensions(payload, deps);
  } catch (error) {
    console.error('Could not seed pinned extensions:', error);
  }
  return paths.filter(Boolean);
}

module.exports = {
  BUILT_IN_EXTENSIONS,
  BUILT_IN_EXTENSION_KEYS,
  CAPTCHA_PLUGIN_ID,
  builtInEnabled,
  builtInExtension,
  materializeBuiltIns,
  seedPinnedExtensions,
  unpackedExtensionId,
};
