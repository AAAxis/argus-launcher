import {describe, expect, it} from 'vitest';
import {parseProxyLink, proxyDedupeKey, proxyDedupeKeys} from './proxies';

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

  it('refuses nonsense', () => {
    expect(parseProxyLink('')).toBeNull();
    expect(parseProxyLink('unknown')).toBeNull();
    expect(parseProxyLink('not-a-proxy-at-all')).toBeNull();
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
