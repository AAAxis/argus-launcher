// The saveCookies executor's two pure functions, tested against the real
// module the runner calls (electron/automation/steps.cjs, typed by its
// hand-written .d.cts) rather than a copy -- see notifyOnFinish.test.ts for
// the same pattern.
import {describe, expect, it} from 'vitest';
import {EXECUTORS, cdpCookieToEntry, filterCookiesByDomain} from '../../electron/automation/steps.cjs';

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

  // The exact spelling shown in the Cookies tab and every export file --
  // .example.com must work as a filter too, not just as a cookie's own domain.
  it('accepts a leading-dot filter (the spelling users actually see)', () => {
    const kept = filterCookiesByDomain(cookies, '.example.com').map((c) => c.name);
    expect(kept.sort()).toEqual(['a', 'b', 'c']);
  });

  // RFC 6265 cookie domains are case-insensitive; CDP happens to lowercase
  // them, but a hand-typed filter in the step editor is not guaranteed to be.
  it('matches case-insensitively', () => {
    const kept = filterCookiesByDomain(cookies, 'Example.COM').map((c) => c.name);
    expect(kept.sort()).toEqual(['a', 'b', 'c']);
  });
});

describe('EXECUTORS.saveCookies', () => {
  function fakeCdp(cookies: ReturnType<typeof cdpCookie>[]) {
    return {send: async () => ({cookies})};
  }
  function capturingLog() {
    const entries: {level: string; message: string}[] = [];
    return {log: (level: string, message: string) => entries.push({level, message}), entries};
  }

  // Catches the trap the reviewer flagged: pushing `filtered` (raw CDP shape)
  // instead of `mapped` (the normalizeCookie shape) would pass every other
  // test here, because the throw-on-missing-capability path never looks at
  // its argument -- only this test inspects what actually crosses into
  // saveCookies().
  it('pushes the MAPPED shape to saveCookies, not the raw CDP cookies', async () => {
    const {log} = capturingLog();
    let captured: unknown;
    const saveCookies = async (cookies: unknown) => {
      captured = cookies;
      return {saved: 1, set: 'Amazon (live)'};
    };
    await EXECUTORS.saveCookies({
      cdp: fakeCdp([cdpCookie({name: 'a', domain: 'example.com', sameSite: 'None'})]),
      step: {domain: ''},
      log,
      saveCookies,
    });
    expect(captured).toEqual([{
      name: 'a', value: 'abc123', domain: 'example.com', path: '/',
      secure: true, httpOnly: true, sameSite: 'no_restriction', expirationDate: 1893456000,
    }]);
  });

  // Catches logging mapped.length instead of the capability's own count:
  // two cookies are sent but the fake capability reports only one stored
  // (cookiesFromJsonValue can drop a row normalizeCookie rejects), and the
  // log line must say what was actually kept.
  it('logs what the capability reports as saved, not what was sent', async () => {
    const {log, entries} = capturingLog();
    const saveCookies = async () => ({saved: 1, set: 'Amazon (live)'});
    await EXECUTORS.saveCookies({
      cdp: fakeCdp([
        cdpCookie({name: 'a', domain: 'example.com'}),
        cdpCookie({name: 'b', domain: 'example.com'}),
      ]),
      step: {domain: ''},
      log,
      saveCookies,
    });
    expect(entries[0].message).toBe('Saved 1 cookies to the Launcher (Amazon (live))');
    expect(entries[0].level).toBe('info');
  });

  // The one place a mistyped filter is visible: mapped.length === 0 must warn,
  // not info, even though the step and the run both still end up `ok`.
  it('warns rather than infos when the domain filter matches nothing', async () => {
    const {log, entries} = capturingLog();
    const saveCookies = async () => ({saved: 0, set: 'Amazon (live)'});
    await EXECUTORS.saveCookies({
      cdp: fakeCdp([cdpCookie({domain: 'other.org'})]),
      step: {domain: 'example.com'},
      log,
      saveCookies,
    });
    expect(entries[0].level).toBe('warn');
    expect(entries[0].message).toContain('Saved 0 cookies');
  });
});
