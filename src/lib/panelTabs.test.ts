// The panel's tab strip, from the two angles a test can reach without a DOM.
//
// vitest runs here with no environment (see vite.config.ts), so create() itself
// is out of reach -- it is a thin shell of attribute assignments over nextIndex,
// and the parts that need a real layout (sticky, 320px, scroll clamping) are
// what scripts/preview-panel.mjs is for. What is left is the arithmetic, and the
// markup contract the shell reads at startup.
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {describe, expect, it} from 'vitest';
// @ts-expect-error plain-JS extension module without types
import tabs from '../../extensions/cookie-manager/tabs.js';

const {nextIndex} = tabs;

describe('nextIndex', () => {
  it('moves right and wraps at the end', () => {
    expect(nextIndex('ArrowRight', 0, 3)).toBe(1);
    expect(nextIndex('ArrowRight', 1, 3)).toBe(2);
    expect(nextIndex('ArrowRight', 2, 3)).toBe(0);
  });

  // The one with a name. Without the `+ count` before the modulo this returns
  // -1, which the caller reads as "no move" -- so the strip stops going left at
  // the first tab and never wraps, silently and only for keyboard users.
  it('moves left and wraps at the start', () => {
    expect(nextIndex('ArrowLeft', 2, 3)).toBe(1);
    expect(nextIndex('ArrowLeft', 1, 3)).toBe(0);
    expect(nextIndex('ArrowLeft', 0, 3)).toBe(2);
  });

  it('jumps to the ends', () => {
    expect(nextIndex('Home', 2, 3)).toBe(0);
    expect(nextIndex('Home', 0, 3)).toBe(0);
    expect(nextIndex('End', 0, 3)).toBe(2);
    expect(nextIndex('End', 2, 3)).toBe(2);
  });

  // No launch hides a tab any more -- all three are always on screen, so three
  // is the count in practice. The two-tab case is kept because the caller still
  // passes the number ON SCREEN and setAvailable() still exists: a future tab
  // that comes and goes must wrap cleanly, with no dead stop where it used to be.
  it('wraps over two tabs, for a strip with one hidden', () => {
    expect(nextIndex('ArrowRight', 1, 2)).toBe(0);
    expect(nextIndex('ArrowLeft', 0, 2)).toBe(1);
    expect(nextIndex('End', 0, 2)).toBe(1);
  });

  // -1 is what leaves these keys to the handlers that already own them: Escape
  // closes the export menu and the save-as form, Enter and Space activate the
  // focused tab through the click path, and Tab must leave the strip entirely.
  it('declines every other key', () => {
    for (const key of ['Escape', 'Enter', ' ', 'Tab', 'ArrowUp', 'ArrowDown', 'a']) {
      expect(nextIndex(key, 1, 3)).toBe(-1);
    }
  });

  // Guarded rather than arithmetic: `% 0` is NaN, and a NaN index reads as a
  // real move into an entry that does not exist.
  it('declines when there are no tabs on screen', () => {
    expect(nextIndex('ArrowRight', 0, 0)).toBe(-1);
    expect(nextIndex('Home', 0, 0)).toBe(-1);
  });
});

// A static read of the real markup, in the spirit of
// builtInExtensionConfigure.test.ts's "ships every script sidepanel.html loads"
// and verify-palette.mjs's deliberately dumb line scanning.
//
// This is the higher-value half. The mistake this refactor invites is an id
// renamed on one side of an ARIA pair -- the tab still looks right, the panel
// still looks right, and the strip controls nothing. Nothing else in the repo
// would notice.
describe('sidepanel.html tab markup', () => {
  const html = readFileSync(
      join(__dirname, '../../extensions/cookie-manager/sidepanel.html'), 'utf8');

  // Each opening tag as its own string, so an attribute can be attributed to the
  // element that carries it. Good enough for markup this file also owns.
  const tags = html.match(/<[a-z][^>]*>/g) || [];
  const attr = (tag: string, name: string) => {
    const found = tag.match(new RegExp(`${name}="([^"]*)"`));
    return found ? found[1] : null;
  };
  const ids = new Set(tags.map((tag) => attr(tag, 'id')).filter(Boolean));
  const tabTags = tags.filter((tag) => attr(tag, 'role') === 'tab');
  const panelTags = tags.filter((tag) => attr(tag, 'role') === 'tabpanel');

  it('has three tabs and three panels', () => {
    expect(tabTags).toHaveLength(3);
    expect(panelTags).toHaveLength(3);
  });

  it('pairs every tab with its panel, in both directions', () => {
    for (const tab of tabTags) {
      const tabId = attr(tab, 'id');
      const controls = attr(tab, 'aria-controls');
      expect(ids.has(controls)).toBe(true);
      const panel = panelTags.find((candidate) => attr(candidate, 'id') === controls);
      expect(panel, `no panel with id="${controls}"`).toBeTruthy();
      // Symmetric: the panel must point back at this same tab, or the strip and
      // the accessible names describe two different pairings.
      expect(attr(panel as string, 'aria-labelledby')).toBe(tabId);
      expect(ids.has(tabId)).toBe(true);
    }
  });

  // Design decision, pinned in the markup: the panel opens on Cookies, before
  // any script runs.
  it('opens on Cookies, and only Cookies', () => {
    const selected = tabTags.filter((tag) => attr(tag, 'aria-selected') === 'true');
    expect(selected).toHaveLength(1);
    expect(attr(selected[0], 'id')).toBe('tab-cookies');
  });

  // Roving tabindex: the strip is one stop in the tab order, not three.
  it('gives exactly one tab a tab stop, the selected one', () => {
    const stops = tabTags.filter((tag) => attr(tag, 'tabindex') === '0');
    expect(stops).toHaveLength(1);
    expect(attr(stops[0], 'aria-selected')).toBe('true');
    for (const tag of tabTags) {
      if (attr(tag, 'aria-selected') !== 'true') expect(attr(tag, 'tabindex')).toBe('-1');
    }
  });

  // data-tab is the controller's only key. A typo there produces a tab that
  // silently does nothing when clicked, with no error anywhere.
  it('gives every tab a data-tab and a label element', () => {
    for (const tag of tabTags) {
      expect(attr(tag, 'data-tab')).toBeTruthy();
    }
    // The dot is a ::after flex item, so the label needs a real element to
    // ellipsis inside -- text-overflow cannot apply to an anonymous flex item.
    expect(html.match(/class="tab-label"/g)).toHaveLength(3);
  });

  it('starts every unselected panel hidden', () => {
    for (const panel of panelTags) {
      const labelledBy = attr(panel, 'aria-labelledby');
      const tab = tabTags.find((candidate) => attr(candidate, 'id') === labelledBy);
      const on = attr(tab as string, 'aria-selected') === 'true';
      expect(/\shidden(\s|>|=)/.test(panel), `${attr(panel, 'id')} hidden`).toBe(!on);
    }
  });

  // Design decision, and the one this refactor was for. Automations used to be
  // hidden here and revealed by renderAutomations only when the launch carried
  // some -- so a profile with nothing pinned had no way to discover the tab
  // existed, and a run started from the launcher had nowhere in this window to
  // report. The tab is now always on screen and says which case it is in.
  //
  // Asserted on the markup because that is where the regression would land:
  // putting `hidden` back is a one-word change that looks like tidying.
  it('hides no tab, so the strip cannot conceal a feature', () => {
    for (const tag of tabTags) {
      expect(/\shidden(\s|>|=)/.test(tag), `${attr(tag, 'id')} is hidden`).toBe(false);
    }
  });
});

// The Automations panel carries two independent surfaces, and the ids below are
// the whole contract between this markup and sidepanel.js's paintRunCard. A
// renamed id there is a card that silently never paints -- $() returns null, the
// assignment throws inside a poll nobody is watching, and the tab just looks
// empty.
describe('sidepanel.html run-progress markup', () => {
  const html = readFileSync(
      join(__dirname, '../../extensions/cookie-manager/sidepanel.html'), 'utf8');

  it('carries every id the run card is painted through', () => {
    for (const id of [
      'run-card', 'run-icon', 'run-title', 'run-step',
      'run-bar', 'run-bar-fill', 'run-meta', 'run-stop',
      'automation-list', 'automations-empty', 'open-automations',
    ]) {
      expect(html.includes(`id="${id}"`), `#${id} is missing`).toBe(true);
    }
  });

  // Both start hidden: the card until a poll finds a run, the empty state until
  // the launch snapshot says there is nothing to list. Neither is the panel's
  // opening state, and shipping either visible means every launch flashes it.
  it('starts the run card and the empty state hidden', () => {
    for (const id of ['run-card', 'automations-empty']) {
      const tag = (html.match(new RegExp(`<[a-z][^>]*id="${id}"[^>]*>`)) || [''])[0];
      expect(/\shidden(\s|>|=)/.test(tag), `#${id} should start hidden`).toBe(true);
    }
  });

  // The bar is an ARIA progressbar rather than a <progress>, because an
  // indeterminate run has no value to report and aria-valuenow is removed
  // outright in that state. min and max have to be on the markup for the
  // script's valuenow to mean anything.
  it('declares the bar as a bounded progressbar', () => {
    const tag = (html.match(/<[a-z][^>]*id="run-bar"[^>]*>/) || [''])[0];
    expect(tag).toContain('role="progressbar"');
    expect(tag).toContain('aria-valuemin="0"');
    expect(tag).toContain('aria-valuemax="100"');
  });
});
