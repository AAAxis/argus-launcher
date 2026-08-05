import {describe, expect, it} from 'vitest';
import {
  STALE_AFTER_MS, isRunnable, needsCheck, proxiesToCheck, runReadiness,
} from './runReadiness';
import type {ArgusProfile, ArgusProxy} from '../types';

const NOW = Date.parse('2026-08-05T12:00:00.000Z');

function proxy(overrides: Partial<ArgusProxy> = {}): ArgusProxy {
  return {
    id: 'proxy-1',
    name: 'Gateway',
    host: '204.252.87.159',
    port: 47403,
    ...overrides,
  };
}

function profile(overrides: Partial<ArgusProfile> = {}): ArgusProfile {
  return {
    id: 'profile-1',
    name: 'Main US',
    proxy_id: 'proxy-1',
    ...overrides,
  } as ArgusProfile;
}

describe('runReadiness', () => {
  it('needs no proxy in direct mode', () => {
    expect(runReadiness(profile({proxy_mode: 'direct'}), [], NOW))
        .toEqual({kind: 'direct'});
  });

  it('leaves free-proxy mode to the extension', () => {
    expect(runReadiness(profile({proxy_mode: 'free_proxy'}), [], NOW))
        .toEqual({kind: 'free_proxy'});
  });

  // proxy_mode was added after profiles already existed. Reading undefined as
  // anything but 'assigned' would let a legacy profile launch with no proxy at
  // all, which is the identity leak the whole product exists to prevent.
  it('treats a missing proxy_mode as assigned', () => {
    expect(runReadiness(profile({proxy_mode: undefined}), [], NOW))
        .toEqual({kind: 'missing'});
  });

  it('reports a dangling proxy_id as missing', () => {
    expect(runReadiness(profile({proxy_id: 'gone'}), [proxy()], NOW))
        .toEqual({kind: 'missing'});
  });

  // Resolution goes through matchedProxyForProfile, the same helper the launch
  // gate uses. Its name fallback is what keeps an imported profile whose
  // proxy_id never matched working, and the dialog has to see the row the
  // launch will actually use -- not "missing" for a profile that launches fine.
  it('falls back to a proxy named after the profile', () => {
    const row = proxy({id: 'other', name: 'Main US proxy', checked_at: iso(NOW)});
    expect(runReadiness(profile({proxy_id: 'gone'}), [row], NOW))
        .toEqual({kind: 'ok', proxy: row});
  });

  it('reports a proxy row with no host as missing', () => {
    expect(runReadiness(profile(), [proxy({host: ''})], NOW))
        .toEqual({kind: 'missing'});
  });

  it('reports a stored failure, carrying its message', () => {
    const row = proxy({check_error: 'curl: (7) Failed to connect', checked_at: iso(NOW)});
    expect(runReadiness(profile(), [row], NOW)).toEqual({
      kind: 'failed', proxy: row, error: 'curl: (7) Failed to connect',
    });
  });

  // check_error wins over checked_at: a failed check writes both columns, and
  // reading the timestamp first would report a freshly-failed proxy as 'ok'.
  it('prefers the failure over a fresh timestamp', () => {
    const row = proxy({check_error: 'timeout', checked_at: iso(NOW - 1000)});
    expect(runReadiness(profile(), [row], NOW).kind).toBe('failed');
  });

  it('reports a never-checked proxy as unchecked', () => {
    expect(runReadiness(profile(), [proxy()], NOW).kind).toBe('unchecked');
  });

  it('trusts a recent passing check', () => {
    const row = proxy({checked_at: iso(NOW - 60_000)});
    expect(runReadiness(profile(), [row], NOW)).toEqual({kind: 'ok', proxy: row});
  });

  it('distrusts a passing check older than the staleness window', () => {
    const row = proxy({checked_at: iso(NOW - STALE_AFTER_MS - 1)});
    expect(runReadiness(profile(), [row], NOW).kind).toBe('stale');
  });

  it('keeps a check made exactly at the window edge', () => {
    const row = proxy({checked_at: iso(NOW - STALE_AFTER_MS)});
    expect(runReadiness(profile(), [row], NOW).kind).toBe('ok');
  });

  // "We do not know when this passed" is stale, not ok -- the alternative is
  // trusting a timestamp we could not read.
  it('treats an unparseable timestamp as stale', () => {
    const row = proxy({checked_at: 'not a date'});
    expect(runReadiness(profile(), [row], NOW).kind).toBe('stale');
  });
});

describe('isRunnable', () => {
  it('blocks only the two states that cannot launch', () => {
    expect(isRunnable({kind: 'failed', proxy: proxy(), error: 'x'})).toBe(false);
    expect(isRunnable({kind: 'missing'})).toBe(false);
    expect(isRunnable({kind: 'direct'})).toBe(true);
    expect(isRunnable({kind: 'free_proxy'})).toBe(true);
    expect(isRunnable({kind: 'ok', proxy: proxy()})).toBe(true);
    expect(isRunnable({kind: 'stale', proxy: proxy()})).toBe(true);
    expect(isRunnable({kind: 'unchecked', proxy: proxy()})).toBe(true);
  });
});

describe('needsCheck', () => {
  it('re-checks the unknown and the previously broken, not the proven', () => {
    expect(needsCheck({kind: 'stale', proxy: proxy()})).toBe(true);
    expect(needsCheck({kind: 'unchecked', proxy: proxy()})).toBe(true);
    expect(needsCheck({kind: 'failed', proxy: proxy(), error: 'x'})).toBe(true);
    expect(needsCheck({kind: 'ok', proxy: proxy()})).toBe(false);
    expect(needsCheck({kind: 'direct'})).toBe(false);
    expect(needsCheck({kind: 'free_proxy'})).toBe(false);
    expect(needsCheck({kind: 'missing'})).toBe(false);
  });
});

describe('proxiesToCheck', () => {
  // The reason this function exists rather than a filter at the call site: a
  // folder of profiles sharing one gateway is one curl, not twenty, and the
  // five-wide pool would otherwise spend its whole width on the same host.
  it('checks a shared proxy once', () => {
    const shared = proxy({id: 'shared'});
    const list = [
      profile({id: 'a', proxy_id: 'shared'}),
      profile({id: 'b', proxy_id: 'shared'}),
      profile({id: 'c', proxy_id: 'shared'}),
    ];
    expect(proxiesToCheck(list, [shared], NOW)).toEqual([shared]);
  });

  it('skips fresh, direct and unassigned profiles', () => {
    const fresh = proxy({id: 'fresh', checked_at: iso(NOW - 1000)});
    const cold = proxy({id: 'cold'});
    const list = [
      profile({id: 'a', proxy_id: 'fresh'}),
      profile({id: 'b', proxy_mode: 'direct', proxy_id: undefined}),
      profile({id: 'c', proxy_id: 'gone'}),
      profile({id: 'd', proxy_id: 'cold'}),
    ];
    expect(proxiesToCheck(list, [fresh, cold], NOW)).toEqual([cold]);
  });

  it('returns nothing when there is nothing to learn', () => {
    const fresh = proxy({checked_at: iso(NOW)});
    expect(proxiesToCheck([profile()], [fresh], NOW)).toEqual([]);
  });
});

function iso(ms: number): string {
  return new Date(ms).toISOString();
}
