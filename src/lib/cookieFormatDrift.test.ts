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
  JSON.stringify([{name: '', value: 'dropped'}, {value: 'no-name'}, {name: 'no-domain-no-url'},
    // Whitespace-only name: a dropped .trim() would let this one through.
    {name: '   ', value: 'whitespace-name-dropped'}]),
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
  // A raw `expires` key with NO expirationDate/expiration_date present.
  // parseNetscapeCookies always maps its expiry column to `expirationDate`
  // before calling normalizeCookie, so this is the only fixture that
  // actually exercises the literal `|| raw.expires` fallback arm -- drop it
  // from the port and every other fixture still passes.
  JSON.stringify([{name: 'exp', value: 'v', domain: 'exp.io', expires: 1899999999}]),
  // Millisecond expiry that does NOT divide evenly by 1000
  // (1899999999750 / 1000 = 1899999999.75). Math.floor -> 1899999999,
  // Math.round -> 1900000000, Math.trunc -> 1899999999 (same as floor here,
  // but floor vs round diverge, which is the mutation that matters).
  JSON.stringify([{name: 'ms3', value: 'v', domain: 'ms3.io', expirationDate: 1899999999750}]),
  // No domain and an unparseable url -- domain ends up undefined, so
  // toNetscapeCookies must fall back to hostnameOf(cookie.url), and
  // `new URL('not-a-valid-url')` throws, exercising hostnameOf's catch
  // branch (both sides must return the raw url unchanged).
  JSON.stringify([{name: 'badurl', value: 'v', url: 'not-a-valid-url'}]),
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

  // Reachable in practice: a raw expirationDate large enough to survive the
  // >0/isFinite guard and the ms-to-seconds coercion, but which still
  // overflows Date's +-8.64e15ms range once cookieExpiryLabel multiplies it
  // back out by 1000 -- e.g. a garbage numeric field in a hand-edited
  // cookie_sets.cookies row (cookieFile.ts's own comment calls this out) or
  // a scraped export with a corrupted expiry column. Both ports must fall
  // back to 'Session' rather than propagating the NaN.
  it('falls back to Session when a huge expirationDate overflows Date range', () => {
    const parsed = parseCookieContent(
        JSON.stringify([{name: 'huge', value: 'v', domain: 'huge.io', expirationDate: 1e21}]));
    expect(parsed[0].expirationDate).toBeGreaterThan(0);
    expect(format.cookieExpiryLabel(parsed[0])).toBe(cookieExpiryLabel(parsed[0]));
    expect(format.cookieExpiryLabel(parsed[0])).toBe('Session');
  });

  it('computes cookieDomains identically', () => {
    const parsed = parseCookieContent(JSON.stringify([
      {name: 'a', value: '1', domain: 'z.io'},
      {name: 'b', value: '2', domain: 'a.io'},
      {name: 'c', value: '3', domain: 'a.io'},
    ]));
    expect(format.cookieDomains(parsed)).toEqual(cookieDomains(parsed));
  });

  // Equal counts (one cookie per domain each) so the count comparator never
  // fires and only the a[0].localeCompare(b[0]) tie-break decides order.
  // Removing or reversing that tie-break leaves this the only assertion
  // that notices.
  it('breaks cookieDomains ties alphabetically', () => {
    const parsed = parseCookieContent(JSON.stringify([
      {name: 'a', value: '1', domain: 'zeta.io'},
      {name: 'b', value: '2', domain: 'alpha.io'},
      {name: 'c', value: '3', domain: 'mid.io'},
    ]));
    expect(format.cookieDomains(parsed)).toEqual(cookieDomains(parsed));
    expect(format.cookieDomains(parsed)).toEqual(['alpha.io', 'mid.io', 'zeta.io']);
  });
});

// jarSignature has no counterpart in cookieFile.ts -- it is new, ported
// straight from background.js's inline seedSignature -- so it sits outside
// the differential tests above by construction. This pins its exact output
// format directly: field order, tab/newline separators, and the empty-
// string defaults, because Task 6's change detection depends on this exact
// contract, not merely on "some string that changes when cookies change".
describe('jarSignature', () => {
  it('joins domain/path/name/value with tabs and cookies with newlines', () => {
    const cookies = [
      {domain: 'a.io', path: '/', name: 'sid', value: 'v1'},
      {domain: 'b.io', path: '/x', name: 'n2', value: 'v2'},
    ];
    expect(format.jarSignature(cookies)).toBe('a.io\t/\tsid\tv1\nb.io\t/x\tn2\tv2');
  });

  it('defaults a missing path to / and missing domain/name/value to empty strings', () => {
    expect(format.jarSignature([{}])).toBe('\t/\t\t');
  });

  it('changes when any field changes, including value alone', () => {
    const base = [{domain: 'a.io', path: '/', name: 'sid', value: 'v1'}];
    const changed = [{domain: 'a.io', path: '/', name: 'sid', value: 'v2'}];
    expect(format.jarSignature(base)).not.toBe(format.jarSignature(changed));
  });
});
