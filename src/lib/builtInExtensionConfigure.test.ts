import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {describe, expect, it} from 'vitest';
// CJS interop: the same table main.cjs materializes extensions from.
// @ts-expect-error CJS module without types
import {builtInExtension} from '../../electron/built-in-extensions.cjs';

const deps = {parseCookieUrl: async () => [], parseCookieFile: () => []};
const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'argus-ext-'));

describe('cookie_manager configure', () => {
  it('writes argus-launch.json when the launch carries a run token', async () => {
    const dir = tempDir();
    await builtInExtension('cookie_manager')!.configure!(
        {id: 'p1', name: 'Profile One', startPage: {port: 39219, token: 'tok-abc'}}, dir, deps);
    const written = JSON.parse(fs.readFileSync(path.join(dir, 'argus-launch.json'), 'utf8'));
    expect(written).toEqual({token: 'tok-abc', apiPort: 39219});
  });

  it('writes no argus-launch.json when the launch has no token', async () => {
    const dir = tempDir();
    await builtInExtension('cookie_manager')!.configure!(
        {id: 'p1', name: 'Profile One', startPage: null}, dir, deps);
    expect(fs.existsSync(path.join(dir, 'argus-launch.json'))).toBe(false);
  });

  it('still writes profile-meta.json either way', async () => {
    const dir = tempDir();
    await builtInExtension('cookie_manager')!.configure!(
        {id: 'p1', name: 'Profile One'}, dir, deps);
    const meta = JSON.parse(fs.readFileSync(path.join(dir, 'profile-meta.json'), 'utf8'));
    expect(meta).toEqual({id: 'p1', name: 'Profile One'});
  });
});
