import {describe, expect, it} from 'vitest';
import {createRequire} from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_PROFILE_COLOR, PROFILE_COLORS, normalizeProfileColor, randomProfileColor,
} from './profileColors';

const require = createRequire(import.meta.url);
const profileIcons = require('../../electron/profile-icons.cjs');

describe('randomProfileColor', () => {
  it('only ever returns one of the six presets', () => {
    const keys = new Set(PROFILE_COLORS.map((color) => color.key));
    for (let i = 0; i < 200; i++) {
      expect(keys).toContain(randomProfileColor());
    }
  });

  // The whole point is that two profiles created in a row do not match. A
  // constant would satisfy the test above and nothing else.
  it('does not always return the same colour', () => {
    const seen = new Set(Array.from({length: 200}, () => randomProfileColor()));
    expect(seen.size).toBeGreaterThan(1);
  });

  // Every preset has to be reachable, or the palette is smaller than it looks.
  it('can return every preset', () => {
    const seen = new Set(Array.from({length: 2000}, () => randomProfileColor()));
    expect(seen.size).toBe(PROFILE_COLORS.length);
  });
});

describe('DEFAULT_PROFILE_COLOR', () => {
  // Read paths must not randomize: normalizeProfileColor is called on every
  // render of a stored value, and a random fallback would give one profile a
  // different colour each time anything asked for it.
  it('resolves an unreadable stored colour the same way every time', () => {
    const answers = new Set(Array.from({length: 50}, () => normalizeProfileColor('not-a-colour')));
    expect([...answers]).toEqual([DEFAULT_PROFILE_COLOR]);
  });

  it('leaves a real value alone', () => {
    expect(normalizeProfileColor('amber')).toBe('amber');
    expect(normalizeProfileColor('#ff8800')).toBe('#ff8800');
  });
});

// Before colours were random, a new profile was always blue, so a preset whose
// artwork was missing or misnamed would almost never be seen. Now any of the
// six can land on a fresh profile, and a gap would show up as a profile whose
// Dock tile silently falls back to blue.
describe('the icon palette', () => {
  it('covers every colour the picker offers', () => {
    expect([...profileIcons.PROFILE_ICON_KEYS].sort())
        .toEqual(PROFILE_COLORS.map((color) => color.key).sort());
  });

  it('has artwork built for every colour, in both themes', () => {
    const iconsDir = path.join(__dirname, '../../assets/icons');
    for (const {key} of PROFILE_COLORS) {
      for (const theme of ['light', 'dark']) {
        for (const extension of ['icns', 'png']) {
          const file = path.join(iconsDir, `profile-${key}-${theme}.${extension}`);
          expect(fs.existsSync(file), `missing ${path.basename(file)}`).toBe(true);
        }
      }
    }
  });
});
