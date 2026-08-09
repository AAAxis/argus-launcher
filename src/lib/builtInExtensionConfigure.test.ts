import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {describe, expect, it} from 'vitest';
// CJS interop: the same table main.cjs materializes extensions from.
// @ts-expect-error CJS module without types
import {argusPanelExtensionId, builtInExtension, seedPinnedExtensions, unpackedExtensionId, unpinRetiredExtensions, versionServiceWorker} from '../../electron/built-in-extensions.cjs';

const deps = {parseCookieUrl: async () => [], parseCookieFile: () => []};
const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'argus-ext-'));

// Chromium caches an unpacked extension's service worker script against its
// script PATH, independently of the manifest -- so copying a new background.js
// over the old one at the same path ships bytes the browser will not read. That
// is not a hypothetical: it is why the side panel's workspace lists answered
// "Unknown message" from a profile whose background.js on disk implemented
// them, through a relaunch and a full launcher restart.
//
// These assert the two halves that make the fix safe: the worker's name follows
// its content, and NOTHING else moves -- particularly not the directory, which
// is what the extension id, the toolbar button and chrome.storage.local are all
// derived from.
describe('service worker versioning', () => {
  const extensionDir = (worker = 'background.js', body = 'self.x = 1;') => {
    const dir = tempDir();
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({
      manifest_version: 3,
      name: 'Argus Helper',
      version: '3.1.0',
      background: {service_worker: worker},
    }));
    fs.writeFileSync(path.join(dir, worker), body);
    return dir;
  };
  const workerName = (dir: string) =>
    JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'))
        .background?.service_worker;

  it('renames the worker and points the manifest at the new name', () => {
    const dir = extensionDir();
    versionServiceWorker(dir);
    const named = workerName(dir);
    expect(named).toMatch(/^background\.[0-9a-f]{12}\.js$/);
    expect(fs.existsSync(path.join(dir, named))).toBe(true);
    // Exactly one worker on disk: leaving background.js beside it would be a
    // dead file that still looks like the entry point to anyone reading the
    // directory.
    expect(fs.existsSync(path.join(dir, 'background.js'))).toBe(false);
  });

  it('gives the same content the same name, so an unchanged build keeps its cache', () => {
    const a = extensionDir();
    const b = extensionDir();
    versionServiceWorker(a);
    versionServiceWorker(b);
    expect(workerName(a)).toBe(workerName(b));
  });

  it('gives changed content a different name, which is the whole point', () => {
    const a = extensionDir('background.js', 'self.x = 1;');
    const b = extensionDir('background.js', 'self.x = 2;');
    versionServiceWorker(a);
    versionServiceWorker(b);
    expect(workerName(a)).not.toBe(workerName(b));
  });

  // The worker importScripts() its siblings and their bodies are cached with
  // it, so a change to cookie-format.js alone still has to move the name.
  it('follows the sibling scripts the worker imports, not just the worker', () => {
    const a = extensionDir();
    const b = extensionDir();
    fs.writeFileSync(path.join(a, 'cookie-format.js'), 'A');
    fs.writeFileSync(path.join(b, 'cookie-format.js'), 'B');
    versionServiceWorker(a);
    versionServiceWorker(b);
    expect(workerName(a)).not.toBe(workerName(b));
  });

  // The directory is the extension's identity: its id is a hash of this path
  // (unpackedExtensionId), the browser is handed that id on the command line,
  // and chrome.storage.local -- the seed watermark and the sync watermark --
  // hangs off it. Versioning the SCRIPT is only worth doing because it leaves
  // all of that alone.
  it('does not move the directory, so the extension id is unchanged', () => {
    const dir = extensionDir();
    const before = unpackedExtensionId(dir);
    versionServiceWorker(dir);
    expect(unpackedExtensionId(dir)).toBe(before);
  });

  it('is idempotent: running it twice does not re-stamp an already-stamped name', () => {
    const dir = extensionDir();
    versionServiceWorker(dir);
    const once = workerName(dir);
    versionServiceWorker(dir);
    expect(workerName(dir)).toBe(once);
  });

  it('leaves an extension with no service worker alone', () => {
    const dir = tempDir();
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({name: 'x', version: '1'}));
    expect(() => versionServiceWorker(dir)).not.toThrow();
    expect(workerName(dir)).toBeUndefined();
  });
});

describe('cookie_manager configure', () => {
  it('writes argus-launch.json when the launch carries a run token', async () => {
    const dir = tempDir();
    await builtInExtension('cookie_manager')!.configure!(
        {id: 'p1', name: 'Profile One', startPage: {port: 39219, token: 'tok-abc'}}, dir, deps);
    const written = JSON.parse(fs.readFileSync(path.join(dir, 'argus-launch.json'), 'utf8'));
    expect(written).toEqual({token: 'tok-abc', apiPort: 39219});
  });

  it('writes no argus-launch.json when the launch has no token', async () => {
    const dir = tempDir();
    await builtInExtension('cookie_manager')!.configure!(
        {id: 'p1', name: 'Profile One', startPage: null}, dir, deps);
    expect(fs.existsSync(path.join(dir, 'argus-launch.json'))).toBe(false);
  });

  it('still writes profile-meta.json either way', async () => {
    const dir = tempDir();
    await builtInExtension('cookie_manager')!.configure!(
        {id: 'p1', name: 'Profile One'}, dir, deps);
    const meta = JSON.parse(fs.readFileSync(path.join(dir, 'profile-meta.json'), 'utf8'));
    expect(meta).toEqual({id: 'p1', name: 'Profile One'});
  });

  // The side panel's first paint. Written verbatim, not reshaped: the panel
  // renders homeProxyStatus() output as the renderer composed it, so anything
  // this hop rewrote would be a second opinion about the same session.
  it('writes argus-session.json verbatim when the launch carries panel data', async () => {
    const dir = tempDir();
    const sessionPanel = {
      profile: {id: 'p1', name: 'Profile One'},
      theme: 'dark',
      proxy: {
        ok: true,
        title: 'Anti-detect proxy active',
        detail: '1.2.3.4:8080 · Los Angeles, California, US · 131 ms',
        fields: [
          {label: 'Exit', value: '142.252.99.144', mono: true, note: '131 ms'},
          {label: 'Timezone', value: 'America/Los_Angeles', mono: true,
            note: 'matches exit', noteTone: 'ok'},
        ],
      },
      recheckable: true,
      automations: [{id: 'a1', name: 'Warm up feed'}],
    };
    await builtInExtension('cookie_manager')!.configure!(
        {id: 'p1', name: 'Profile One', sessionPanel}, dir, deps);
    const written = JSON.parse(fs.readFileSync(path.join(dir, 'argus-session.json'), 'utf8'));
    expect(written).toEqual(sessionPanel);
  });

  // Its absence is the panel's only signal that this window was not launched
  // from the launcher -- the same contract argus-launch.json has for sync. A
  // stub file with empty fields would make the panel paint a session that does
  // not exist.
  it('writes no argus-session.json when the launch carries none', async () => {
    const dir = tempDir();
    await builtInExtension('cookie_manager')!.configure!(
        {id: 'p1', name: 'Profile One', sessionPanel: null}, dir, deps);
    expect(fs.existsSync(path.join(dir, 'argus-session.json'))).toBe(false);
  });
});

// The toolbar button. Every assertion here is about a contract Chromium owns
// and this repo reimplements, which is exactly the code that fails silently:
// a wrong id or a wrong pref shape does not throw, it just means no button.
describe('pinning the panel to the toolbar', () => {
  const panelDir = (userDataDir: string) => path.join(userDataDir, 'ArgusPanel');

  const materialize = (userDataDir: string) => {
    const dir = panelDir(userDataDir);
    fs.mkdirSync(dir, {recursive: true});
    fs.copyFileSync(
        path.join(__dirname, '../../extensions/cookie-manager/manifest.json'),
        path.join(dir, 'manifest.json'));
    return dir;
  };
  const deps = {isLoadableExtensionDir: (dir: string) => fs.existsSync(path.join(dir, 'manifest.json'))};
  const readPinned = (userDataDir: string) => {
    const file = path.join(userDataDir, 'Default', 'Preferences');
    return fs.existsSync(file) ?
      JSON.parse(fs.readFileSync(file, 'utf8')).extensions?.pinned_extensions :
      undefined;
  };

  // crx_file::id_util::GenerateIdForPath: SHA-256 of the realpath'd directory,
  // first 16 bytes as hex, 0-9a-f mapped onto a-p.
  it('derives a 32-character a-p id from the directory path', () => {
    const dir = tempDir();
    const id = unpackedExtensionId(dir);
    expect(id).toMatch(/^[a-p]{32}$/);
    expect(unpackedExtensionId(dir)).toBe(id);
    expect(unpackedExtensionId(tempDir())).not.toBe(id);
  });

  // No entry in the table asks to be pinned any more -- the panel's button is
  // the browser's own native one now. The mechanism stays, because it is the
  // only way a future built-in could get a button, so it is exercised against a
  // table entry temporarily flipped back rather than deleted along with the
  // last caller. Restored in a finally: the table is a module singleton and a
  // leaked flag would pin the panel again in every test after this one.
  const asPinned = (run: () => void) => {
    const entry = builtInExtension('cookie_manager')!;
    entry.pinned = true;
    try {
      run();
    } finally {
      entry.pinned = false;
    }
  };

  it('pins nothing, because nothing in the table asks to be pinned', () => {
    const userDataDir = tempDir();
    materialize(userDataDir);
    expect(seedPinnedExtensions({userDataDir}, deps)).toEqual([]);
    expect(readPinned(userDataDir)).toBeUndefined();
  });

  it('writes an asking entry id into extensions.pinned_extensions', () => {
    const userDataDir = tempDir();
    const dir = materialize(userDataDir);
    asPinned(() => {
      expect(seedPinnedExtensions({userDataDir}, deps)).toEqual([unpackedExtensionId(dir)]);
    });
    expect(readPinned(userDataDir)).toEqual([unpackedExtensionId(dir)]);
  });

  // Chromium's JsonPrefStore reads dotted pref names as nested objects, so a
  // flat "extensions.pinned_extensions" key would be silently ignored.
  it('nests the key rather than writing a flat dotted one', () => {
    const userDataDir = tempDir();
    materialize(userDataDir);
    asPinned(() => seedPinnedExtensions({userDataDir}, deps));
    const prefs = JSON.parse(
        fs.readFileSync(path.join(userDataDir, 'Default', 'Preferences'), 'utf8'));
    expect(Array.isArray(prefs.extensions.pinned_extensions)).toBe(true);
    expect(prefs['extensions.pinned_extensions']).toBeUndefined();
  });

  // Seeded once, not enforced: unpinning is a choice the user is allowed to
  // keep, and an empty list is what unpinning the only pinned extension leaves.
  it('leaves an existing list alone, including an empty one', () => {
    const userDataDir = tempDir();
    materialize(userDataDir);
    fs.mkdirSync(path.join(userDataDir, 'Default'), {recursive: true});
    fs.writeFileSync(path.join(userDataDir, 'Default', 'Preferences'),
        JSON.stringify({extensions: {pinned_extensions: []}}));
    asPinned(() => {
      expect(seedPinnedExtensions({userDataDir}, deps)).toEqual([]);
    });
    expect(readPinned(userDataDir)).toEqual([]);
  });

  it('keeps the rest of an existing Preferences file', () => {
    const userDataDir = tempDir();
    materialize(userDataDir);
    fs.mkdirSync(path.join(userDataDir, 'Default'), {recursive: true});
    fs.writeFileSync(path.join(userDataDir, 'Default', 'Preferences'),
        JSON.stringify({homepage: 'file:///home.html', extensions: {settings: {a: 1}}}));
    asPinned(() => seedPinnedExtensions({userDataDir}, deps));
    const prefs = JSON.parse(
        fs.readFileSync(path.join(userDataDir, 'Default', 'Preferences'), 'utf8'));
    expect(prefs.homepage).toBe('file:///home.html');
    expect(prefs.extensions.settings).toEqual({a: 1});
    expect(prefs.extensions.pinned_extensions).toHaveLength(1);
  });

  it('pins nothing when the panel is switched off', () => {
    const userDataDir = tempDir();
    materialize(userDataDir);
    asPinned(() => {
      expect(seedPinnedExtensions(
          {userDataDir, builtInExtensions: {cookie_manager: false}}, deps)).toEqual([]);
    });
    expect(readPinned(userDataDir)).toBeUndefined();
  });

  // The id the native "Argus Helper" toolbar button drives the panel by --
  // passed to the browser as --argus-panel-extension-id.
  it('derives the panel extension id once its directory exists', () => {
    const userDataDir = tempDir();
    const dir = materialize(userDataDir);
    expect(argusPanelExtensionId({userDataDir})).toBe(unpackedExtensionId(dir));
  });

  it('derives no panel extension id when the panel is switched off', () => {
    const userDataDir = tempDir();
    materialize(userDataDir);
    expect(argusPanelExtensionId(
        {userDataDir, builtInExtensions: {cookie_manager: false}})).toBe('');
  });
});

// The other half of dropping `pinned`. Flipping the flag only helps profiles
// that have never launched -- seedPinnedExtensions bails on an existing list --
// so every profile that ran the old build carries the stale pin, and therefore a
// second, icon-only Argus Helper button beside the native labelled one.
//
// This is a pass over a list the user also owns, which is why every test here is
// about what it must NOT touch.
describe('unpinning a retired built-in', () => {
  const panelDir = (userDataDir: string) => path.join(userDataDir, 'ArgusPanel');

  const materialize = (userDataDir: string) => {
    const dir = panelDir(userDataDir);
    fs.mkdirSync(dir, {recursive: true});
    fs.copyFileSync(
        path.join(__dirname, '../../extensions/cookie-manager/manifest.json'),
        path.join(dir, 'manifest.json'));
    return dir;
  };
  const deps = {isLoadableExtensionDir: (dir: string) => fs.existsSync(path.join(dir, 'manifest.json'))};
  const writePrefs = (userDataDir: string, prefs: unknown) => {
    fs.mkdirSync(path.join(userDataDir, 'Default'), {recursive: true});
    fs.writeFileSync(path.join(userDataDir, 'Default', 'Preferences'), JSON.stringify(prefs));
  };
  const readPrefs = (userDataDir: string) => JSON.parse(
      fs.readFileSync(path.join(userDataDir, 'Default', 'Preferences'), 'utf8'));

  it('removes the panel id a previous build pinned', () => {
    const userDataDir = tempDir();
    const id = unpackedExtensionId(materialize(userDataDir));
    writePrefs(userDataDir, {extensions: {pinned_extensions: [id]}});
    expect(unpinRetiredExtensions({userDataDir}, deps)).toEqual([id]);
    expect(readPrefs(userDataDir).extensions.pinned_extensions).toEqual([]);
  });

  // The whole reason this cannot be "reset the list": it is shared with every
  // extension the user pinned themselves, and those ids must survive.
  it('leaves every other pinned extension in place, in order', () => {
    const userDataDir = tempDir();
    const id = unpackedExtensionId(materialize(userDataDir));
    writePrefs(userDataDir, {extensions: {pinned_extensions: ['aaaa', id, 'bbbb']}});
    unpinRetiredExtensions({userDataDir}, deps);
    expect(readPrefs(userDataDir).extensions.pinned_extensions).toEqual(['aaaa', 'bbbb']);
  });

  it('keeps the rest of the Preferences file', () => {
    const userDataDir = tempDir();
    const id = unpackedExtensionId(materialize(userDataDir));
    writePrefs(userDataDir,
        {homepage: 'file:///home.html', extensions: {settings: {a: 1}, pinned_extensions: [id]}});
    unpinRetiredExtensions({userDataDir}, deps);
    const prefs = readPrefs(userDataDir);
    expect(prefs.homepage).toBe('file:///home.html');
    expect(prefs.extensions.settings).toEqual({a: 1});
  });

  // Runs on every launch, so the overwhelmingly common case is "already
  // correct". It must not rewrite the file then: Chromium is holding it open,
  // and a pointless write is a pointless chance to corrupt it.
  it('writes nothing when there is nothing of ours to remove', () => {
    const userDataDir = tempDir();
    materialize(userDataDir);
    writePrefs(userDataDir, {extensions: {pinned_extensions: ['aaaa']}});
    const before = fs.statSync(path.join(userDataDir, 'Default', 'Preferences')).mtimeMs;
    expect(unpinRetiredExtensions({userDataDir}, deps)).toEqual([]);
    expect(fs.statSync(path.join(userDataDir, 'Default', 'Preferences')).mtimeMs).toBe(before);
  });

  it('does nothing on a profile that has never launched', () => {
    const userDataDir = tempDir();
    materialize(userDataDir);
    expect(unpinRetiredExtensions({userDataDir}, deps)).toEqual([]);
    expect(fs.existsSync(path.join(userDataDir, 'Default', 'Preferences'))).toBe(false);
  });

  // A profile carrying the stale pin AND the panel since switched off still
  // wants the dead button gone -- the extension is not loaded, so the button
  // does nothing at all.
  it('removes the pin even when the panel is switched off', () => {
    const userDataDir = tempDir();
    const id = unpackedExtensionId(materialize(userDataDir));
    writePrefs(userDataDir, {extensions: {pinned_extensions: [id]}});
    expect(unpinRetiredExtensions(
        {userDataDir, builtInExtensions: {cookie_manager: false}}, deps)).toEqual([id]);
    expect(readPrefs(userDataDir).extensions.pinned_extensions).toEqual([]);
  });
});

// The panel is loaded from the manifest, not from anything the launcher calls,
// so nothing else in this repo would notice these going wrong. Dropping
// default_popup without declaring the panel leaves the toolbar button doing
// nothing at all, which is silent in every other test.
describe('Argus Panel manifest', () => {
  const manifest = JSON.parse(fs.readFileSync(
      path.join(__dirname, '../../extensions/cookie-manager/manifest.json'), 'utf8'));

  it('declares the side panel and drops the popup', () => {
    expect(manifest.side_panel?.default_path).toBe('sidepanel.html');
    expect(manifest.permissions).toContain('sidePanel');
    expect(manifest.action.default_popup).toBeUndefined();
  });

  it('ships every file the panel loads', () => {
    const dir = path.join(__dirname, '../../extensions/cookie-manager');
    for (const file of ['sidepanel.html', 'sidepanel.css', 'sidepanel.js', 'icons.js']) {
      expect(fs.existsSync(path.join(dir, file)), `${file} is missing`).toBe(true);
    }
  });

  // Every <script src> in the markup, not a list kept here: the panel gained
  // sync-status.js and the two places that enumerate its scripts (this and
  // scripts/preview-panel.mjs) both had to learn about it. One of them didn't,
  // and the preview rendered a blank panel. Read the document instead.
  it('ships every script sidepanel.html loads, in a file that exists', () => {
    const dir = path.join(__dirname, '../../extensions/cookie-manager');
    const html = fs.readFileSync(path.join(dir, 'sidepanel.html'), 'utf8');
    const sources = [...html.matchAll(/<script\s+src="([^"]+)"/g)].map((match) => match[1]);
    expect(sources.length).toBeGreaterThan(0);
    for (const source of sources) {
      expect(fs.existsSync(path.join(dir, source)), `${source} is missing`).toBe(true);
    }
  });

  // A toolbar button whose icon file does not exist renders as a blank square
  // -- present, clickable, and invisible. Nothing else here would catch a
  // renamed icon directory, and the icons moved into per-theme subdirectories
  // exactly once, which is the change that would have shipped that.
  it('points at icon files that exist, in both themes', () => {
    const dir = path.join(__dirname, '../../extensions/cookie-manager');
    const declared = [
      ...Object.values(manifest.icons as Record<string, string>),
      ...Object.values(manifest.action.default_icon as Record<string, string>),
    ];
    expect(declared.length).toBe(8);
    for (const rel of declared) {
      expect(fs.existsSync(path.join(dir, rel)), `${rel} is missing`).toBe(true);
    }
    // background.js swaps to the other ink at runtime by substituting the
    // directory, so that set has to be complete too even though the manifest
    // never names it.
    for (const rel of declared) {
      const other = rel.replace('/on-light/', '/on-dark/');
      expect(fs.existsSync(path.join(dir, other)), `${other} is missing`).toBe(true);
    }
  });
});
