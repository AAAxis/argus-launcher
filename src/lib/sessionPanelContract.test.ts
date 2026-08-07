// homeProxyStatus() composes the session verdict; three surfaces render it, and
// only one of them is TypeScript. The browser side panel
// (extensions/cookie-manager/sidepanel.js, renderProxyFields) is plain JS copied
// verbatim into a profile directory with no bundler and no type checker -- the
// same constraint cookie-format.js lives under -- so nothing at build time would
// notice this function growing a field shape that file does not draw.
//
// These are the tripwires for that. They assert the *contract*, not the copy:
// which keys a field may carry, which tones a note may ask for, and that a
// working status is exactly the four rows the panel's label column was sized
// for. Change any of them and change sidepanel.js in the same commit.
import {describe, expect, it} from 'vitest';
import {homeProxyStatus} from './homePage';
import type {ArgusProfile, ArgusProxy} from '../types';

const profile = (over: Partial<ArgusProfile> = {}) => ({
  id: 'p1',
  name: 'Profile One',
  proxy_mode: 'assigned',
  fingerprint: {os: 'Windows 11', screen: '1920x1200', timezone: 'America/Los_Angeles'},
  ...over,
} as ArgusProfile);

const proxy = (over: Partial<ArgusProxy> = {}) => ({
  id: 'x1',
  host: '1.2.3.4',
  port: 8080,
  checked_at: '2026-08-07T00:00:00.000Z',
  ping_ms: 131,
  egress_ip: '142.252.99.144',
  country: 'US',
  city: 'Los Angeles',
  region: 'California',
  timezone: 'America/Los_Angeles',
  ...over,
} as ArgusProxy);

// Exactly the keys sidepanel.js reads off a field. `mono` picks the monospace
// value column, `note` is the quiet trailing value, `noteTone` colours it.
const FIELD_KEYS = new Set(['label', 'value', 'mono', 'note', 'noteTone']);

describe('the field contract the side panel renders', () => {
  it('gives a working session four labelled rows', () => {
    const status = homeProxyStatus(profile(), proxy());
    expect(status.ok).toBe(true);
    expect(status.fields?.map((field) => field.label))
        .toEqual(['Exit', 'Location', 'Timezone', 'Device']);
  });

  it('carries no field key the panel does not draw', () => {
    const status = homeProxyStatus(profile(), proxy());
    for (const field of status.fields || []) {
      for (const key of Object.keys(field)) {
        expect(FIELD_KEYS.has(key), `unrendered field key "${key}"`).toBe(true);
      }
      // Every row must be renderable as text: the panel sets textContent per
      // cell and would print "[object Object]" for anything else.
      expect(typeof field.label).toBe('string');
      expect(typeof field.value).toBe('string');
    }
  });

  it('asks only for tones the panel has styling for', () => {
    // The mismatch case, which is the only one that reaches for --danger.
    const mismatched = homeProxyStatus(
        profile({fingerprint: {os: 'Windows 11', screen: '1920x1200', timezone: 'Europe/Berlin'}} as
          Partial<ArgusProfile>),
        proxy());
    const tones = [...(homeProxyStatus(profile(), proxy()).fields || []),
      ...(mismatched.fields || [])]
        .map((field) => field.noteTone)
        .filter(Boolean);
    expect(tones.length).toBeGreaterThan(0);
    for (const tone of tones) {
      expect(['ok', 'bad']).toContain(tone);
    }
  });

  // The panel hides the card's sentence when rows are present and shows it when
  // they are not (`.card.tone-ok #proxy-detail { display: none }`). That rule is
  // only correct because the two states are mutually exclusive here.
  it('pairs rows with ok and a lone sentence with a failure', () => {
    const working = homeProxyStatus(profile(), proxy());
    expect(working.ok).toBe(true);
    expect(working.fields?.length).toBeTruthy();

    const failing = homeProxyStatus(profile(), proxy({check_error: 'Connection refused'}));
    expect(failing.ok).toBe(false);
    expect(failing.fields).toBeUndefined();
    expect(failing.detail).toContain('Connection refused');
  });
});
