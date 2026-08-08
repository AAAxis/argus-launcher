// The window a profile opens must fit inside the screen it claims to have.
//
// This is the invariant a real browser cannot violate and a spoofed one
// trivially can: window.outerWidth is measured from an actual OS window, while
// screen.width is whatever the fingerprint says. A session reporting a
// 2560x1300 window on a 1920x1080 display was shipping, and a page needs no
// fingerprinting service to catch it -- one comparison does.
//
// Everything here is about that comparison holding for every preset and every
// screen string the editor can produce.
import {describe, expect, it} from 'vitest';
// @ts-expect-error CJS module without types
import {OS_BAR, parseScreen, windowPlacement, workArea} from '../../electron/screen-geometry.cjs';

const SCREENS = [
  '1920x1080', '1366x768', '1536x864', '1600x900', '1920x1200',
  '2560x1440', '2560x1600', '3440x1440', '3840x2160',
];
const PRESETS = ['windows', 'macos', 'linux'];

describe('parseScreen', () => {
  it('reads every separator the stored string has used', () => {
    // Three code paths have written this field over time and the separator has
    // never been stable; the "· 30-bit" suffix comes from the browser's own
    // Generate().
    expect(parseScreen('1920x1080')).toEqual({width: 1920, height: 1080});
    expect(parseScreen('1920X1080')).toEqual({width: 1920, height: 1080});
    expect(parseScreen('1512 × 982 · 30-bit')).toEqual({width: 1512, height: 982});
    expect(parseScreen('  1600 x 900  ')).toEqual({width: 1600, height: 900});
  });

  it('returns null rather than guessing', () => {
    // A wrong rectangle is worse than none: none leaves Chromium's own
    // behaviour in place, wrong ships the contradiction this file exists to
    // prevent.
    for (const bad of ['', 'Auto', 'unknown', '0x0', 'x1080', '-1920x1080', null, undefined]) {
      expect(parseScreen(bad as string), String(bad)).toBeNull();
    }
  });
});

describe('windowPlacement', () => {
  it('never produces a window larger than the screen it claims', () => {
    for (const screen of SCREENS) {
      for (const preset of PRESETS) {
        const placed = windowPlacement(screen, preset);
        const {width, height} = parseScreen(screen);
        expect(placed, `${screen}/${preset}`).not.toBeNull();
        expect(placed.right - placed.left, `${screen}/${preset} width`)
            .toBeLessThanOrEqual(width);
        expect(placed.bottom - placed.top, `${screen}/${preset} height`)
            .toBeLessThanOrEqual(height);
        expect(placed.left).toBeGreaterThanOrEqual(0);
        expect(placed.top).toBeGreaterThanOrEqual(0);
        expect(placed.right).toBeLessThanOrEqual(width);
        expect(placed.bottom).toBeLessThanOrEqual(height);
      }
    }
  });

  it('stays inside the work area, not just inside the screen', () => {
    // The stricter containment: a window overlapping where the taskbar is
    // supposed to be says the taskbar is not there.
    for (const screen of SCREENS) {
      for (const preset of PRESETS) {
        const placed = windowPlacement(screen, preset);
        expect(placed.left).toBeGreaterThanOrEqual(placed.work_area_left);
        expect(placed.top).toBeGreaterThanOrEqual(placed.work_area_top);
        expect(placed.right).toBeLessThanOrEqual(placed.work_area_right);
        expect(placed.bottom).toBeLessThanOrEqual(placed.work_area_bottom);
      }
    }
  });

  it('leaves the OS its bar, so availHeight differs from height', () => {
    // screen.availHeight === screen.height is its own tell -- a Windows desktop
    // with no taskbar is not a thing.
    const win = windowPlacement('1920x1080', 'windows');
    expect(win.work_area_bottom).toBe(1080 - OS_BAR.windows.bottom);
    expect(win.work_area_bottom).toBeLessThan(1080);

    const mac = windowPlacement('1512x982', 'macos');
    expect(mac.work_area_top).toBe(OS_BAR.macos.top);
    expect(mac.work_area_top).toBeGreaterThan(0);
  });

  it('is not maximized and not pinned to the corner', () => {
    // Maximized would make outerHeight exactly availHeight on every profile --
    // a sharper constant across a fleet than any one window size.
    const placed = windowPlacement('1920x1080', 'windows');
    expect(placed.maximized).toBe(false);
    expect(placed.left).toBeGreaterThan(0);
  });

  it('is stable across launches for one profile', () => {
    // A window that moves every launch is its own signal, so the inset is
    // derived from the screen rather than randomized.
    expect(windowPlacement('1920x1080', 'windows'))
        .toEqual(windowPlacement('1920x1080', 'windows'));
  });

  it('declines rather than guessing for unusable screens', () => {
    for (const bad of ['Auto', '', 'nonsense', '320x200']) {
      expect(windowPlacement(bad, 'windows'), bad).toBeNull();
    }
  });

  it('falls back to the Windows bar for an unknown preset', () => {
    // Unknown presets should not silently claim a full-bleed screen.
    expect(workArea({width: 1920, height: 1080}, 'plan9'))
        .toEqual(workArea({width: 1920, height: 1080}, 'windows'));
  });
});
