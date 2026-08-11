// What the launcher knows about which Monti Browser build is installed, and
// whether the published one is newer.
//
// Pulled out of main.cjs so the decision can be tested. The parts that matter
// are the ones that are expensive to get wrong: the browser archive is around
// 200 MB, so a false "stale" costs every user a needless download, and a false
// "current" leaves them on a build that will never be replaced.
//
// On why the build id is a hash and not a version. Until this file existed,
// every published manifest carried a version invented by whoever uploaded it:
// mac said "1.0.0" for months across unrelated builds, Windows said
// "2026.07.08.1632". Neither tracked anything, so main.cjs keyed staleness on
// sha512 -- the only field that reliably changes when the archive does.
// publish-browser.mjs now derives a real version from chrome/VERSION, but the
// hash stays the identity: two builds of the same Chromium version are still
// two different builds, and that is the common case for a fork.

// The marker written beside an install. Superseded the bare-string
// `.monti-browser-build` below, which recorded only the hash -- enough to
// answer "is this current?" and nothing else, which is why the UI could never
// show a version or an install date.
const INSTALL_RECORD_FILE = '.monti-browser-install.json';
const LEGACY_BUILD_ID_FILE = '.monti-browser-build';

// Turns a downloaded manifest into the shape the rest of the code relies on,
// or throws. Anything reaching here came off the network, so nothing is
// assumed to be present or to be a string.
function normalizeManifest(raw) {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Browser manifest is not an object.');
  }
  const sha512 = typeof raw.sha512 === 'string' ? raw.sha512 : '';
  const version = typeof raw.version === 'string' ? raw.version : '';
  const url = typeof raw.url === 'string' ? raw.url : '';
  if (!url) {
    throw new Error('Browser manifest has no url.');
  }
  // sha512 preferred, version as a fallback: manifests published before
  // publish-browser.mjs existed are not guaranteed to carry a hash, and a
  // missing build id would make every check report "stale" forever.
  const buildId = sha512 || version;
  if (!buildId) {
    throw new Error('Browser manifest has neither sha512 nor version.');
  }
  return {
    buildId,
    sha512,
    version,
    url,
    size: Number(raw.size) || 0,
    releaseDate: typeof raw.releaseDate === 'string' ? raw.releaseDate : '',
    // Only manifests written by publish-browser.mjs carry these two.
    chromiumVersion: typeof raw.chromiumVersion === 'string' ? raw.chromiumVersion : version,
    notes: typeof raw.notes === 'string' ? raw.notes : '',
  };
}

// Reads the marker left by the last successful install.
//
// `legacyBuildId` is the contents of the old bare-string file, and handling it
// is the whole reason this function is separate. Every existing install has
// one and no JSON record; treating that as "nothing installed" would push a
// ~200 MB re-download onto every user on the day this ships, to fetch the
// build they already have.
function readInstallRecord({recordJson = '', legacyBuildId = ''} = {}) {
  const trimmedJson = String(recordJson || '').trim();
  if (trimmedJson) {
    try {
      const parsed = JSON.parse(trimmedJson);
      if (parsed && typeof parsed === 'object' && typeof parsed.buildId === 'string' && parsed.buildId) {
        return {
          buildId: parsed.buildId,
          version: typeof parsed.version === 'string' ? parsed.version : '',
          chromiumVersion: typeof parsed.chromiumVersion === 'string' ? parsed.chromiumVersion : '',
          releaseDate: typeof parsed.releaseDate === 'string' ? parsed.releaseDate : '',
          installedAt: typeof parsed.installedAt === 'string' ? parsed.installedAt : '',
          notes: typeof parsed.notes === 'string' ? parsed.notes : '',
          legacy: false,
        };
      }
    } catch {
      // Corrupt record. Fall through to the legacy marker rather than
      // declaring nothing installed -- the build on disk is still real.
    }
  }
  const trimmedLegacy = String(legacyBuildId || '').trim();
  if (trimmedLegacy) {
    // Everything except the identity is unknown, and honestly so: the old
    // format never recorded a version or a date. `legacy: true` is what tells
    // the caller to backfill the rest from the manifest once they match.
    return {
      buildId: trimmedLegacy,
      version: '',
      chromiumVersion: '',
      releaseDate: '',
      installedAt: '',
      notes: '',
      legacy: true,
    };
  }
  return null;
}

// The one decision. Returns what to do, never does it.
//
//   'install'          nothing managed is installed -- fetch it, no asking
//   'update-available' a managed install exists and a different build is out
//   'up-to-date'       the installed build is the published one
//
// `usingManaged` means the browser the launcher would actually start is the
// copy under our control. It can be false while a browser still exists -- a
// bundled one, or a hand-installed /Applications/Monti.app -- and in that case
// the managed copy has to be installed before anything can be kept current, so
// that is an 'install' rather than a prompt. It only happens once: the managed
// copy outranks the others as soon as it lands.
function decideBrowserAction({record, manifest, usingManaged}) {
  if (!manifest) {
    throw new Error('decideBrowserAction needs a manifest.');
  }
  if (!usingManaged) {
    return 'install';
  }
  if (!record || record.buildId !== manifest.buildId) {
    return 'update-available';
  }
  return 'up-to-date';
}

// What to write after an install, or after recognising that a legacy marker
// already names the published build.
function buildInstallRecord(manifest, {installedAt}) {
  return {
    buildId: manifest.buildId,
    version: manifest.version,
    chromiumVersion: manifest.chromiumVersion,
    releaseDate: manifest.releaseDate,
    installedAt,
    notes: manifest.notes,
  };
}

module.exports = {
  INSTALL_RECORD_FILE,
  LEGACY_BUILD_ID_FILE,
  normalizeManifest,
  readInstallRecord,
  decideBrowserAction,
  buildInstallRecord,
};
