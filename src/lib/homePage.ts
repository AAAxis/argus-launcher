// The local home page injected into every anonymous browser session: shared
// bookmarks plus a badge saying whether the anti-detect proxy is actually
// working. Built as a string here because the browser renders it from a file
// the main process writes, not from this renderer.
import {bookmarkInitial, faviconCache, normalizeBookmarkUrl} from './bookmarks';
import {escapeHtml} from './text';
import type {SearchEngine} from './searchEngines';
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

export function homeProxyStatus(profile: ArgusProfile, proxy: ArgusProxy | null) {
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
  const location = [proxy.country || proxy.country_code, egressIp]
      .filter(Boolean)
      .join(' · ');
  const latency = typeof proxy.ping_ms === 'number' ? ` · ${proxy.ping_ms}ms` : '';
  return {
    ok: true,
    title: 'Anti-detect proxy active',
    detail: `${proxyLabel}${location ? ` · ${location}` : ''}${latency}`,
  };
}

export function anonymousHomeHtml(
    profile: ArgusProfile, bookmarks: SharedBookmark[], proxy: ArgusProxy | null,
    engine: SearchEngine,
    // What this launch may run from its own start page, and the credential for
    // asking. Both come from buildLaunchPayload; omitted (the default) means no
    // tiles and no token in the file at all -- which is what an ordinary launch
    // with nothing attached and nothing pinned gets.
    automations: Array<{id: string; name: string}> = [],
    run: {port: number; token: string} | null = null) {
  const safeName = escapeHtml(profile.name || 'Profile');
  const proxyStatus = homeProxyStatus(profile, proxy);
  const badgeClass = proxyStatus.ok ? 'badge ok' : 'badge fail';
  const badgeTitle = escapeHtml(proxyStatus.title);
  const badgeDetail = escapeHtml(proxyStatus.detail);
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
        return `<button type="button" class="bookmark automation" data-id="${escapeHtml(automation.id)}" data-state="idle" title="${name}"><span class="mark">&#9654;</span><strong>${name}</strong></button>`;
      })
      .join('') : '';
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${safeName}</title>
<style>
body{margin:0;background:#fbfaf8;color:#1d1c18;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
/* Capped and centred rather than edge to edge. Unbounded, the auto-fill grid
   below spread a handful of bookmarks across the entire window on a wide
   display. Matches the .start-page cap in the launcher's own Start page tab. */
main{min-height:100vh;padding:48px 24px;box-sizing:border-box;max-width:640px;margin:0 auto}
/* Wraps, and the title block is allowed to shrink. This header was laid out for
   a full-width page; at the 640px cap a long profile name and the proxy badge
   were fighting over the same row. */
header{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;border-bottom:1px solid #e4ddd1;padding-bottom:20px}
header > div{min-width:0}
h1{font-size:22px;margin:0 0 4px;font-weight:850;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
p{margin:0;color:#716b62;font-size:13px}
.badge{align-items:flex-start;border:1px solid #ded6c8;border-radius:14px;display:grid;gap:4px;min-width:0;max-width:320px;padding:8px 12px;background:#fff;font-weight:750;text-decoration:none}
.badge::before{border-radius:999px;content:"";height:10px;margin-top:4px;width:10px;grid-row:1 / span 2}
.badge.ok{border-color:#9fd3b2;background:#f1fbf5;color:#14532d;grid-template-columns:10px 1fr}
.badge.ok::before{background:#16a34a}
.badge.fail{border-color:#f0b4ad;background:#fff5f4;color:#7f1d1d;grid-template-columns:10px 1fr}
.badge.fail::before{background:#dc2626}
.badge:hover{filter:brightness(.98)}
.badge strong{font-size:13px;line-height:1.2}
.badge small{color:inherit;font-size:12px;font-weight:650;line-height:1.35;opacity:.78;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
/* The suggestion list is positioned against this, so it stays put while the
   input inside it grows or shrinks. */
.search-wrap{position:relative;margin-top:28px}
.search{display:flex;align-items:center;gap:8px;background:#fff;border:1px solid #e4ddd1;border-radius:999px;padding:0 6px 0 16px;height:46px}
.search:focus-within{border-color:#c9bfae;box-shadow:0 2px 10px rgba(29,28,24,.07)}
.search input{flex:1;min-width:0;border:0;outline:none;background:transparent;font:inherit;font-size:14px;color:inherit}
.search button{flex:0 0 auto;display:flex;align-items:center;justify-content:center;width:34px;height:34px;padding:0;border:0;border-radius:999px;background:#f0ece9;color:#716b62;cursor:pointer}
.search button:hover{background:#e7e1d8;color:#1d1c18}
.suggest{position:absolute;left:0;right:0;top:52px;background:#fff;border:1px solid #e4ddd1;border-radius:14px;box-shadow:0 8px 24px rgba(29,28,24,.12);padding:6px;z-index:5}
.suggest[hidden]{display:none}
.suggest div{padding:8px 12px;border-radius:9px;font-size:14px;cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.suggest div.on{background:#f0ece9}
/* Five to a row, matching the launcher's Start page tile grid. */
.grid{display:grid;grid-template-columns:repeat(5,1fr);gap:6px;margin-top:32px}
/* No card, no border: a shortcut is a target, and forty tiles of chrome read as
   noise. Hover paints a soft plate instead -- the previous rule drew a hard
   black outline, which shouted on every pass of the mouse. */
.bookmark{display:grid;justify-items:center;gap:8px;padding:14px 8px 12px;border-radius:12px;text-decoration:none;color:inherit;background:transparent}
.bookmark:hover{background:#f2eee8}
/* Tiles are <button>, so they need the anchor's typography back, and a state
   tint that says what happened without a toast this page has no room for. */
.section-label{margin:26px 0 6px;font-size:12px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:#8a8178}
.bookmark.automation{border:0;font:inherit;cursor:pointer;background:transparent;text-align:center}
.bookmark.automation[data-state=running]{background:#efe7d8;cursor:progress}
.bookmark.automation[data-state=done]{background:#e2efe4}
.bookmark.automation[data-state=failed]{background:#f6e3df}
.bookmark.automation .mark{font-size:15px}
.mark{width:46px;height:46px;border-radius:13px;background:#fff;border:1px solid #e9e2d6;color:#716b62;display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:800}
.bookmark .favicon{width:26px;height:26px;border-radius:8px;object-fit:contain}
/* 650, not the browser default 700 the strong element carries: at 12px on a
   tile the heavier weight made a row of five titles look like five headings. */
.bookmark strong{max-width:100%;font-size:12px;font-weight:650;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.empty{margin-top:34px;color:#716b62}
</style>
</head>
<body>
<main>
<header>
<div><h1>${safeName}</h1><p>Anonymous Argys Browser session</p></div>
<a class="${badgeClass}" href="https://ip.me/"><strong>${badgeTitle}</strong><small>${badgeDetail}</small></a>
</header>
<div class="search-wrap">
<form class="search" id="search" autocomplete="off">
<input type="text" aria-label="Search or enter address" placeholder="Search ${escapeHtml(engine.name)} or enter address" autofocus>
<button type="submit" aria-label="Search"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="7"></circle><path d="M20 20l-3.5-3.5"></path></svg></button>
</form>
<div class="suggest" id="suggest" hidden></div>
</div>
${bookmarkItems ? `<section class="grid">${bookmarkItems}</section>` : '<p class="empty">No shared bookmarks yet.</p>'}
${automationTiles ? `<h2 class="section-label">Automations</h2><section class="grid automations">${automationTiles}</section>` : ''}
</main>
<script>
/* Automation tiles. Same constraint as the search logic below: this document is
   written to disk and loaded from file://, so the behaviour has to travel
   inside it.

   RUN.token authorizes exactly one thing -- run one of the automations listed
   above, against this profile, on this launch's debugging port. It cannot
   create, edit or delete anything and it cannot supply its own steps, because
   the request carries an id and the workflow is looked up in the launcher.

   It is a plain constant on purpose: not in the URL, not in localStorage, not
   in a <meta> tag. Those are the three places a later navigation to a hostile
   page could plausibly reach; a closure variable in a file:// document is not
   readable across origins, and the browser does not run with
   --allow-file-access-from-files (checked before this shipped). */
${run ? `(function () {
  var RUN = ${JSON.stringify(run)};
  var tiles = document.querySelectorAll('.bookmark.automation');
  Array.prototype.forEach.call(tiles, function (tile) {
    tile.addEventListener('click', function () {
      if (tile.dataset.state === 'running') { return; }
      tile.dataset.state = 'running';
      fetch('http://127.0.0.1:' + RUN.port + '/v1/automations/run-from-page', {
        method: 'POST',
        /* Required by the launcher: a cross-origin <form> POST cannot set it,
           so a hostile page has to send a preflight that is never answered. */
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({runToken: RUN.token, automationId: tile.dataset.id})
      }).then(function (r) {
        return r.json().then(function (d) { return {ok: r.ok, body: d}; });
      }).then(function (result) {
        /* The launcher answers identically for every refusal, so there is
           nothing more specific to say here than that it did not start. */
        tile.dataset.state = result.ok && result.body.status ? 'done' : 'failed';
        setTimeout(function () { tile.dataset.state = 'idle'; }, 4000);
      }).catch(function () {
        tile.dataset.state = 'failed';
        setTimeout(function () { tile.dataset.state = 'idle'; }, 4000);
      });
    });
  });
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
