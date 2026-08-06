import {describe, expect, it} from 'vitest';
import {liveSetName, resolveLiveSetAction} from './cookieSync';
import type {ArgusCookie, ArgusProfile} from '../types';

const set = (over: Partial<ArgusCookie>): ArgusCookie => ({
  id: 's1', name: 'cookies.txt', url: 'https://x/y.json', count: 1,
  folder_id: null, tags: [], updated_at: '', deleted_at: null, ...over,
});
const profile = (over: Partial<ArgusProfile>): ArgusProfile => ({
  id: 'p1', name: 'Amazon US', cookie_mode: 'saved', cookie_id: 's1', ...over,
} as ArgusProfile & typeof over);

describe('resolveLiveSetAction', () => {
  it('updates the assigned set when it is this profile\'s live set', () => {
    const live = set({name: 'Amazon US (live)'});
    expect(resolveLiveSetAction(profile({}), [live])).toEqual({kind: 'update', set: live});
  });

  it('accepts the .json spelling addCookieSet produces', () => {
    const live = set({name: 'Amazon US (live).json'});
    expect(resolveLiveSetAction(profile({}), [live])).toEqual({kind: 'update', set: live});
  });

  it('creates when the assigned set is an ordinary library set', () => {
    expect(resolveLiveSetAction(profile({}), [set({name: 'scraped.txt'})]))
        .toEqual({kind: 'create', name: 'Amazon US (live)'});
  });

  it('creates when nothing is assigned', () => {
    expect(resolveLiveSetAction(profile({cookie_mode: 'paste', cookie_id: null}), []))
        .toEqual({kind: 'create', name: 'Amazon US (live)'});
  });

  it('creates when the assigned set is trashed', () => {
    expect(resolveLiveSetAction(profile({}), [set({name: 'Amazon US (live)', deleted_at: 'now'})]))
        .toEqual({kind: 'create', name: 'Amazon US (live)'});
  });

  it('creates a fresh set after a profile rename', () => {
    expect(resolveLiveSetAction(profile({name: 'Amazon DE'}), [set({name: 'Amazon US (live)'})]))
        .toEqual({kind: 'create', name: 'Amazon DE (live)'});
  });

  // The forbidden case: a same-named set exists in the library but is NOT
  // what this profile is assigned (s1, someone else's live set). Matching by
  // name alone -- instead of by cookie_id first -- would return {kind:
  // 'update', set: s1} here, which is profile A's push landing on profile
  // B's (or a stray same-named) set.
  it('never matches a same-named set that is not this profile\'s own assignment', () => {
    expect(resolveLiveSetAction(
        profile({cookie_id: 's2'}),
        [set({id: 's1', name: 'Amazon US (live)'}), set({id: 's2', name: 'curated.json'})],
    )).toEqual({kind: 'create', name: 'Amazon US (live)'});
  });

  // The real-world version of "not assigned": a profile left in 'paste' mode
  // still carries a stale cookie_id from before the switch. Mode, not the
  // presence of an id, is what decides whether that id means anything.
  it('ignores a stale cookie_id when the profile is in paste mode', () => {
    expect(resolveLiveSetAction(
        profile({cookie_mode: 'paste'}), [set({name: 'Amazon US (live)'})],
    )).toEqual({kind: 'create', name: 'Amazon US (live)'});
  });
});

describe('liveSetName', () => {
  it('is the exact convention the bridge and the tab share', () => {
    expect(liveSetName('P')).toBe('P (live)');
  });
});
