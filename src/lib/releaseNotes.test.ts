// Turning the GitHub release list into the two histories the changelog shows.
//
// Both programs publish to the same repo -- the launcher as `v*`, the browser
// as `browser-v*` -- so the split has to be exact. A browser build appearing
// under "Launcher" would tell someone their launcher jumped to version 151.
import {describe, expect, it} from 'vitest';
import {partitionReleases, versionFromTag}
// @ts-expect-error CJS module without types
  from '../../electron/releases.cjs';

function release(tag: string, extra: Record<string, unknown> = {}) {
  return {tag_name: tag, published_at: '2026-08-08T15:00:00Z', body: 'Notes.', ...extra};
}

describe('versionFromTag', () => {
  it('reads a launcher version', () => {
    expect(versionFromTag('v1.0.58')).toBe('1.0.58');
  });

  it('strips the platform key off a browser tag', () => {
    // mac and Windows publish the same build under different tags. Keeping
    // the key would make one build look like two releases.
    expect(versionFromTag('browser-v151.0.7906.0-mac-arm64')).toBe('151.0.7906.0');
    expect(versionFromTag('browser-v151.0.7906.0-win-x64')).toBe('151.0.7906.0');
  });

  it('survives a tag it does not recognise', () => {
    expect(versionFromTag('nightly')).toBe('nightly');
    expect(versionFromTag(undefined)).toBe('');
  });
});

describe('partitionReleases', () => {
  it('sends each tag to its own program', () => {
    const {launcher, browser} = partitionReleases([
      release('v1.0.58'),
      release('browser-v151.0.7906.0-mac-arm64'),
      release('v1.0.57'),
    ]);
    expect(launcher.map((entry: {version: string}) => entry.version)).toEqual(['1.0.58', '1.0.57']);
    expect(browser.map((entry: {version: string}) => entry.version)).toEqual(['151.0.7906.0']);
  });

  it('lists one row per browser build, not one per platform', () => {
    const {browser} = partitionReleases([
      release('browser-v151.0.7906.0-mac-arm64'),
      release('browser-v151.0.7906.0-win-x64'),
      release('browser-v150.0.7100.0-mac-arm64'),
    ]);
    expect(browser.map((entry: {version: string}) => entry.version))
        .toEqual(['151.0.7906.0', '150.0.7100.0']);
  });

  it('keeps an empty body empty rather than inventing text', () => {
    // Every release published before body_path was wired into the workflow
    // has one. The UI shows version and date for those.
    const {launcher} = partitionReleases([release('v1.0.57', {body: null})]);
    expect(launcher[0].notes).toBe('');
    expect(launcher[0].publishedAt).toBe('2026-08-08T15:00:00Z');
  });

  it('ignores drafts and anything that is not a release tag', () => {
    const {launcher, browser} = partitionReleases([
      release('v1.0.59', {draft: true}),
      release('some-branch-build'),
      release('v1.0.58'),
      null,
    ]);
    expect(launcher.map((entry: {version: string}) => entry.version)).toEqual(['1.0.58']);
    expect(browser).toEqual([]);
  });

  it('survives a response that is not a list', () => {
    // A rate-limit reply is a JSON object, not an array.
    expect(partitionReleases({message: 'API rate limit exceeded'}))
        .toEqual({launcher: [], browser: []});
  });
});
