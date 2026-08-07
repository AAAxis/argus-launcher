import {describe, expect, it} from 'vitest';
import {fingerprintSwitches} from './fingerprint';
import type {ArgusProfile} from '../types';

function profile(fingerprint: ArgusProfile['fingerprint']): ArgusProfile {
  return {id: 'p1', name: 'Test', fingerprint} as ArgusProfile;
}

describe('fingerprintSwitches', () => {
  // The bug this guards, observed on a live browser: the profile was launched
  // with a literal `--lang=Auto from proxy`. The sentinel is a UI label meaning
  // "resolve this from the proxy's country", and main.cjs does resolve it -- but
  // only when no --lang is already present, so emitting the label here both fed
  // the browser a non-locale and suppressed the correct switch.
  it('does not emit --lang for the Auto from proxy sentinel', () => {
    expect(fingerprintSwitches(profile({language: 'Auto from proxy'}))).toBe('');
  });

  it('emits --lang for a real locale, keeping only the first', () => {
    expect(fingerprintSwitches(profile({language: 'en-US,en'}))).toBe('--lang=en-US');
  });

  // Chromium's --window-size parses "w,h"; the stored screen string is "WxH", so
  // passing it through verbatim meant the switch was silently ignored and the
  // window opened at the default size.
  it('converts the screen string to the comma form --window-size expects', () => {
    expect(fingerprintSwitches(profile({screen: '412x915'}))).toBe('--window-size=412,915');
  });

  it('accepts the × spelling the screen presets use', () => {
    expect(fingerprintSwitches(profile({screen: '1512 × 982'}))).toBe('--window-size=1512,982');
  });

  it('omits --window-size for Auto and for anything it cannot parse', () => {
    expect(fingerprintSwitches(profile({screen: 'Auto'}))).toBe('');
    expect(fingerprintSwitches(profile({screen: 'not a size'}))).toBe('');
  });

  it('passes an explicit user agent through', () => {
    expect(fingerprintSwitches(profile({user_agent: 'Mozilla/5.0 (X11; Linux x86_64)'})))
        .toBe('--user-agent=Mozilla/5.0 (X11; Linux x86_64)');
  });

  // The browser namespace is `argus`; this switch was spelled `argys` and no
  // C++ ever read it. Removed rather than corrected -- nothing consumes the OS
  // hint, which the fingerprint JSON already carries as `preset`.
  it('no longer emits the dead fingerprint-os switch', () => {
    expect(fingerprintSwitches(profile({os: 'Android'}))).toBe('');
  });

  it('is empty for a profile with no fingerprint', () => {
    expect(fingerprintSwitches({id: 'p1', name: 'Test'} as ArgusProfile)).toBe('');
  });
});
