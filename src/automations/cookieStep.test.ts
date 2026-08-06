// The saveCookies executor's two pure functions, tested against the real
// module the runner calls (electron/automation/steps.cjs, typed by its
// hand-written .d.cts) rather than a copy -- see notifyOnFinish.test.ts for
// the same pattern.
import {describe, expect, it} from 'vitest';
import {cdpCookieToEntry, filterCookiesByDomain} from '../../electron/automation/steps.cjs';

function cdpCookie(overrides: Partial<Parameters<typeof cdpCookieToEntry>[0]> = {}) {
  return {
    name: 'session',
    value: 'abc123',
    domain: 'example.com',
    path: '/',
    secure: true,
    httpOnly: true,
    sameSite: 'Lax' as const,
    expires: 1893456000,
    ...overrides,
  };
}

describe('cdpCookieToEntry', () => {
  it('passes through name, value, domain, path, secure, httpOnly', () => {
    const mapped = cdpCookieToEntry(cdpCookie());
    expect(mapped.name).toBe('session');
    expect(mapped.value).toBe('abc123');
    expect(mapped.domain).toBe('example.com');
    expect(mapped.path).toBe('/');
    expect(mapped.secure).toBe(true);
    expect(mapped.httpOnly).toBe(true);
  });

  it('omits expirationDate for a session cookie (expires: -1)', () => {
    const mapped = cdpCookieToEntry(cdpCookie({expires: -1}));
    expect(mapped).not.toHaveProperty('expirationDate');
  });

  it('omits expirationDate when expires is zero or negative', () => {
    expect(cdpCookieToEntry(cdpCookie({expires: 0}))).not.toHaveProperty('expirationDate');
    expect(cdpCookieToEntry(cdpCookie({expires: -100}))).not.toHaveProperty('expirationDate');
  });

  it('maps a positive expires (seconds) to expirationDate', () => {
    const mapped = cdpCookieToEntry(cdpCookie({expires: 1893456000}));
    expect(mapped.expirationDate).toBe(1893456000);
  });

  it('maps sameSite "None" to no_restriction', () => {
    expect(cdpCookieToEntry(cdpCookie({sameSite: 'None'})).sameSite).toBe('no_restriction');
  });

  it('maps sameSite "Strict" and "Lax" to lowercase', () => {
    expect(cdpCookieToEntry(cdpCookie({sameSite: 'Strict'})).sameSite).toBe('strict');
    expect(cdpCookieToEntry(cdpCookie({sameSite: 'Lax'})).sameSite).toBe('lax');
  });

  it('omits sameSite entirely when CDP omits it, rather than defaulting it', () => {
    const {sameSite, ...rest} = cdpCookie();
    void sameSite;
    const mapped = cdpCookieToEntry(rest as Parameters<typeof cdpCookieToEntry>[0]);
    expect(mapped).not.toHaveProperty('sameSite');
  });
});

describe('filterCookiesByDomain', () => {
  const cookies = [
    cdpCookie({name: 'a', domain: 'example.com'}),
    cdpCookie({name: 'b', domain: '.example.com'}),
    cdpCookie({name: 'c', domain: 'sub.example.com'}),
    cdpCookie({name: 'd', domain: 'notexample.com'}),
    cdpCookie({name: 'e', domain: 'other.org'}),
  ];

  it('keeps every cookie when the filter is empty', () => {
    expect(filterCookiesByDomain(cookies, '')).toHaveLength(5);
    expect(filterCookiesByDomain(cookies, undefined)).toHaveLength(5);
  });

  it('matches the exact domain, the leading-dot form, and subdomains', () => {
    const kept = filterCookiesByDomain(cookies, 'example.com').map((c) => c.name);
    expect(kept.sort()).toEqual(['a', 'b', 'c']);
  });

  it('does not match a domain that merely ends with the filter as a substring', () => {
    const kept = filterCookiesByDomain(cookies, 'example.com').map((c) => c.name);
    expect(kept).not.toContain('d');
  });
});
