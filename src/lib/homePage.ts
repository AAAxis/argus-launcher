// The local home page injected into every anonymous browser session: shared
// bookmarks, the automations pinned to start pages, and a panel saying whether
// the anti-detect proxy is actually working. Built as a string here because the
// browser renders it from a file the main process writes, not from this
// renderer.
//
// It paints with the launcher's own tokens (src/lib/palette.ts, checked against
// styles.css by scripts/verify-palette.mjs) and follows the launcher's theme, so
// a session opens looking like the app that opened it. It used to carry a warm
// paper palette of its own, from before the launcher went achromatic.
// The Argus mark that sits above the search box, imported ?raw rather than as a
// URL so it can be inlined. Same constraint as the four icon constants below:
// this document is written to disk and opened from file://, with no bundler, no
// asset directory beside it and no network it is allowed to need, so an
// <img src="assets/…"> resolves to nothing.
//
// src/assets/argus-mark.svg is the *embeddable* cut -- currentColor rather than
// the canonical file's fill="black", and a namespaced clipPath id. Both matter
// here and nowhere else: black line art is invisible on the dark theme, and
// this is the only place the artwork lands inside a document that has ids of
// its own (#search, #suggest). See src/assets/README.md before swapping it.
//
// It costs ~20 KB in every generated home.html. Worth paying: the file is
// rewritten on each launch and already carries the whole palette and two
// scripts, and a base64 data: URI of the same paths would be larger still.
import argusMark from '../assets/argus-mark.svg?raw';
import {bookmarkInitial, faviconCache, normalizeBookmarkUrl} from './bookmarks';
import {AUTO_FROM_PROXY} from './fingerprintPresets';
import {FONT_STACK, MONO_STACK, paletteCss} from './palette';
import {expectedTimezoneFor, proxyLocationLabel, timezoneMismatch} from './proxyGeo';
import {escapeHtml} from './text';
import type {SearchEngine} from './searchEngines';
import type {ThemePreference} from '../theme';
import type {ArgusProfile, ArgusProxy, SharedBookmark} from '../types';

// Where profile data lives, as the renderer states it: a bare relative path
// that the main process resolves against the app's userData directory (see
// resolveProfileUserDataDir in electron/main.cjs), which is the same default
// the argus:resolve-profile-root handler already falls back to.
//
// Deliberately relative on every platform. This used to return an absolute
// macOS path with a developer's own home directory baked into it, so every
// other Mac tried to launch profiles into /Users/<someone-else>/Library and
// died with EACCES before the browser ever started. The renderer cannot know
// the real home directory -- only the main process can -- so it must not try
// to name one.
//
// Split from profileDataDir so the General section of Settings can show exactly
// the root that launches use, rather than a second guess at it.
export function profilesRoot() {
  return 'ArgysProfiles';
}

export function profileDataDir(profileId: string) {
  return `${profilesRoot()}/${profileId}`;
}

// Never send the browser back to the launcher's own UI, a loopback address or
// a blank tab -- the session has to start on the injected home page or a real
// site, or it is not recognisably an anonymous profile.
export function browserStartUrl(profile: ArgusProfile) {
  const startUrl = profile.start_url?.trim();
  if (!startUrl ||
      startUrl === 'about:blank' ||
      startUrl.startsWith('chrome://') ||
      startUrl.includes('127.0.0.1') ||
      startUrl.includes('localhost') ||
      startUrl.includes('argus-launcher') ||
      startUrl.includes('/dist/index.html')) {
    return '';
  }
  return startUrl;
}

// One labelled row in the session panel. `note` is the quiet trailing value on
// the right of a row -- the exit's latency, or the timezone's verdict -- and
// `noteTone` colours it, since "matches exit" and "≠ America/Chicago" are the
// same slot carrying opposite news.
export type SessionField = {
  label: string;
  value: string;
  mono?: boolean;
  note?: string;
  noteTone?: 'ok' | 'bad';
};

// The one place the proxy panel's wording is decided. The re-check endpoint
// answers by re-running this against the fresh result rather than composing its
// own sentences, so the panel cannot say one thing at launch and a differently
// worded version of the same thing a click later.
//
// A failing state returns `detail` and no fields: there is one sentence to say
// and nothing to tabulate. A working one returns `fields`, because then there
// are four facts whose *agreement* is the whole point.
export function homeProxyStatus(profile: ArgusProfile, proxy: ArgusProxy | null): {
  ok: boolean;
  title: string;
  detail: string;
  fields?: SessionField[];
} {
  const mode = profile.proxy_mode || 'assigned';
  if (mode !== 'assigned') {
    return {
      ok: false,
      title: mode === 'free_proxy' ? 'Anti-detect needs verified proxy' : 'Anti-detect proxy missing',
      detail: mode === 'free_proxy' ?
        'Free proxy fallback is active, but no verified assigned proxy is available.' :
        'Direct connection is active. Assign a checked proxy before using this profile.',
    };
  }
  if (!proxy?.host || !proxy.port) {
    return {
      ok: false,
      title: 'Anti-detect proxy missing',
      detail: 'No valid proxy is assigned to this profile.',
    };
  }
  const proxyLabel = `${proxy.host}:${proxy.port}`;
  if (proxy.check_error) {
    return {
      ok: false,
      title: 'Anti-detect proxy failed',
      detail: `${proxyLabel} failed its last check: ${proxy.check_error}`,
    };
  }
  if (!proxy.checked_at) {
    return {
      ok: false,
      title: 'Anti-detect proxy unverified',
      detail: `${proxyLabel} has not passed a proxy check yet.`,
    };
  }
  const egressIp = proxy.egress_ip && proxy.egress_ip !== proxy.host ? proxy.egress_ip : '';
  // What a coherence check actually needs: where the traffic comes out, what
  // clock the profile claims, and what machine it claims to be. Those are the
  // pair-wise comparisons detection sites run -- timezone against IP location,
  // platform against user agent -- so the panel shows them as labelled rows a
  // person can compare, rather than the single dot-separated run of values this
  // replaces. That line was also clipped to one ellipsised row by the panel's
  // own CSS, so the last two facts were never actually visible.
  const latency = typeof proxy.ping_ms === 'number' ? `${proxy.ping_ms} ms` : '';
  const chosenTimezone = profile.fingerprint?.timezone;
  const effectiveTimezone =
    chosenTimezone && chosenTimezone !== AUTO_FROM_PROXY ?
      chosenTimezone :
      expectedTimezoneFor(proxy);
  const mismatch = timezoneMismatch(chosenTimezone, proxy);
  const machine = [profile.fingerprint?.os, profile.fingerprint?.screen]
      .filter(Boolean)
      .join(' · ');
  const fields: SessionField[] = [
    {label: 'Exit', value: egressIp || proxyLabel, mono: true, note: latency},
    {label: 'Location', value: proxyLocationLabel(proxy) || 'Unknown'},
    // The one row that carries a verdict rather than a value. Timezone against
    // IP location is the cheapest check any site can run and the one this
    // profile is most likely to fail, so the panel answers it outright instead
    // of printing two zones and leaving the comparison to the reader.
    {
      label: 'Timezone',
      value: effectiveTimezone || 'Not set',
      mono: true,
      note: mismatch ? `≠ ${mismatch.expected}` : (effectiveTimezone ? 'matches exit' : ''),
      noteTone: mismatch ? 'bad' : 'ok',
    },
    {label: 'Device', value: machine || 'Default'},
  ];
  return {
    ok: true,
    title: 'Anti-detect proxy active',
    // Kept as the one-line form for anything that reads a status without
    // rendering rows -- the panel itself renders `fields`.
    detail: [proxyLabel, proxyLocationLabel(proxy), latency].filter(Boolean).join(' · '),
    fields,
  };
}

// The field rows, as markup. Every value here comes from a proxy row or a
// profile's fingerprint -- both user-supplied -- so all four parts go through
// escapeHtml. Shared with the re-check path below, which rebuilds the same rows
// client-side from the same objects.
export function sessionFieldsHtml(fields: SessionField[] | undefined): string {
  return (fields || []).map((field) => {
    // No data-tone unless the field asked for one: a latency is a neutral
    // trailing value, and toning it would paint every session's ping green.
    const tone = field.noteTone ? ` data-tone="${field.noteTone}"` : '';
    const note = field.note ?
      `<span class="session-note"${tone}>${escapeHtml(field.note)}</span>` :
      '';
    return `<div class="session-field${field.mono ? ' mono' : ''}">` +
      `<dt>${escapeHtml(field.label)}</dt>` +
      `<dd><span class="v" title="${escapeHtml(field.value)}">${escapeHtml(field.value)}</span>${note}</dd>` +
      '</div>';
  }).join('');
}

// Whether this profile can be re-checked at all. Direct and free-proxy modes
// have no assigned proxy to re-test, so the button would be a control with
// nothing behind it -- see House Rule 6, no phantom data.
export function canRecheckProxy(profile: ArgusProfile, proxy: ArgusProxy | null) {
  return (profile.proxy_mode || 'assigned') === 'assigned' &&
    Boolean(proxy?.host) && Boolean(proxy?.port);
}

const SEARCH_ICON =
  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="7"></circle><path d="M20 20l-3.5-3.5"></path></svg>';

// Lucide's RotateCw, ExternalLink and Play, inlined. The document has no icon
// font and no network it should depend on, and all three are drawn with
// currentColor so each takes the colour of whatever state it sits in.
const RECHECK_ICON =
  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-2.64-6.36"></path><path d="M21 3v6h-6"></path></svg>';
const EXTERNAL_ICON =
  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4h6v6"></path><path d="M20 4l-9 9"></path><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"></path></svg>';
const RUN_ICON =
  '<svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M8 5.2v13.6l11.5-6.8z"></path></svg>';


export function anonymousHomeHtml(
    profile: ArgusProfile, bookmarks: SharedBookmark[], proxy: ArgusProxy | null,
    engine: SearchEngine,
    // The launcher's theme setting, not the resolved theme: 'system' has to
    // stay 'system' so prefers-color-scheme keeps deciding inside the browser,
    // which is a separate process on a machine whose appearance can change
    // while a session is open.
    theme: ThemePreference = 'system',
    // What this launch may run from its own start page. Comes from
    // buildLaunchPayload; empty (the default) means no tiles, which is what a
    // launch with nothing attached and nothing pinned gets.
    automations: Array<{id: string; name: string}> = [],
    // This launch's page credential and the port to spend it on. Null means the
    // page can neither run an automation nor re-check its proxy -- it is a
    // read-only document, exactly as it was before either existed.
    run: {port: number; token: string} | null = null) {
  const safeName = escapeHtml(profile.name || 'Profile');
  const proxyStatus = homeProxyStatus(profile, proxy);
  const recheckable = Boolean(run) && canRecheckProxy(profile, proxy);
  const bookmarkItems = bookmarks
      .map((bookmark) => {
        const url = normalizeBookmarkUrl(bookmark.url);
        if (!url) {
          return '';
        }
        const title = escapeHtml(bookmark.title || url);
        const safeUrl = escapeHtml(url);
        // Same resolution order as the launcher's bookmark tile: manual icon,
        // then whatever the favicon fetch already cached, then the monogram.
        const icon = bookmark.icon || faviconCache.get(url) || '';
        // The icon always sits in the same .mark box whether it holds a favicon
        // or a letter, so every tile is the same size regardless of which one
        // it got. The url is deliberately not printed under the title -- it is
        // in the title attribute for anyone who wants it, and a row of tiles
        // reads faster without it.
        const mark = icon ?
          `<span class="mark"><img class="favicon" alt="" src="${escapeHtml(icon)}"></span>` :
          `<span class="mark">${escapeHtml(bookmarkInitial(bookmark))}</span>`;
        return `<a class="bookmark" href="${safeUrl}" title="${safeUrl}">${mark}<strong>${title}</strong></a>`;
      })
      .join('');
  // Same .grid/.bookmark/.mark boxes the bookmarks use, so a tile is the same
  // size and shape as its neighbours -- these are buttons rather than links
  // because they post back instead of navigating. data-state drives the tint;
  // the id is an opaque handle the launcher already knows.
  const automationTiles = run ? automations
      .map((automation) => {
        const name = escapeHtml(automation.name || 'Automation');
        return `<button type="button" class="bookmark automation" data-id="${escapeHtml(automation.id)}" data-state="idle" title="Run ${name}"><span class="mark">${RUN_ICON}</span><strong>${name}</strong></button>`;
      })
      .join('') : '';
  return `<!doctype html>
<html data-theme="${escapeHtml(theme)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${safeName}</title>
<style>
${paletteCss()}
*{box-sizing:border-box}
/* The column is centred in the window rather than pinned near the top: this is
   a page you aim at, and 48px from the top of a 1000px window left it stranded
   in the upper third with the rest of the screen empty under it. min-height is
   a floor, not a height, so a long bookmark list grows the page and scrolls
   instead of being clipped at both ends the way flex centring would. */
body{margin:0;min-height:100vh;display:grid;align-content:center;justify-items:center;padding:64px 24px;background:var(--surface);color:var(--ink);font-family:${FONT_STACK};font-size:14px;-webkit-font-smoothing:antialiased}
/* 640px, the same cap the launcher's own Start page tab uses, so the two
   surfaces read as the same page. */
main{width:100%;max-width:640px}
h1{font-size:20px;letter-spacing:-0.01em;margin:0;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sub{margin:4px 0 0;color:var(--ink-soft);font-size:13px}
/* The Argus mark, over the profile name and the search box. The launcher's own
   Start page tab puts the same mark in the same place (.start-brand in
   styles.css) -- the two are one page in two places, and a session that opens
   on an anonymous window is the half that most needs to say who opened it.
   It inherits --ink through currentColor rather than naming a colour, so it
   inverts with the theme the way the four icons below it do.

   Centred over the column, matching .start-brand in styles.css. It reads as the
   page's own header rather than as the first item of the left-aligned list
   under it -- and it is the one element on this page that belongs to the window
   rather than to the profile, so it is the one that should not sit in the
   column's text rhythm. Keep the two surfaces in step: this mark and that one
   are the same mark in the same place, and moving one alone is what makes the
   pair read as two different screens. */
.brand{display:flex;justify-content:center;margin:0 0 14px;color:var(--ink)}
.brand svg{height:40px;width:auto;display:block}

/* ── Session panel ──────────────────────────────────────────────────────────
   Pinned to the top-right corner rather than sharing a row with the profile
   name. It is session status, not page content, and inside a 640px column a
   long name and a proxy line were fighting over one row -- which is what the
   old header's flex-wrap was papering over. Below 820px there is no corner to
   spare, so it drops back into the flow above the title. */
.session{position:fixed;top:16px;right:16px;z-index:10;display:grid;gap:10px;width:min(320px,calc(100vw - 32px));padding:12px 13px;border:1px solid var(--border);border-radius:var(--radius-lg);background:var(--raised);box-shadow:var(--shadow-xs)}
/* flex-start, not center: a failing state puts two or three lines of sentence
   in here, and centring pinned the dot and the actions against the middle of
   that block instead of against the title they belong to. The dot's offset is
   half the title's leading, so it sits on the first line's optical centre. */
.session-head{display:flex;align-items:flex-start;gap:9px;min-width:0}
.session-dot{flex:0 0 auto;width:9px;height:9px;margin-top:4px;border-radius:999px;background:var(--ink-faint)}
.session[data-state=ok] .session-dot{background:var(--success)}
.session[data-state=fail] .session-dot{background:var(--danger)}
/* A slow pulse rather than a spinner: the check is a curl round-trip that
   usually lands inside a second, and a spinner that appears and vanishes that
   fast reads as a flicker. */
.session[data-state=checking] .session-dot{background:var(--ink-soft);animation:pulse 1s var(--ease) infinite}
@keyframes pulse{50%{opacity:.25}}
.session-text{min-width:0;display:grid;gap:2px}
.session-text strong{font-size:13px;font-weight:700;line-height:1.2;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
/* Wraps, up to three lines. Every state except the working one puts a sentence
   here -- what failed, or what to assign instead -- and a sentence clipped to
   one line loses the half that says why. */
.session-text small{font-size:12px;line-height:1.35;color:var(--ink-soft);display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.session[data-state=fail] .session-text small{color:var(--danger)}
/* The working state has no sentence -- it has .session-fields instead. Hiding
   the summary rather than restyling it: this used to be where the whole working
   state lived, clipped to one ellipsised line, so the last facts on it were
   never actually readable. */
.session[data-state=ok] .session-text small{display:none}

/* The readout. A definition list because that is what it is: four labels, four
   values, read down the left edge and compared across. Labels are the app's
   own eyebrow (11/700/+0.06em upper, --ink-faint in styles.css); values sit at
   12px so a long city or zone still fits the 320px card without clipping. */
.session-fields:not([hidden]){display:grid;gap:7px;margin:0;padding-top:10px;border-top:1px solid var(--border-soft)}
.session-field{display:grid;grid-template-columns:64px minmax(0,1fr);align-items:baseline;gap:10px}
.session-field dt{font-size:10px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:var(--ink-faint);line-height:1.5}
.session-field dd{margin:0;min-width:0;display:flex;flex-wrap:wrap;align-items:baseline;justify-content:space-between;gap:2px 8px;font-size:12px;line-height:1.35;color:var(--ink)}
.session-field .v{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.session-field.mono .v{font-family:${MONO_STACK}}
/* The trailing note. Quiet by default (a latency), and the one place this panel
   raises its voice: a timezone that disagrees with the exit is the cheapest
   check a site can run against this session, so it is the only thing here
   allowed to be --danger. */
.session-note{flex:0 0 auto;font-size:11px;color:var(--ink-faint);white-space:nowrap}
.session-note[data-tone=ok]{color:var(--success)}
/* The mismatch takes its own line rather than sharing one with the value it
   contradicts. Inline, the two zone names competed for the same 200px and the
   value lost -- "America/N…" next to "≠ America/Los_Angeles" hides the very
   thing the reader is being asked to compare it against. */
.session-note[data-tone=bad]{flex:0 0 100%;color:var(--danger);font-weight:700;white-space:normal}
/* -4px pulls the 28px hit targets back level with the 15.6px title line they
   sit beside, without shrinking the targets themselves. */
.session-actions{flex:0 0 auto;display:flex;gap:2px;margin:-4px -4px 0 auto}
.session-actions button,.session-actions a{display:flex;align-items:center;justify-content:center;width:28px;height:28px;padding:0;border:0;border-radius:var(--radius-sm);background:transparent;color:var(--ink-soft);cursor:pointer;text-decoration:none}
.session-actions button:hover,.session-actions a:hover{background:var(--hover);color:var(--ink)}
.session-actions button:disabled{cursor:default;opacity:.45}
.session-actions button:disabled:hover{background:transparent;color:var(--ink-soft)}
@media (max-width:820px){
  .session{position:static;width:100%;margin-bottom:20px}
  body{padding-top:32px}
}

/* ── Search ─────────────────────────────────────────────────────────────────
   The suggestion list is positioned against .search-wrap, so it stays put while
   the input inside it grows or shrinks. */
.search-wrap{position:relative;margin-top:26px}
.search{display:flex;align-items:center;gap:8px;background:var(--raised);border:1px solid var(--border);border-radius:999px;padding:0 6px 0 16px;height:46px;box-shadow:var(--shadow-xs)}
.search:focus-within{border-color:var(--accent);box-shadow:var(--shadow-md)}
.search input{flex:1;min-width:0;border:0;outline:none;background:transparent;font:inherit;font-size:14px;color:inherit}
.search button{flex:0 0 auto;display:flex;align-items:center;justify-content:center;width:34px;height:34px;padding:0;border:0;border-radius:999px;background:var(--paper);color:var(--ink-soft);cursor:pointer}
.search button:hover{background:var(--hover);color:var(--ink)}
.suggest{position:absolute;left:0;right:0;top:52px;background:var(--raised);border:1px solid var(--border);border-radius:var(--radius-lg);box-shadow:var(--shadow-md);padding:6px;z-index:5}
.suggest[hidden]{display:none}
.suggest div{padding:8px 12px;border-radius:var(--radius-sm);font-size:14px;cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.suggest div.on{background:var(--hover)}

/* ── Tiles ──────────────────────────────────────────────────────────────────
   Five to a row, matching the launcher's Start page tile grid. */
.grid{display:grid;grid-template-columns:repeat(5,1fr);gap:6px;margin-top:28px}
/* No card, no border: a shortcut is a target, and forty tiles of chrome read as
   noise. Hover paints a soft plate instead. */
.bookmark{display:grid;justify-items:center;gap:8px;padding:14px 8px 12px;border-radius:var(--radius);text-decoration:none;color:inherit;background:transparent}
.bookmark:hover{background:var(--hover)}
.section-label{margin:26px 0 0;font-size:12px;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;color:var(--ink-soft)}
.section-label + .grid{margin-top:10px}
/* Tiles are <button>, so they need the anchor's typography back, and a state
   tint that says what happened without a toast this page has no room for. */
.bookmark.automation{border:0;font:inherit;cursor:pointer;background:transparent;text-align:center}
.bookmark.automation[data-state=running]{background:var(--hover);cursor:progress}
.bookmark.automation[data-state=running] .mark{color:var(--ink)}
.bookmark.automation[data-state=done] .mark{border-color:var(--status-active-border);background:var(--status-active-bg);color:var(--status-active-ink)}
.bookmark.automation[data-state=failed] .mark{border-color:var(--danger);background:var(--danger-bg);color:var(--danger)}
.mark{width:46px;height:46px;border-radius:var(--radius);background:var(--raised);border:1px solid var(--border);color:var(--ink-soft);display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:700}
.bookmark .favicon{width:26px;height:26px;border-radius:var(--radius-xs);object-fit:contain}
/* 700, the app's own weight for a label: at 12px on a tile the browser's
   default bold on <strong> made a row of five titles look like five headings. */
.bookmark strong{max-width:100%;font-size:12px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.empty{margin-top:28px;color:var(--ink-soft);font-size:13px}
</style>
</head>
<body>
<main>
<section class="session" id="session" data-state="${proxyStatus.ok ? 'ok' : 'fail'}">
<div class="session-head">
<span class="session-dot"></span>
<div class="session-text"><strong id="session-title">${escapeHtml(proxyStatus.title)}</strong><small id="session-detail">${escapeHtml(proxyStatus.detail)}</small></div>
<div class="session-actions">
${recheckable ? `<button type="button" id="recheck" title="Re-check this proxy" aria-label="Re-check this proxy">${RECHECK_ICON}</button>` : ''}
<a href="https://ip.me/" title="Check this session on ip.me" aria-label="Check this session on ip.me">${EXTERNAL_ICON}</a>
</div>
</div>
<dl class="session-fields" id="session-fields"${proxyStatus.fields?.length ? '' : ' hidden'}>${sessionFieldsHtml(proxyStatus.fields)}</dl>
</section>
<div class="brand">${argusMark}</div>
<h1>${safeName}</h1>
<p class="sub">Anonymous Argys Browser session</p>
<div class="search-wrap">
<form class="search" id="search" autocomplete="off">
<input type="text" aria-label="Search or enter address" placeholder="Search ${escapeHtml(engine.name)} or enter address" autofocus>
<button type="submit" aria-label="Search">${SEARCH_ICON}</button>
</form>
<div class="suggest" id="suggest" hidden></div>
</div>
${bookmarkItems ? `<section class="grid">${bookmarkItems}</section>` : '<p class="empty">No shared bookmarks yet.</p>'}
${automationTiles ? `<h2 class="section-label">Automations</h2><section class="grid automations">${automationTiles}</section>` : ''}
</main>
<script>
/* The page's two calls back to the launcher. Same constraint as the search
   logic below: this document is written to disk and loaded from file://, so the
   behaviour has to travel inside it.

   RUN.token authorizes exactly two things -- run one of the automations listed
   above against this profile, and re-check this profile's assigned proxy. It
   cannot create, edit or delete anything, cannot read another run, cannot mint
   keys and cannot supply its own steps or its own proxy: both requests carry
   nothing but an id the launcher already knows.

   It is a plain constant on purpose: not in the URL, not in localStorage, not
   in a <meta> tag. Those are the three places a later navigation to a hostile
   page could plausibly reach; a closure variable in a file:// document is not
   readable across origins, and the browser does not run with
   --allow-file-access-from-files (checked before this shipped). */
${run ? `(function () {
  var RUN = ${JSON.stringify(run)};

  /* Required by the launcher on both routes: a cross-origin <form> POST cannot
     set this header, so a hostile page has to send a preflight that is never
     answered. */
  function post(path, body) {
    return fetch('http://127.0.0.1:' + RUN.port + path, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(body)
    }).then(function (r) {
      return r.json().then(function (d) { return {ok: r.ok, body: d}; });
    });
  }

  var tiles = document.querySelectorAll('.bookmark.automation');
  Array.prototype.forEach.call(tiles, function (tile) {
    tile.addEventListener('click', function () {
      if (tile.dataset.state === 'running') { return; }
      tile.dataset.state = 'running';
      post('/v1/automations/run-from-page', {runToken: RUN.token, automationId: tile.dataset.id})
        .then(function (result) {
          /* The launcher answers identically for every refusal, so there is
             nothing more specific to say here than that it did not start. */
          tile.dataset.state = result.ok && result.body.status ? 'done' : 'failed';
          setTimeout(function () { tile.dataset.state = 'idle'; }, 4000);
        })
        .catch(function () {
          tile.dataset.state = 'failed';
          setTimeout(function () { tile.dataset.state = 'idle'; }, 4000);
        });
    });
  });

  /* The proxy line is measured once, at launch, and a session outlives that by
     hours -- so the panel was quietly showing a latency and a country that had
     stopped being true. This asks for a fresh check. The launcher runs it,
     records it against the proxy (so the Proxies tab agrees), and answers with
     the same wording homeProxyStatus would have written at launch. */
  var recheck = document.getElementById('recheck');
  if (recheck) {
    var panel = document.getElementById('session');
    var title = document.getElementById('session-title');
    var detail = document.getElementById('session-detail');
    var fieldsEl = document.getElementById('session-fields');
    /* Rebuilt from the re-check's own fields rather than left in place: a
       re-check that moves the exit moves the location, the timezone and the
       verdict with it, and rows still describing the previous answer are worse
       than no rows. textContent per cell, never innerHTML -- these values are a
       proxy row and a fingerprint, and this page has no framework escaping them. */
    function renderFields(fields) {
      while (fieldsEl.firstChild) { fieldsEl.removeChild(fieldsEl.firstChild); }
      fieldsEl.hidden = !fields || !fields.length;
      (fields || []).forEach(function (field) {
        var row = document.createElement('div');
        row.className = 'session-field' + (field.mono ? ' mono' : '');
        var dt = document.createElement('dt');
        dt.textContent = field.label;
        var dd = document.createElement('dd');
        var v = document.createElement('span');
        v.className = 'v';
        v.textContent = field.value;
        v.title = field.value;
        dd.appendChild(v);
        if (field.note) {
          var note = document.createElement('span');
          note.className = 'session-note';
          if (field.noteTone) { note.setAttribute('data-tone', field.noteTone); }
          note.textContent = field.note;
          dd.appendChild(note);
        }
        row.appendChild(dt);
        row.appendChild(dd);
        fieldsEl.appendChild(row);
      });
    }
    recheck.addEventListener('click', function () {
      if (panel.dataset.state === 'checking') { return; }
      var previous = panel.dataset.state;
      panel.dataset.state = 'checking';
      recheck.disabled = true;
      title.textContent = 'Checking proxy…';
      post('/v1/proxies/recheck-from-page', {runToken: RUN.token})
        .then(function (result) {
          recheck.disabled = false;
          if (!result.ok || !result.body.status) {
            /* A refused or failed request says nothing about the proxy itself,
               so the panel goes back to what it knew rather than inventing a
               verdict it does not have. */
            panel.dataset.state = previous;
            title.textContent = 'Could not re-check';
            detail.textContent = 'The launcher refused or could not answer this check.';
            renderFields(null);
            return;
          }
          panel.dataset.state = result.body.proxyOk ? 'ok' : 'fail';
          title.textContent = result.body.title;
          detail.textContent = result.body.detail;
          renderFields(result.body.fields);
        })
        .catch(function () {
          recheck.disabled = false;
          panel.dataset.state = previous;
          title.textContent = 'Could not re-check';
          detail.textContent = 'Argus Launcher is not reachable from this session.';
          renderFields(null);
        });
    });
  }
}());` : ''}
/* A copy of looksLikeUrl/resolveQuery from lib/searchEngines.ts, not an import.
   This document is written to disk and loaded from file:// -- it has no module
   graph and no bundler, so the logic has to travel inside it. If the heuristic
   below changes, change it in both places.

   The engine is baked in at generation time from the choice made in the
   launcher; there is no picker here on purpose. The only values interpolated
   into this script are that fixed engine record and constants, and the typed
   query is encoded before it is used. */
(function () {
  var ENGINE = ${JSON.stringify(engine)};
  var SUGGEST = ${JSON.stringify(engine.id === 'google')};
  var form = document.getElementById('search');
  var input = form.querySelector('input');
  var box = document.getElementById('suggest');
  /* The suggestion list, which of its rows is highlighted, the input debounce
     and a request counter. Declared up here because the submit handler below
     reads the first two. */
  var items = [], active = -1, timer = null, seq = 0;
  /* host:port is not a scheme -- see normalizeBookmarkUrl in lib/bookmarks.ts. */
  function hasScheme(text) {
    return /^[a-z][a-z0-9+.-]*:/i.test(text) &&
        !/^[a-z0-9.-]+:\\d+([/?#]|$)/i.test(text);
  }
  function looksLikeUrl(text) {
    if (hasScheme(text)) return true;
    if (/\\s/.test(text)) return false;
    if (/^localhost(:\\d+)?([/?#]|$)/i.test(text)) return true;
    if (/^\\d{1,3}(\\.\\d{1,3}){3}(:\\d+)?([/?#]|$)/.test(text)) return true;
    return /^[^\\s/?#@]+\\.[a-z]{2,}(:\\d+)?([/?#]|$)/i.test(text);
  }
  function go(text) {
    text = text.trim();
    if (!text) return;
    if (looksLikeUrl(text)) {
      location.href = hasScheme(text) ? text : 'https://' + text;
      return;
    }
    location.href = ENGINE.searchUrl.replace('%s', encodeURIComponent(text));
  }
  form.addEventListener('submit', function (event) {
    event.preventDefault();
    go(active >= 0 && items[active] ? items[active] : input.value);
  });

  /* ---- Suggestions ----------------------------------------------------
     Google's completion endpoint sends no CORS header, so fetch() from a
     file:// page is refused. It does honour ?callback=, so the request goes out
     as an injected script element instead -- the one cross-origin read a file://
     document is allowed. (Never write a closing script tag in this file: it
     would end the block early.) It is an undocumented endpoint and may change,
     which is why every failure here is silent: no suggestions is a fine state,
     and the search box works exactly the same without them.

     Only for Google. Sending what you type to Google while DuckDuckGo is the
     selected engine would be a surprise, so the other engines get no
     suggestions rather than the wrong provider's. */
  function render() {
    if (!items.length) {
      box.hidden = true;
      box.textContent = '';
      return;
    }
    box.textContent = '';
    items.forEach(function (text, index) {
      var row = document.createElement('div');
      row.textContent = text;
      if (index === active) row.className = 'on';
      /* mousedown, not click: the input's blur fires first on click and would
         have already hidden the list. */
      row.addEventListener('mousedown', function (event) {
        event.preventDefault();
        go(text);
      });
      box.appendChild(row);
    });
    box.hidden = false;
  }

  function close() {
    items = [];
    active = -1;
    render();
  }

  function request(query) {
    var id = ++seq;
    var name = '__argusSuggest' + id;
    var script = document.createElement('script');
    window[name] = function (data) {
      /* A slower earlier request can land after a faster later one; only the
         newest query may paint. */
      if (id === seq) {
        items = (data && data[1] ? data[1] : []).slice(0, 8);
        active = -1;
        render();
      }
    };
    function cleanup() {
      delete window[name];
      if (script.parentNode) script.parentNode.removeChild(script);
    }
    script.onload = cleanup;
    script.onerror = cleanup;
    script.src = 'https://suggestqueries.google.com/complete/search?client=chrome&callback=' +
        name + '&q=' + encodeURIComponent(query);
    document.head.appendChild(script);
  }

  input.addEventListener('input', function () {
    if (!SUGGEST) return;
    var text = input.value.trim();
    if (timer) clearTimeout(timer);
    /* Nothing to complete for a url the user is typing out in full, and no
       reason to hand it to Google either. */
    if (!text || looksLikeUrl(text)) {
      close();
      return;
    }
    timer = setTimeout(function () { request(text); }, 120);
  });

  input.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') {
      close();
      return;
    }
    if (!items.length) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      var step = event.key === 'ArrowDown' ? 1 : -1;
      active = (active + step + items.length + 1) % (items.length + 1);
      /* The extra slot is "no selection", so arrowing past either end returns
         the user to what they actually typed. */
      if (active === items.length) active = -1;
      render();
    }
  });

  input.addEventListener('blur', close);
})();
</script>
</body>
</html>`;
}
