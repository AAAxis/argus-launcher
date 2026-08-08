import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {describe, expect, it} from 'vitest';
// CJS interop: the same table main.cjs materializes extensions from.
// @ts-expect-error CJS module without types
import {argusPanelExtensionId, builtInExtension, seedPinnedExtensions, unpackedExtensionId} from '../../electron/built-in-extensions.cjs';

const deps = {parseCookieUrl: async () => [], parseCookieFile: () => []};
const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'argus-ext-'));

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

  it('writes the panel id into extensions.pinned_extensions', () => {
    const userDataDir = tempDir();
    const dir = materialize(userDataDir);
    expect(seedPinnedExtensions({userDataDir}, deps)).toEqual([unpackedExtensionId(dir)]);
    expect(readPinned(userDataDir)).toEqual([unpackedExtensionId(dir)]);
  });

  // Chromium's JsonPrefStore reads dotted pref names as nested objects, so a
  // flat "extensions.pinned_extensions" key would be silently ignored.
  it('nests the key rather than writing a flat dotted one', () => {
    const userDataDir = tempDir();
    materialize(userDataDir);
    seedPinnedExtensions({userDataDir}, deps);
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
    expect(seedPinnedExtensions({userDataDir}, deps)).toEqual([]);
    expect(readPinned(userDataDir)).toEqual([]);
  });

  it('keeps the rest of an existing Preferences file', () => {
    const userDataDir = tempDir();
    materialize(userDataDir);
    fs.mkdirSync(path.join(userDataDir, 'Default'), {recursive: true});
    fs.writeFileSync(path.join(userDataDir, 'Default', 'Preferences'),
        JSON.stringify({homepage: 'file:///home.html', extensions: {settings: {a: 1}}}));
    seedPinnedExtensions({userDataDir}, deps);
    const prefs = JSON.parse(
        fs.readFileSync(path.join(userDataDir, 'Default', 'Preferences'), 'utf8'));
    expect(prefs.homepage).toBe('file:///home.html');
    expect(prefs.extensions.settings).toEqual({a: 1});
    expect(prefs.extensions.pinned_extensions).toHaveLength(1);
  });

  it('pins nothing when the panel is switched off', () => {
    const userDataDir = tempDir();
    materialize(userDataDir);
    expect(seedPinnedExtensions(
        {userDataDir, builtInExtensions: {cookie_manager: false}}, deps)).toEqual([]);
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
