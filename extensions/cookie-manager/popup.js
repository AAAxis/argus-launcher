// Toolbar popup. Talks to background.js's message API (get-status, sync-now,
// set-paused, pull-from-launcher, export-cookies, import-cookies) -- see that
// file's SyncState comments for the authoritative field contract. This is
// the surface almost every user will ever see, so every state the sync
// engine can persist gets its own distinct, plain-language card here rather
// than mirroring the toolbar badge's reduced glyph set.
const $ = (selector) => document.querySelector(selector);

// send() never lets a thrown/rejected sendMessage (e.g. the background
// worker being evicted mid-call, or "Extension context invalidated" during
// a reload) leave a caller awaiting forever -- every caller gets a
// {ok:false, error} shape back either way, which is what makes the
// "no action may leave a spinner running" requirement enforceable.
async function send(message) {
  try {
    const response = await chrome.runtime.sendMessage(message);
    return response || {ok: false, error: 'No response from the extension background.'};
  } catch (error) {
    return {ok: false, error: error instanceof Error ? error.message : String(error)};
  }
}

function setStatus(text, isError) {
  $('#status').textContent = text || '';
  $('#status').className = isError ? 'status error' : 'status';
}

function relativeTime(at) {
  if (!at) return '';
  const minutes = Math.round((Date.now() - at) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return hours < 24 ? `${hours} h ago` : new Date(at).toLocaleDateString();
}

// ---- icon system ------------------------------------------------------------
// Inline SVG only, no external assets. Every entry here is a fixed, hand-
// authored path string indexed by our own literal name -- never built from
// cookie/profile/server data -- so writing it via innerHTML is not the kind
// of interpolation the "never put cookie/profile values in innerHTML" rule
// (see editor.js) is about. All icons share one 24x24/stroke=2 grammar so a
// single <svg> factory can size any of them for its slot (20px status icon,
// 14px button/mini icon).
const ICON_PATHS = {
  circle: '<circle cx="12" cy="12" r="9"/>',
  alertTriangle: '<path d="m21.73 18-8-14a2 2 0 0 0-3.46 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/>' +
    '<path d="M12 9v4"/><path d="M12 17h.01"/>',
  xCircle: '<circle cx="12" cy="12" r="9"/><path d="m14.5 9.5-5 5"/><path d="m9.5 9.5 5 5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>',
  alertOctagon: '<path d="M7.86 2h8.28L22 7.86v8.28L16.14 22H7.86L2 16.14V7.86Z"/>' +
    '<path d="M12 8v4"/><path d="M12 16h.01"/>',
  pause: '<circle cx="12" cy="12" r="9"/><path d="M10 9v6"/><path d="M14 9v6"/>',
  loader: '<path d="M21 12a9 9 0 1 1-2.64-6.36"/>',
  checkCircle: '<circle cx="12" cy="12" r="9"/><path d="m8.5 12.5 2.5 2.5 5-5.5"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-2.64-6.36M21 3v6h-6"/>',
  edit: '<path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/>',
  'upload-tray': '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 8l5-5 5 5M12 3v12"/>',
  cookie: '<path d="M12 2a10 10 0 1 0 10 10 4 4 0 0 1-5-5 4 4 0 0 1-5-5"/>' +
    '<path d="M8.5 8.5v.01"/><path d="M16 15.5v.01"/><path d="M12 12v.01"/>' +
    '<path d="M11 17v.01"/><path d="M7 14v.01"/>',
};

function makeIcon(name, size) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('aria-hidden', 'true');
  // Set directly on the element rather than relying solely on the CSS
  // `.icon svg` rule: makeIcon() is called for the status icon too, which
  // sits in a `.status-icon` wrapper that rule doesn't match. Without this,
  // SVG's initial fill (black) paints a solid glyph instead of an outline
  // and ignores the tone color entirely.
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.innerHTML = ICON_PATHS[name] || ICON_PATHS.circle;
  return svg;
}

function setIcon(container, name, size) {
  container.dataset.icon = name;
  container.replaceChildren(makeIcon(name, size));
}

// Static [data-icon] placeholders in popup.html get their SVG once at load.
for (const el of document.querySelectorAll('[data-icon]')) {
  setIcon(el, el.dataset.icon, 14);
}

// Header mark, sized up from the button-icon default (14px) so it reads as
// a deliberate logo rather than another inline glyph -- rendered directly
// instead of through the [data-icon] loop above for that reason.
$('.app-icon').replaceChildren(makeIcon('cookie', 20));

// ---- sync state -> plain-language card -------------------------------------
// Priority order matters: a launcher that isn't reachable is worse news than
// "paused", which is worse news than "pending", which is worse news than
// "in sync". lastErrorKind is checked before paused/pushPending/inSync so a
// real unresolved failure never gets hidden behind a stale-looking green/amber
// state -- this is the "must lead with lastError, not the badge" requirement
// from the brief: the badge can stay green while lastErrorKind is 'internal'
// because the badge only paints a handful of transport-level kinds, but the
// popup has room to say what actually happened for every kind background.js
// can persist.
function classifySync(sync) {
  if (!sync.available) {
    return {
      tone: 'off', icon: 'circle', title: 'Sync unavailable',
      detail: 'This window was not launched from Argus Launcher, so cookies are not being synced.',
    };
  }
  if (!sync.reachable || sync.lastErrorKind === 'network') {
    return {
      tone: 'bad', icon: 'alertTriangle', title: 'Launcher not reachable',
      detail: sync.lastError || 'Argus Launcher did not answer. Cookies stay local until it is back.',
    };
  }
  if (sync.lastErrorKind === 'refused') {
    // The bug this whole feature exists to make visible -- keep it
    // unmistakable and say what to do about it, not just that it failed.
    return {
      tone: 'bad', icon: 'xCircle', title: 'Launcher rejected the request',
      detail: 'This profile’s session with the Launcher looks stale or invalid. ' +
          'Relaunch the profile from Argus Launcher to renew it.',
    };
  }
  if (sync.lastErrorKind === 'rate-limited') {
    return {
      tone: 'warn', icon: 'clock', title: 'Rate limited',
      detail: 'Argus Launcher is throttling requests right now. Sync will retry automatically.',
    };
  }
  if (sync.lastErrorKind === 'internal') {
    return {
      tone: 'bad', icon: 'alertOctagon', title: 'Sync error',
      detail: sync.lastError || 'Something went wrong inside the sync engine.',
    };
  }
  if (sync.lastErrorKind === 'saved-none') {
    return {
      tone: 'bad', icon: 'alertTriangle', title: 'Nothing was saved',
      detail: sync.lastError || 'Argus Launcher did not recognize any of the pushed cookies.',
    };
  }
  if (sync.lastErrorKind === 'import-failed') {
    return {
      tone: 'bad', icon: 'alertTriangle', title: 'Pull failed',
      detail: sync.lastError || 'None of the cookies from Argus Launcher could be applied here.',
    };
  }
  if (sync.lastErrorKind === 'server-error') {
    return {
      tone: 'bad', icon: 'alertTriangle', title: 'Launcher error',
      detail: sync.lastError || 'Argus Launcher answered with an error.',
    };
  }
  if (sync.paused) {
    return {
      tone: 'warn', icon: 'pause', title: 'Sync paused',
      detail: 'Cookies stay local until you resume or use "Save to Launcher now".',
    };
  }
  if (sync.pushPending) {
    return {
      tone: 'warn', icon: 'loader', spin: true, title: 'Push pending',
      detail: 'Waiting to push recent cookie changes to Argus Launcher…',
    };
  }
  if (sync.inSync) {
    const bits = [`${sync.pushedCount} cookie${sync.pushedCount === 1 ? '' : 's'}`];
    if (sync.lastSet) bits.push(`saved to “${sync.lastSet}”`);
    const when = relativeTime(sync.pushedAt);
    if (when) bits.push(when);
    return {tone: 'ok', icon: 'checkCircle', title: 'In sync with Launcher', detail: bits.join(' · ')};
  }
  return {
    tone: 'off', icon: 'circle', title: 'Not yet synced',
    detail: 'Cookies have not been sent to Argus Launcher yet.',
  };
}

function renderSync(sync) {
  const state = classifySync(sync);
  $('#sync-card').className = `card tone-${state.tone}`;
  const iconEl = $('#sync-icon');
  iconEl.replaceChildren(makeIcon(state.icon, 20));
  iconEl.classList.toggle('spin', Boolean(state.spin));
  $('#sync-title').textContent = state.title;
  $('#sync-detail').textContent = state.detail;
  $('#sync-toggle').checked = !sync.paused;
  $('#sync-toggle').disabled = !sync.available;
  $('#sync-now').disabled = !sync.available;
  $('#pull').disabled = !sync.available;
  // Save-as goes over the same run-token route as sync, so it needs the same
  // "was this window launched from Argus Launcher" precondition -- unlike
  // sync-now/pull it does not also need inSync/paused, since it is not the
  // automatic loop.
  $('#save-as-toggle').disabled = !sync.available;
}

function renderSeed(seed) {
  const container = $('#seed-status');
  if (seed.imported) {
    setIcon($('#seed-icon'), 'checkCircle', 14);
    const when = seed.seededAt ? ` on ${new Date(seed.seededAt).toLocaleDateString()}` : '';
    $('#seed-text').textContent =
        `${seed.seededCount} cookie${seed.seededCount === 1 ? '' : 's'} auto-imported${when}`;
    container.className = 'seed-status seeded';
  } else {
    setIcon($('#seed-icon'), 'circle', 14);
    $('#seed-text').textContent = 'No seed cookies for this profile';
    container.className = 'seed-status';
  }
}

function renderCounts(counts) {
  $('#total-count').textContent = String(counts.total);
  // No siteDomain means the active tab isn't a real http(s) site (an
  // internal chrome:// / extension page) -- "0" there reads as "zero
  // cookies on this site", which overstates what's known. An em-dash says
  // the count does not apply, same idea as background.js's empty-domain
  // contract for this state.
  $('#site-count').textContent = counts.siteDomain ? String(counts.site) : '—';
  $('#site-label').textContent = counts.siteDomain || 'This site';
}

// Read by openSaveAsForm() below for the prefilled default name. Module-level
// rather than re-fetched on open: get-status is already a round trip refresh()
// makes on every load and after every action, so the profile name is never
// more than one of those old by the time the button is clicked.
let currentProfileName = '';

async function refresh() {
  const status = await send({type: 'get-status'});
  if (!status || !status.sync) {
    renderSync({
      available: false, reachable: false, paused: false, inSync: false, pushPending: false,
      lastError: (status && status.error) || 'Could not load status from the extension background.',
      lastErrorKind: 'internal', pushedAt: 0, pushedCount: 0, lastSet: '',
    });
    renderSeed({imported: false});
    renderCounts({total: 0, site: 0, siteDomain: ''});
    return;
  }
  const chip = $('#profile-chip');
  currentProfileName = (status.profile && status.profile.name) || '';
  if (currentProfileName) {
    chip.textContent = currentProfileName;
    chip.hidden = false;
  } else {
    chip.hidden = true;
  }
  renderSync(status.sync);
  renderSeed(status.seed);
  renderCounts(status.counts);
}

// Disables the button, swaps its icon for a spinner, and always restores
// both -- even if `work` throws -- so a message-handler failure can never
// leave the popup with a stuck spinner (brief's explicit requirement).
async function withBusy(button, work) {
  const iconEl = button.querySelector('.icon');
  const original = iconEl ? iconEl.dataset.icon : null;
  button.disabled = true;
  if (iconEl) { setIcon(iconEl, 'loader', 14); iconEl.classList.add('spin'); }
  try {
    await work();
  } finally {
    button.disabled = false;
    if (iconEl && original) { setIcon(iconEl, original, 14); iconEl.classList.remove('spin'); }
  }
}

$('#sync-now').addEventListener('click', () => withBusy($('#sync-now'), async () => {
  setStatus('Saving to Launcher…');
  const result = await send({type: 'sync-now'});
  if (result.ok) {
    setStatus(result.unchanged ?
      'Already in sync with Launcher' :
      `Saved ${result.count ?? 0} cookies to Launcher${result.set ? ` ("${result.set}")` : ''}`);
  } else {
    setStatus(result.error || 'Could not save to Launcher', true);
  }
  await refresh();
}));

$('#sync-toggle').addEventListener('change', async (event) => {
  const resume = event.target.checked;
  event.target.disabled = true;
  try {
    await send({type: 'set-paused', paused: !resume});
    setStatus(resume ? 'Auto-sync resumed' : 'Auto-sync paused');
  } finally {
    await refresh();
  }
});

$('#pull').addEventListener('click', () => withBusy($('#pull'), async () => {
  setStatus('Loading from Launcher…');
  const result = await send({type: 'pull-from-launcher'});
  const setName = result.set || 'Launcher';
  if (!result.ok) {
    setStatus(result.error || 'Could not load from Launcher', true);
  } else if (!result.count) {
    setStatus(result.set ? `"${result.set}" has no cookies to load` : 'No cookie set is assigned to this profile');
  } else if (result.failed) {
    // Partial import: substantial progress was made, so this is not styled
    // as a hard error, but the failed count must still be visible -- silently
    // rounding a partial pull up to a full success is exactly the kind of
    // swallowed failure this rewrite exists to close.
    setStatus(`Loaded ${result.count} of ${result.count + result.failed} cookies from "${setName}" ` +
        `— ${result.failed} failed to import`);
  } else {
    setStatus(`Loaded ${result.count} cookies from "${setName}"`);
  }
  await refresh();
}));

// ---- save-as: inline expanding name field -----------------------------------
function defaultSaveAsName() {
  const date = new Date().toISOString().slice(0, 10);
  return currentProfileName ? `${currentProfileName} ${date}` : `Cookies ${date}`;
}

function openSaveAsForm() {
  $('#save-as-toggle').hidden = true;
  $('#save-as-form').hidden = false;
  const input = $('#save-as-name');
  input.value = defaultSaveAsName();
  input.focus();
  input.select();
}

function closeSaveAsForm() {
  $('#save-as-form').hidden = true;
  $('#save-as-toggle').hidden = false;
}

$('#save-as-toggle').addEventListener('click', openSaveAsForm);
$('#save-as-cancel').addEventListener('click', () => closeSaveAsForm());
$('#save-as-form').addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    event.preventDefault();
    closeSaveAsForm();
  }
});
// The name input's Enter submits the form natively; this only handles the
// async work and reporting, the same withBusy/setStatus contract every other
// action here follows -- no action may leave the button (or, here, the form)
// stuck mid-request with nothing said.
$('#save-as-form').addEventListener('submit', (event) => {
  event.preventDefault();
  void withBusy($('#save-as-confirm'), async () => {
    const name = $('#save-as-name').value;
    setStatus('Saving to Cookies tab…');
    const result = await send({type: 'save-as-set', name});
    if (result.ok) {
      setStatus(`Saved ${result.saved} cookies to "${result.set}"`);
      closeSaveAsForm();
    } else {
      // Left open on failure (an empty/whitespace name, an unreachable
      // launcher) so the user can fix the input and retry without re-opening
      // the form and losing what they typed.
      setStatus(result.error || 'Could not save to the Cookies tab', true);
    }
  });
});

$('#open-editor').addEventListener('click', () => {
  void chrome.tabs.create({url: chrome.runtime.getURL('editor.html')});
});

function closeExportMenu() {
  $('#export-menu').hidden = true;
  $('#export-menu-button').setAttribute('aria-expanded', 'false');
}

$('#export-menu-button').addEventListener('click', () => {
  const willOpen = $('#export-menu').hidden;
  $('#export-menu').hidden = !willOpen;
  $('#export-menu-button').setAttribute('aria-expanded', String(willOpen));
});

$('#export-menu').addEventListener('click', (event) => {
  const button = event.target.closest('button[data-format]');
  if (!button) return;
  closeExportMenu();
  void withBusy($('#export-menu-button'), async () => {
    const {scope, format} = button.dataset;
    try {
      if (format === 'clipboard') {
        setStatus('Copying…');
        const cookies = await chrome.cookies.getAll({});
        if (!cookies.length) { setStatus('No cookies to copy'); return; }
        await navigator.clipboard.writeText(ArgusCookieFormat.toCookieJson(cookies));
        setStatus(`Copied ${cookies.length} cookies to clipboard`);
        return;
      }
      setStatus('Exporting…');
      const result = await send({type: 'export-cookies', scope, format});
      setStatus(result.count ? `Exported ${result.count} cookies` : (result.error || 'Nothing to export'),
          Boolean(result.error));
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error), true);
    }
  });
});

$('#import-file').addEventListener('change', async (event) => {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  const label = $('#import-label');
  label.classList.add('busy');
  setStatus('Importing…');
  try {
    const cookies = ArgusCookieFormat.parseCookieContent(await file.text());
    if (!cookies.length) throw new Error('No cookies found in that file');
    const result = await send({type: 'import-cookies', cookies});
    if (!result.ok && result.error && !('count' in result)) {
      // send() itself failed (background unreachable) -- result.count is
      // absent, unlike a normal import-cookies reply which always has one.
      throw new Error(result.error);
    }
    const failed = result.failed || 0;
    setStatus(`Imported ${result.count || 0} of ${cookies.length} cookies` + (failed ? ` — ${failed} failed` : ''),
        failed > 0 && !result.count);
    await refresh();
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), true);
  } finally {
    event.target.value = '';
    label.classList.remove('busy');
  }
});

document.addEventListener('click', (event) => {
  if (!event.target.closest('.menu-wrap')) closeExportMenu();
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !$('#export-menu').hidden) closeExportMenu();
});

void refresh();
