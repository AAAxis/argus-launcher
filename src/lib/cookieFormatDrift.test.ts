// The extension's cookie-format.js is a plain-JS port of this directory's
// cookieFile.ts (which is itself a port of main.cjs -- see its header). This
// test is the tripwire: identical inputs through both must produce identical
// output, or a set exported by one side stops importing on the other.
import {describe, expect, it} from 'vitest';
// @ts-expect-error plain-JS extension module without types
import format from '../../extensions/cookie-manager/cookie-format.js';
import {cookieDomains, cookieExpiryLabel, parseCookieContent, toCookieJson, toNetscapeCookies} from './cookieFile';

const FIXTURES = [
  JSON.stringify([{name: 'sid', value: 'a b', domain: '.example.com', path: '/', secure: true,
    httpOnly: true, sameSite: 'no_restriction', expirationDate: 1899999999}]),
  JSON.stringify({cookies: [{name: 'ms', value: 'v', domain: 'x.io', expiration_date: 1899999999000,
    http_only: 1, same_site: 'strict'}]}),
  '# Netscape HTTP Cookie File\n.example.com\tTRUE\t/\tTRUE\t1899999999\tsid\tva\tlue\n',
  JSON.stringify([{name: '', value: 'dropped'}, {value: 'no-name'}, {name: 'no-domain-no-url'}]),
  // Millisecond expiry that would slip through undetected if either side
  // dropped the >10000000000 coercion: seconds vs ms differ by 1000x, not
  // just formatting.
  JSON.stringify([{name: 'ms2', value: 'v', domain: 'y.io', expirationDate: 1899999999000}]),
  // No domain, only a url -- normalizeCookie must accept this and
  // normalizeCookieUrl must not run (url already present).
  JSON.stringify([{name: 'nodom', value: 'v', url: 'https://z.example/path'}]),
  // Session cookie: no expiry field at all. Catches drift in the
  // Number.isFinite/> 0 guard and in expirationDate omission on write.
  JSON.stringify([{name: 'sess', value: 'v', domain: 'w.io'}]),
  // Value containing a literal tab -- only survives a Netscape round trip if
  // both sides rejoin trailing split parts with the same separator.
  '# Netscape HTTP Cookie File\nw.io\tFALSE\t/\tFALSE\t0\ttabbed\tval\tue\twith\ttabs\n',
  // Non-ASCII value -- catches any accidental escaping/encoding difference
  // between JSON.stringify implementations or manual escaping.
  JSON.stringify([{name: 'intl', value: 'héllo wörld 日本語', domain: 'v.io'}]),
  // Already-expired date -- catches drift in the Expired-vs-date branch of
  // cookieExpiryLabel (exercised separately below, but also flows through
  // parse/write here).
  JSON.stringify([{name: 'old', value: 'v', domain: 'e.io', expirationDate: 1}]),
];

describe('cookie-format.js mirrors cookieFile.ts', () => {
  it('parses every fixture identically', () => {
    for (const fixture of FIXTURES) {
      expect(format.parseCookieContent(fixture)).toEqual(parseCookieContent(fixture));
    }
  });

  it('writes JSON and Netscape identically for every fixture', () => {
    for (const fixture of FIXTURES) {
      const parsed = parseCookieContent(fixture);
      expect(format.toCookieJson(parsed)).toBe(toCookieJson(parsed));
      expect(format.toNetscapeCookies(parsed)).toBe(toNetscapeCookies(parsed));
    }
  });

  it('omits domain from JSON output rather than emitting it as undefined', () => {
    const parsed = parseCookieContent(
        JSON.stringify([{name: 'nodom', value: 'v', url: 'https://z.example/path'}]));
    const theirs = JSON.parse(format.toCookieJson(parsed));
    const ours = JSON.parse(toCookieJson(parsed));
    expect(theirs).toEqual(ours);
    expect(Object.prototype.hasOwnProperty.call(theirs[0], 'domain')).toBe(false);
  });

  it('computes cookieExpiryLabel identically, including Session and Expired', () => {
    const parsed = parseCookieContent(JSON.stringify([
      {name: 'sess', value: 'v', domain: 'w.io'},
      {name: 'old', value: 'v', domain: 'e.io', expirationDate: 1},
      {name: 'future', value: 'v', domain: 'f.io', expirationDate: 1899999999},
    ]));
    for (const cookie of parsed) {
      expect(format.cookieExpiryLabel(cookie)).toBe(cookieExpiryLabel(cookie));
    }
  });

  it('computes cookieDomains identically', () => {
    const parsed = parseCookieContent(JSON.stringify([
      {name: 'a', value: '1', domain: 'z.io'},
      {name: 'b', value: '2', domain: 'a.io'},
      {name: 'c', value: '3', domain: 'a.io'},
    ]));
    expect(format.cookieDomains(parsed)).toEqual(cookieDomains(parsed));
  });
});
