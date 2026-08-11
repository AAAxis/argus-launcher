// The built-in extensions are defined twice: the UI half here (card copy,
// artwork) and the runtime half in electron/built-in-extensions.cjs (where the
// files come from, where the copy goes). They cannot be one file -- main.cjs is
// CommonJS and cannot import TypeScript -- so `key` is the only thing holding
// them together, and nothing at runtime would complain if they drifted.
//
// Both failure modes are silent, which is why they are worth a test: an entry
// only in the runtime table is an extension every profile loads with no way to
// turn it off, and one only here is a card whose switch does nothing.
import {describe, expect, it} from 'vitest';
import {createRequire} from 'node:module';
import {BUILT_IN_EXTENSIONS, builtInExtensionEnabled} from './extensionCatalog';

const require = createRequire(import.meta.url);
const runtime = require('../../electron/built-in-extensions.cjs');

describe('built-in extensions', () => {
  it('defines the same keys in the UI and runtime halves', () => {
    expect([...runtime.BUILT_IN_EXTENSION_KEYS].sort())
        .toEqual(BUILT_IN_EXTENSIONS.map((entry) => entry.key).sort());
  });

  // The polarity of a missing toggle, not decoration: get this wrong for
  // captcha_plugin and every org that has never heard of it reads as having
  // opted into a ~56 MB download.
  it('agrees on what a missing toggle means', () => {
    for (const entry of BUILT_IN_EXTENSIONS) {
      expect(runtime.builtInExtension(entry.key).defaultEnabled).toBe(entry.defaultEnabled);
    }
  });

  it('falls back to each entry the same way the runtime half does', () => {
    for (const entry of BUILT_IN_EXTENSIONS) {
      const runtimeEntry = runtime.builtInExtension(entry.key);
      for (const toggles of [undefined, {}, {[entry.key]: true}, {[entry.key]: false}]) {
        expect(builtInExtensionEnabled(toggles, entry))
            .toBe(runtime.builtInEnabled(toggles, runtimeEntry));
      }
    }
  });

  it('ships Captcha Plugin off, since enabling it costs a download', () => {
    const captcha = BUILT_IN_EXTENSIONS.find((entry) => entry.key === 'captcha_plugin');
    expect(captcha?.defaultEnabled).toBe(false);
    expect(captcha?.downloadsOnEnable).toBe(true);
    expect(builtInExtensionEnabled(undefined, captcha!)).toBe(false);
  });
});
