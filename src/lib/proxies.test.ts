import {describe, expect, it} from 'vitest';
import {
  formatProxyLink, namesProxyType, parseProxyLink, proxyDedupeKey, proxyDedupeKeys,
  splitPastedConnection,
} from './proxies';

describe('parseProxyLink', () => {
  // The shape this app's own profile export writes. The importer used to run it
  // through a stricter parser that required a trailing ":user:pass", so an
  // exported file could not be re-imported: every row reported a proxy it could
  // not read.
  it('reads a scheme + host + port with no credentials', () => {
    expect(parseProxyLink('socks5://204.252.87.159:47403')).toEqual({
      type: 'socks5',
      host: '204.252.87.159',
      port: 47403,
      username: undefined,
      password: undefined,
    });
  });

  it('reads http the same way', () => {
    expect(parseProxyLink('http://206.251.200.171:47450')?.type).toBe('http');
  });

  it('reads the five-part form the old parser required', () => {
    expect(parseProxyLink('socks5://198.51.100.10:1080:user:pass')).toEqual({
      type: 'socks5',
      host: '198.51.100.10',
      port: 1080,
      username: 'user',
      password: 'pass',
    });
  });

  it('reads the empty-credential form', () => {
    expect(parseProxyLink('http://203.0.113.44:8080::')).toMatchObject({
      host: '203.0.113.44',
      port: 8080,
      username: undefined,
      password: undefined,
    });
  });

  it('reads a bare host:port', () => {
    expect(parseProxyLink('203.0.113.20:8080')).toMatchObject({host: '203.0.113.20', port: 8080});
  });

  // The fix for a credential-less CSV is to add the credentials to the file and
  // import again, so both spellings of "same host, now with a login" have to
  // work on the exact rows a real export produced. These two are the same proxy
  // as the no-credentials case at the top of this block.
  it('reads userinfo added to an exported row', () => {
    expect(parseProxyLink('socks5://user:pass@204.252.87.159:47403')).toEqual({
      type: 'socks5',
      host: '204.252.87.159',
      port: 47403,
      username: 'user',
      password: 'pass',
    });
  });

  it('reads credentials appended to an exported row', () => {
    expect(parseProxyLink('http://206.251.200.171:47450:user:pass')).toEqual({
      type: 'http',
      host: '206.251.200.171',
      port: 47450,
      username: 'user',
      password: 'pass',
    });
  });

  // Provider passwords are full of punctuation, and an @ in one is what used to
  // break the URL branch (see the comment in parseProxyLink). Worth pinning on
  // the userinfo form too, because that is the form this app now generates when
  // it applies credentials to a whole import.
  it('keeps a password containing @ and : intact', () => {
    expect(parseProxyLink('socks5://user:p@ss:word@204.252.84.109:46533')).toMatchObject({
      host: '204.252.84.109',
      port: 46533,
      username: 'user',
      password: 'p@ss:word',
    });
  });

  // The separator is not load-bearing -- the field ORDER is. This parser split
  // on ':' alone until a proxy list saved as .csv reported every line
  // unreadable, header included.
  it('reads the same fields whichever separator divides them', () => {
    for (const separator of [':', ',', ';', '\t', '|']) {
      expect(parseProxyLink(['198.51.100.10', '1080', 'user', 'pass'].join(separator))).toEqual({
        type: 'socks5',
        host: '198.51.100.10',
        port: 1080,
        username: 'user',
        password: 'pass',
      });
    }
  });

  it('reads a scheme named as the first field of a delimited line', () => {
    expect(parseProxyLink('http,198.51.100.10,1080')).toMatchObject({
      type: 'http', host: '198.51.100.10', port: 1080,
    });
  });

  // Neither single separator reads this, so it falls to the mixed split.
  it('reads a line that mixes separators', () => {
    expect(parseProxyLink('198.51.100.10:1080,user,pass')).toMatchObject({
      host: '198.51.100.10', port: 1080, username: 'user', password: 'pass',
    });
  });

  it('reads the reversed order with a comma too', () => {
    expect(parseProxyLink('user,pass,198.51.100.10,1080')).toMatchObject({
      host: '198.51.100.10', port: 1080, username: 'user', password: 'pass',
    });
  });

  // The @-form in both directions. Only the first is a URL; the second parses
  // as one and comes out with a hostname of "user", which is why the endpoint
  // is decided by which side actually has a port.
  it('reads user:pass@host:port', () => {
    expect(parseProxyLink('user:pass@198.51.100.10:1080')).toMatchObject({
      host: '198.51.100.10', port: 1080, username: 'user', password: 'pass',
    });
  });

  it('reads host:port@user:pass', () => {
    expect(parseProxyLink('198.51.100.10:1080@user:pass')).toMatchObject({
      host: '198.51.100.10', port: 1080, username: 'user', password: 'pass',
    });
  });

  it('keeps the scheme when an @-form names one', () => {
    expect(parseProxyLink('http:198.51.100.10:1080@user:pass')?.type).toBe('http');
  });

  it('refuses nonsense', () => {
    expect(parseProxyLink('')).toBeNull();
    expect(parseProxyLink('unknown')).toBeNull();
    expect(parseProxyLink('not-a-proxy-at-all')).toBeNull();
  });

  // The space is deliberately not a separator: with it, a sentence pasted into a
  // password field parses as a proxy.
  it('does not read a sentence as a proxy', () => {
    expect(parseProxyLink('not a proxy, really')).toBeNull();
  });
});

describe('namesProxyType', () => {
  it('sees a scheme however it is written', () => {
    expect(namesProxyType('socks5://h:1')).toBe(true);
    expect(namesProxyType('socks5:h:1')).toBe(true);
    expect(namesProxyType('http,h,1')).toBe(true);
  });

  it('sees none in a bare line', () => {
    expect(namesProxyType('198.51.100.10,1080')).toBe(false);
  });
});

describe('proxyDedupeKeys', () => {
  // A proxy saved before `type` was a field has none. Keying it as 'http' -- the
  // old fallback -- meant a socks5 row for the same host/port never matched and
  // imported a duplicate.
  it('indexes an untyped proxy under both types', () => {
    expect(proxyDedupeKeys({type: undefined, host: 'h', port: 1, username: ''})).toEqual([
      proxyDedupeKey('http', 'h', 1, ''),
      proxyDedupeKey('socks5', 'h', 1, ''),
    ]);
  });

  it('indexes a typed proxy under its own type only', () => {
    expect(proxyDedupeKeys({type: 'socks5', host: 'h', port: 1, username: 'u'}))
        .toEqual([proxyDedupeKey('socks5', 'h', 1, 'u')]);
  });

  it('ignores case', () => {
    expect(proxyDedupeKey('SOCKS5', 'Host.COM', 1, 'User'))
        .toBe(proxyDedupeKey('socks5', 'host.com', 1, 'user'));
  });
});

describe('splitPastedConnection', () => {
  it('splits a vendor line into every field', () => {
    expect(splitPastedConnection('206.251.200.171:47450:user:pass')).toEqual({
      type: 'socks5',
      host: '206.251.200.171',
      port: 47450,
      username: 'user',
      password: 'pass',
      explicitType: false,
    });
  });

  // The guard that stops a password being eaten as a connection string. Both of
  // these parse perfectly well; only one of them was meant as a proxy.
  it('refuses a credential-shaped value when strict', () => {
    expect(splitPastedConnection('hunter2:1080', {strict: true})).toBeNull();
  });

  it('accepts the same value when not strict', () => {
    expect(splitPastedConnection('hunter2:1080')?.host).toBe('hunter2');
  });

  it('accepts a scheme-prefixed line when strict, whatever the host looks like', () => {
    expect(splitPastedConnection('socks5://hunter2:1080', {strict: true})?.port).toBe(1080);
  });

  it('accepts a dotted host when strict', () => {
    expect(splitPastedConnection('198.51.100.10:1080', {strict: true})?.host)
        .toBe('198.51.100.10');
  });

  // Nothing to split, and parseProxyLink would read a bare word as a hostname --
  // which is not what a paste into Username meant.
  it('ignores a value with no colon', () => {
    expect(splitPastedConnection('justausername')).toBeNull();
  });

  it('ignores a value that is not a proxy at all', () => {
    expect(splitPastedConnection('not a proxy: really')).toBeNull();
  });

  // explicitType is what stops a bare line's socks5 default overwriting a type
  // the user already picked.
  it('reports an explicit type for a scheme, with or without slashes', () => {
    expect(splitPastedConnection('http://198.51.100.10:1080')?.explicitType).toBe(true);
    expect(splitPastedConnection('socks5:198.51.100.10:1080')?.explicitType).toBe(true);
  });

  it('reports no explicit type for a bare line', () => {
    expect(splitPastedConnection('198.51.100.10:1080:user:pass')?.explicitType).toBe(false);
  });
});

describe('formatProxyLink', () => {
  it('omits the userinfo when there are no credentials', () => {
    expect(formatProxyLink({type: 'socks5', host: '198.51.100.10', port: 1080}))
        .toBe('socks5://198.51.100.10:1080');
  });

  it('defaults an untyped proxy to socks5', () => {
    expect(formatProxyLink({type: undefined, host: 'h', port: 1})).toBe('socks5://h:1');
  });

  // Provider passwords are full of the characters that would otherwise re-parse
  // as structure: an @ splits userinfo from host, a : splits user from password.
  it('round-trips a password full of URL syntax', () => {
    const proxy = {
      type: 'http' as const,
      host: '198.51.100.10',
      port: 1080,
      username: 'user@corp',
      password: 'p@ss:word/1',
    };
    expect(parseProxyLink(formatProxyLink(proxy))).toEqual(proxy);
  });

  it('round-trips a username with no password', () => {
    expect(parseProxyLink(formatProxyLink({
      type: 'socks5', host: 'h.example.com', port: 1080, username: 'only', password: '',
    }))).toEqual({
      type: 'socks5', host: 'h.example.com', port: 1080, username: 'only', password: undefined,
    });
  });
});
