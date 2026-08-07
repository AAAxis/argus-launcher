// The main-process half of proxy geolocation. The renderer's own resolver is
// covered by proxyGeo.test.ts; this one decides what actually reaches the
// browser at launch, so it is the copy that matters most.
import {describe, expect, it} from 'vitest';
// @ts-expect-error CJS module without types
import {parseProxyGeo, resolveLanguage, resolveTimezone} from '../../electron/proxy-geo.cjs';

describe('parseProxyGeo', () => {
  // Each provider is a different dialect. Reading only one is how these fields
  // came to be silently discarded, which is the bug this whole change exists for.
  it('reads the ipapi.co shape', () => {
    expect(parseProxyGeo({
      timezone: 'America/Denver', city: 'Denver', region: 'Colorado',
      latitude: 39.7392, longitude: -104.9903,
    })).toEqual({
      timezone: 'America/Denver', city: 'Denver', region: 'Colorado',
      latitude: 39.7392, longitude: -104.9903,
    });
  });

  it('reads the ip-api.com shape, including lat/lon and regionName', () => {
    expect(parseProxyGeo({
      timezone: 'America/Chicago', city: 'Chicago', regionName: 'Illinois',
      lat: 41.8781, lon: -87.6298,
    })).toEqual({
      timezone: 'America/Chicago', city: 'Chicago', region: 'Illinois',
      latitude: 41.8781, longitude: -87.6298,
    });
  });

  it('splits ipinfo.io\'s combined loc string', () => {
    expect(parseProxyGeo({
      timezone: 'America/New_York', city: 'New York', region: 'New York',
      loc: '40.7128,-74.0060',
    })).toMatchObject({latitude: 40.7128, longitude: -74.006});
  });

  // The value goes into `export TZ=` in a generated shell script. A provider
  // returning nonsense must not get a vote.
  it('drops a timezone ICU does not recognise', () => {
    expect(parseProxyGeo({timezone: 'Not/AZone', city: 'Nowhere'}).timezone).toBeUndefined();
  });

  it('survives a response with no location at all', () => {
    expect(parseProxyGeo({})).toEqual({
      timezone: undefined, city: undefined, region: undefined,
      latitude: undefined, longitude: undefined,
    });
  });

  it('ignores unparseable coordinates rather than emitting NaN', () => {
    expect(parseProxyGeo({lat: 'n/a', lon: ''})).toMatchObject({
      latitude: undefined, longitude: undefined,
    });
  });
});

describe('resolveTimezone', () => {
  const denver = {country_code: 'US', timezone: 'America/Denver'};

  it('lets an explicit profile timezone win over everything', () => {
    expect(resolveTimezone('Asia/Tokyo', denver, null)).toBe('Asia/Tokyo');
  });

  it('treats the Auto sentinel as "not explicit"', () => {
    expect(resolveTimezone('Auto from proxy', denver, null)).toBe('America/Denver');
  });

  // The fix, stated plainly: a Denver proxy no longer reports Eastern time.
  it('prefers the proxy\'s measured zone over the country default', () => {
    expect(resolveTimezone(null, denver, null)).toBe('America/Denver');
    expect(resolveTimezone(null, {country_code: 'US'}, null)).toBe('America/New_York');
  });

  // The stored row can be stale or cleared outright by a credential edit, so a
  // zone measured seconds ago outranks it.
  it('prefers the live check over the stored columns', () => {
    expect(resolveTimezone(null, denver, {timezone: 'Europe/Berlin'})).toBe('Europe/Berlin');
  });

  it('falls back to the live country when neither side has a zone', () => {
    expect(resolveTimezone(null, {}, {countryCode: 'JP'})).toBe('Asia/Tokyo');
  });

  it('ignores a stored zone ICU cannot parse', () => {
    expect(resolveTimezone(null, {country_code: 'US', timezone: 'Not/AZone'}, null))
        .toBe('America/New_York');
  });

  // Null is what makes the launch path refuse rather than silently exporting no
  // TZ and leaking the host machine's zone.
  it('returns null when nothing knows where the proxy is', () => {
    expect(resolveTimezone(null, {}, null)).toBeNull();
    expect(resolveTimezone(null, {country_code: 'zz'}, null)).toBeNull();
  });
});

describe('resolveLanguage', () => {
  it('lets an explicit language win', () => {
    expect(resolveLanguage('de-DE', {country_code: 'US'}, null)).toBe('de-DE');
  });

  // Deliberately country-derived: language does not vary by city the way the
  // timezone does, so there is no per-IP tier to prefer here.
  it('derives from the country, preferring the live check', () => {
    expect(resolveLanguage('Auto from proxy', {country_code: 'US'}, null)).toBe('en-US');
    expect(resolveLanguage(null, {country_code: 'US'}, {countryCode: 'FR'})).toBe('fr-FR');
  });

  it('returns null for an unknown country', () => {
    expect(resolveLanguage(null, {country_code: 'zz'}, null)).toBeNull();
  });
});
