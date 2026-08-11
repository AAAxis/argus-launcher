// The one place that turns a profile's claimed screen into numbers.
//
// A profile says it has a 1920x1080 screen. Two different layers have to agree
// about what follows from that, and until this file existed neither asked the
// other:
//
//   - the launcher, which writes the browser window's saved bounds into the
//     profile's Preferences before launch;
//   - the browser, whose renderer spoofs window.screen.* from the same string.
//
// When they disagree the result is not a slightly-wrong number, it is an
// impossible one. A real user's browser window cannot be larger than the
// display it is on, and a page that sees `outerWidth 2560` next to
// `screen.width 1920` knows it is being lied to -- it needs no fingerprint
// database and no heuristics to know it. That combination was shipping.
//
// The C++ side is chrome/renderer/monti/monti_fingerprint_injector.cc. Keep
// OS_BAR in step with it; each file names the other.
'use strict';

// How much of the screen the OS keeps for itself, which is what makes
// screen.availHeight differ from screen.height on real hardware. Reporting them
// equal is its own tell: a Windows desktop with no taskbar is not a thing.
//
// Windows 10 and 11 both default to a 40px taskbar at 100% scaling; macOS
// reserves ~25px at the top for the menu bar (the Dock is not reserved -- it
// can be hidden, and on a real Mac availHeight commonly reflects only the menu
// bar). Linux desktops vary far too much to claim a number, so it claims none.
const OS_BAR = {
  windows: {top: 0, bottom: 40},
  macos: {top: 25, bottom: 0},
  linux: {top: 0, bottom: 0},
  android: {top: 0, bottom: 0},
  ios: {top: 0, bottom: 0},
};

// "1920x1080", "1512 × 982 · 30-bit", "1920X1080" -- the stored string has been
// written by three different code paths over time and the separator has never
// been stable. Returns null rather than a guess: a screen we cannot parse must
// not produce a window rectangle, because a wrong one is worse than none.
function parseScreen(screen) {
  if (!screen || typeof screen !== 'string' || screen === 'Auto') {
    return null;
  }
  const match = /^\s*(\d+)\s*[×xX]\s*(\d+)/.exec(screen);
  if (!match) {
    return null;
  }
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null;
  }
  return {width, height};
}

// The usable rectangle inside a claimed screen, in the shape Chromium's
// `browser.window_placement` pref wants.
function workArea(screen, preset) {
  const bar = OS_BAR[preset] || OS_BAR.windows;
  return {
    left: 0,
    top: bar.top,
    right: screen.width,
    bottom: screen.height - bar.bottom,
  };
}

// The saved window bounds to write before launch.
//
// Not maximized, and inset from the work area rather than filling it. Two
// reasons, both about looking ordinary: `maximized: true` makes outerHeight
// exactly availHeight on every profile, which is a sharper constant across a
// fleet than any single window size; and a real person's window is usually not
// pinned to the corner. The inset is derived from the screen rather than
// random, so one profile's window is stable across its own launches -- a window
// that moves every launch is its own signal.
//
// Returns null when the screen is unparseable or absurdly small, so the caller
// writes nothing and Chromium keeps its own behaviour.
function windowPlacement(screenString, preset) {
  const screen = parseScreen(screenString);
  if (!screen || screen.width < 480 || screen.height < 360) {
    return null;
  }
  const area = workArea(screen, preset);
  const areaWidth = area.right - area.left;
  const areaHeight = area.bottom - area.top;

  // Fill most of the work area, leaving a margin that scales with the screen.
  // Clamped so the result can never exceed the work area, which is the whole
  // point of the exercise.
  const margin = Math.max(0, Math.min(Math.round(areaWidth * 0.04), 80));
  const left = area.left + margin;
  const top = area.top + margin;
  const right = Math.min(area.right, area.right - margin);
  const bottom = Math.min(area.bottom, area.bottom - margin);

  return {
    left,
    top,
    right,
    bottom,
    maximized: false,
    work_area_left: area.left,
    work_area_top: area.top,
    work_area_right: area.right,
    work_area_bottom: area.bottom,
  };
}

module.exports = {OS_BAR, parseScreen, workArea, windowPlacement};
