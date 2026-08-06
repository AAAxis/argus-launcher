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
});

describe('liveSetName', () => {
  it('is the exact convention the bridge and the tab share', () => {
    expect(liveSetName('P')).toBe('P (live)');
  });
});
