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
    placement: {kind: 'stable', name: 'ArgysCookieManager'},
    // Merged export/import UI plus, when this profile has a cookie file
    // assigned, the seed the extension's own background.js imports once on
    // first run. Previously two separate extensions; one so each profile shows
    // exactly one cookie extension that both seeds and manages.
    configure: async (payload, extensionDir, deps) => {
      // Lets the popup show which profile it is attached to (Argys Browser
      // windows are otherwise unlabeled from the extension's point of view).
      fs.writeFileSync(path.join(extensionDir, 'profile-meta.json'), JSON.stringify({
        id: payload.id || '',
        name: payload.name || '',
      }, null, 2));
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

// Every enabled built-in's directory, in table order.
async function materializeBuiltIns(payload, deps) {
  const enabled = BUILT_IN_EXTENSIONS.filter(
      (entry) => builtInEnabled(payload.builtInExtensions, entry));
  const paths = await Promise.all(
      enabled.map((entry) => materializeBuiltIn(payload, entry, deps)));
  return paths.filter(Boolean);
}

module.exports = {
  BUILT_IN_EXTENSIONS,
  BUILT_IN_EXTENSION_KEYS,
  CAPTCHA_PLUGIN_ID,
  builtInEnabled,
  builtInExtension,
  materializeBuiltIns,
};
