// The Argus Panel: one side panel describing one browser session.
//
// Replaces the toolbar popup this extension used to open. Everything that popup
// could do is still here, plus the proxy readout the generated start page used
// to carry alone and the automations this launch may run.
//
// Two sources of truth, both owned elsewhere:
//   - background.js's message API (get-status, get-session, sync-now,
//     set-paused, pull-from-launcher, save-as-set, export-cookies,
//     import-cookies, recheck-proxy, run-automation). See that file's SyncState
//     comments for the authoritative field contract.
//   - argus-session.json, written per launch by the launcher's
//     built-in-extensions.cjs from its own homeProxyStatus() output. The panel
//     renders that object; it never composes proxy wording of its own, so the
//     panel and the start page cannot describe one session two ways.
//
// The one thing this must do that the popup did not: stay honest while it is
// open. A popup lived for seconds and could read once; a panel is open for
// hours beside a working session, and every count and every state in it would
// otherwise go stale without ever looking stale.
const $ = (selector) => document.querySelector(selector);

// send() never lets a thrown/rejected sendMessage (the background worker being
// evicted mid-call, or "Extension context invalidated" during a reload) leave a
// caller awaiting forever -- every caller gets a {ok:false, error} shape back
// either way, which is what makes "no action may leave a spinner running"
// enforceable.
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

ArgusIcons.hydrate(document, 14);
$('.head-mark').replaceChildren(ArgusIcons.make('shield', 18));

// ── Session ────────────────────────────────────────────────────────────────────
// The launch snapshot: profile, theme, proxy verdict, automations. Null when the
// extension is running outside a profile launch, which is the panel's cue to say
// so rather than to invent a session.
let session = null;

// Rebuilt wholesale on every paint rather than patched in place: a re-check that
// moves the exit moves the location, the timezone and the verdict with it, and
// rows still describing the previous answer are worse than no rows.
//
// textContent per cell, never innerHTML -- these values come off a proxy row and
// a fingerprint, both user-supplied, and this page has no framework escaping
// them for it.
function renderProxyFields(fields) {
  const list = $('#proxy-fields');
  list.replaceChildren();
  list.hidden = !fields || !fields.length;
  for (const field of fields || []) {
    const row = document.createElement('div');
    row.className = field.mono ? 'field mono' : 'field';

    const label = document.createElement('dt');
    label.textContent = field.label;

    const value = document.createElement('dd');
    const text = document.createElement('span');
    text.className = 'v';
    text.textContent = field.value;
    text.title = field.value;
    value.appendChild(text);

    if (field.note) {
      const note = document.createElement('span');
      note.className = 'note';
      // No data-tone unless the field asked for one: a latency is a neutral
      // trailing value, and toning it would paint every session's ping green.
      if (field.noteTone) note.setAttribute('data-tone', field.noteTone);
      note.textContent = field.note;
      value.appendChild(note);
    }

    row.append(label, value);
    list.appendChild(row);
  }
}

// `status` is a homeProxyStatus() result: {ok, title, detail, fields?}.
//
// Three tones from two facts. `ok` is about the proxy itself -- it answered its
// last check -- but a row can still carry a verdict of its own, and today
// exactly one does: a timezone that disagrees with the exit's location. A
// session can have a perfectly healthy proxy and still be trivially detectable
// because of it, so a green card reading "Anti-detect proxy active" directly
// above a red "≠ Europe/Berlin" was the panel contradicting itself at a glance.
// Amber is the honest middle: the connection works, and something below needs
// looking at.
//
// The card is not allowed to call this a failure. Whether the proxy is up is
// homeProxyStatus()'s judgement, made in the launcher against a real check, and
// the panel must not overrule it from a note.
function renderProxy(status) {
  const flagged = (status.fields || []).some((field) => field.noteTone === 'bad');
  const tone = !status.ok ? 'bad' : (flagged ? 'warn' : 'ok');
  $('#proxy-card').className = `card tone-${tone}`;
  $('#proxy-icon').replaceChildren(
      ArgusIcons.make(tone === 'ok' ? 'checkCircle' : 'alertTriangle', 16));
  $('#proxy-icon').classList.remove('spin');
  $('#proxy-title').textContent = status.title;
  // The rows say everything `detail` says, better -- it is the one-line form
  // kept for surfaces that render no rows at all. Hidden rather than blanked so
  // a failing re-check, which has a sentence and no rows, gets it straight back.
  const detail = $('#proxy-detail');
  detail.textContent = status.detail;
  detail.hidden = Boolean(status.fields && status.fields.length);
  renderProxyFields(status.fields);
}

// Nothing was launched: no proxy verdict exists to show, and inventing "no
// proxy" would be a claim about the session rather than about this window.
function renderProxyUnavailable() {
  $('#proxy-card').className = 'card';
  $('#proxy-icon').replaceChildren(ArgusIcons.make('circle', 16));
  $('#proxy-icon').classList.remove('spin');
  $('#proxy-title').textContent = 'No session details';
  $('#proxy-detail').textContent =
      'This window was not launched from Argus Launcher, so there is no proxy to report on.';
  renderProxyFields(null);
  $('#recheck').disabled = true;
  $('#recheck').title = 'Relaunch this profile from Argus Launcher to re-check its proxy.';
}

$('#recheck').addEventListener('click', () => {
  const button = $('#recheck');
  if (button.disabled) return;
  const icon = button.querySelector('.icon');
  button.disabled = true;
  icon.classList.add('spin');
  $('#proxy-icon').replaceChildren(ArgusIcons.make('loader', 16));
  $('#proxy-icon').classList.add('spin');
  $('#proxy-title').textContent = 'Checking proxy…';

  void (async () => {
    const result = await send({type: 'recheck-proxy'});
    button.disabled = false;
    icon.classList.remove('spin');
    if (!result.ok) {
      // A refused or unanswered request says nothing about the proxy itself, so
      // the panel goes back to what it knew rather than inventing a verdict it
      // does not have.
      if (session) renderProxy(session.proxy);
      setStatus(result.error || 'Could not re-check this proxy', true);
      return;
    }
    // The launcher recorded this check against the proxy row before answering,
    // so the Proxies tab and every other profile on it now agree with what the
    // panel is about to say. Kept on `session` so a later failed re-check falls
    // back to the fresh answer rather than to the launch-time one.
    const status = {
      ok: result.proxyOk, title: result.title, detail: result.detail, fields: result.fields,
    };
    if (session) session.proxy = status;
    renderProxy(status);
    setStatus(result.proxyOk ? 'Proxy re-checked' : 'Proxy re-checked — it is not working');
  })();
});

// ── Automations ────────────────────────────────────────────────────────────────
// Rows, not the start page's tiles: a 320px column fits one tile across, which
// is a list with extra steps. Built from the launch snapshot, so the panel can
// only ever offer what this launch was actually given.
function renderAutomations(automations) {
  const section = $('#automations-section');
  const list = $('#automation-list');
  list.replaceChildren();
  section.hidden = !automations || !automations.length;
  for (const automation of automations || []) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'automation';
    row.dataset.id = automation.id;
    row.dataset.state = 'idle';
    row.title = `Run ${automation.name}`;

    const icon = document.createElement('span');
    icon.className = 'icon';
    ArgusIcons.set(icon, 'play', 14);

    const label = document.createElement('span');
    label.className = 'label';
    label.textContent = automation.name;

    row.append(icon, label);
    list.appendChild(row);
  }
}

$('#automation-list').addEventListener('click', (event) => {
  const row = event.target.closest('button.automation');
  if (!row || row.dataset.state === 'running') return;
  const icon = row.querySelector('.icon');
  row.dataset.state = 'running';
  ArgusIcons.set(icon, 'loader', 14);
  icon.classList.add('spin');
  setStatus(`Starting ${row.querySelector('.label').textContent}…`);

  void (async () => {
    const result = await send({type: 'run-automation', automationId: row.dataset.id});
    icon.classList.remove('spin');
    ArgusIcons.set(icon, 'play', 14);
    row.dataset.state = result.ok ? 'done' : 'failed';
    setStatus(
        result.ok ?
          `Started ${row.querySelector('.label').textContent}` :
          (result.error || 'The launcher would not start that automation'),
        !result.ok);
    // Back to neutral: the tint says what the last click did, not what the
    // automation is doing now -- the launcher runs it out of this window's sight
    // and this panel is never told when it ends.
    setTimeout(() => { row.dataset.state = 'idle'; }, 4000);
  })();
});

// ── Cookie sync state -> plain-language card ────────────────────────────────────
// Priority order matters: a launcher that isn't reachable is worse news than
// "paused", which is worse news than "pending", which is worse news than "in
// sync". lastErrorKind is checked before paused/pushPending/inSync so a real
// unresolved failure never gets hidden behind a stale-looking green/amber
// state -- the badge can stay green while lastErrorKind is 'internal' because
// the badge only paints a handful of transport-level kinds, and this panel has
// room to say what actually happened for every kind background.js can persist.
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
    // The bug this whole feature exists to make visible -- keep it unmistakable
    // and say what to do about it, not just that it failed.
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

// Why every launcher-backed control is off, in one sentence naming the fix. A
// disabled button that does not say why reads as a broken button: three of them
// greyed out at once, with the card above saying only "Sync unavailable", left
// no way to tell a missing feature from a missing launcher.
const SYNC_BLOCKED_REASON =
  'Relaunch this profile from Argus Launcher to enable these. ' +
  'They each need a credential the Launcher hands out at launch, and this window did not get one.';

function renderSync(sync) {
  const state = classifySync(sync);
  $('#sync-card').className = `card tone-${state.tone}`;
  const icon = $('#sync-icon');
  icon.replaceChildren(ArgusIcons.make(state.icon, 16));
  icon.classList.toggle('spin', Boolean(state.spin));
  $('#sync-title').textContent = state.title;
  $('#sync-detail').textContent = state.detail;
  $('#sync-toggle').checked = !sync.paused;
  $('#sync-toggle').disabled = !sync.available;
  $('#sync-now').disabled = !sync.available;
  $('#pull').disabled = !sync.available;
  // Save-as goes over the same run-token route as sync, so it needs the same
  // "was this window launched from Argus Launcher" precondition -- unlike
  // sync-now/pull it does not also need inSync/paused, since it is not part of
  // the automatic loop.
  $('#save-as-toggle').disabled = !sync.available;

  const blocked = $('#sync-blocked');
  blocked.textContent = sync.available ? '' : SYNC_BLOCKED_REASON;
  blocked.hidden = Boolean(sync.available);
  // Also on the controls themselves: the note sits in the card at the top of
  // the section, and the buttons it explains are most of a screen away.
  const tip = sync.available ? '' : SYNC_BLOCKED_REASON;
  for (const id of ['#sync-now', '#pull', '#save-as-toggle']) {
    $(id).title = tip;
  }
  // The form can be left open across a refresh that revokes sync; collapsing it
  // keeps the panel from offering a Save that cannot succeed.
  if (!sync.available) closeSaveAsForm();
}

function renderSeed(seed) {
  const container = $('#seed-status');
  if (seed.imported) {
    ArgusIcons.set($('#seed-icon'), 'checkCircle', 14);
    const when = seed.seededAt ? ` on ${new Date(seed.seededAt).toLocaleDateString()}` : '';
    $('#seed-text').textContent =
        `${seed.seededCount} cookie${seed.seededCount === 1 ? '' : 's'} auto-imported${when}`;
    container.className = 'note-line seeded';
  } else {
    ArgusIcons.set($('#seed-icon'), 'circle', 14);
    $('#seed-text').textContent = 'No seed cookies for this profile';
    container.className = 'note-line';
  }
}

// The outcome of the last manual file import, named and kept on screen.
//
// As transient status-bar text this only ever said "Imported 7 of 7 cookies",
// which never named the file it came from and was gone the moment anything else
// set a status. Picking a file and getting no durable acknowledgement that names
// it is the difference between "it worked" and "did that do anything?".
function renderImportResult(result) {
  const container = $('#import-result');
  if (!result) {
    container.hidden = true;
    return;
  }
  const {fileName, imported, total, failed} = result;
  const ok = imported > 0 && !failed;
  ArgusIcons.set($('#import-result-icon'),
      ok ? 'checkCircle' : (imported ? 'alertTriangle' : 'xCircle'), 14);
  const counted = `${imported} of ${total} cookie${total === 1 ? '' : 's'}`;
  $('#import-result-text').textContent = failed ?
    `Imported ${counted} from “${fileName}” — ${failed} rejected` :
    `Imported ${counted} from “${fileName}”`;
  container.className = `note-line ${ok ? 'seeded' : 'failed'}`;
  container.hidden = false;
}

function renderCounts(counts) {
  $('#total-count').textContent = String(counts.total);
  // No siteDomain means the active tab isn't a real http(s) site (an internal
  // chrome:// or extension page) -- "0" there reads as "zero cookies on this
  // site", which overstates what is known. An em-dash says the count does not
  // apply, the same idea as background.js's empty-domain contract for this state.
  $('#site-count').textContent = counts.siteDomain ? String(counts.site) : '—';
  $('#site-label').textContent = counts.siteDomain || 'This site';
}

// Read by openSaveAsForm() for the prefilled default name.
let currentProfileName = '';

// The last manual import this panel performed, or null. Survives refresh()
// (which repaints everything) for as long as the panel is open.
let lastImport = null;

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
    renderImportResult(lastImport);
    return;
  }
  currentProfileName = (status.profile && status.profile.name) || '';
  renderSync(status.sync);
  renderSeed(status.seed);
  renderCounts(status.counts);
  renderImportResult(lastImport);
}

// The launch snapshot, read once: nothing in it changes while the window lives.
// The proxy verdict inside it does change, but only because the user asked for a
// re-check, which updates `session` in place.
async function loadSession() {
  const result = await send({type: 'get-session'});
  session = (result && result.session) || null;
  if (!session) {
    renderProxyUnavailable();
    renderAutomations([]);
    return;
  }
  // Unresolved on purpose: 'system' has to stay 'system' so prefers-color-scheme
  // keeps deciding, on a machine whose appearance can change while this panel is
  // open. See sidepanel.css's note on the two :root blocks.
  document.documentElement.dataset.theme = session.theme || 'system';
  if (session.profile && session.profile.name) {
    $('#profile-name').textContent = session.profile.name;
    document.title = `${session.profile.name} — Argus Panel`;
  }
  renderProxy(session.proxy);
  // Direct and free-proxy profiles have no assigned proxy to re-test, so the
  // button would be a control with nothing behind it.
  $('#recheck').disabled = !session.recheckable;
  if (!session.recheckable) {
    $('#recheck').title = 'This profile has no assigned proxy to re-check.';
  }
  renderAutomations(session.automations);
}

// ── Staying honest while open ───────────────────────────────────────────────────
// The panel outlives every event that used to justify a re-read. These three
// subscriptions are what keep a card from quietly describing a session that
// moved on hours ago.

// The sync engine persists every state transition through setSyncState, so this
// repaints off writes that already happen -- no polling, and no second copy of
// the state to keep level with the first.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.argysSyncState) void refresh();
});

// Debounced for the reason background.js documents: an idle jar fires two
// onChanged events per imported cookie, and a pull of a real set would otherwise
// repaint the counts several hundred times.
let countsTimer = 0;
chrome.cookies.onChanged.addListener(() => {
  if (countsTimer) clearTimeout(countsTimer);
  countsTimer = setTimeout(() => { countsTimer = 0; void refresh(); }, 400);
});

// "This site" is a property of the active tab, and this panel is global to the
// window: it outlives every tab the user opens under it.
chrome.tabs.onActivated.addListener(() => void refresh());
chrome.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
  if (changeInfo.url && tab.active) void refresh();
});

// ── Actions ─────────────────────────────────────────────────────────────────────
// Disables the button, swaps its icon for a spinner, and always restores both --
// even if `work` throws -- so a message-handler failure can never leave the panel
// with a stuck spinner.
async function withBusy(button, work) {
  const icon = button.querySelector('.icon');
  const original = icon ? icon.dataset.icon : null;
  button.disabled = true;
  if (icon) { ArgusIcons.set(icon, 'loader', 14); icon.classList.add('spin'); }
  try {
    await work();
  } finally {
    button.disabled = false;
    if (icon && original) { ArgusIcons.set(icon, original, 14); icon.classList.remove('spin'); }
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
    // Partial import: substantial progress was made, so this is not styled as a
    // hard error, but the failed count must still be visible -- silently
    // rounding a partial pull up to a full success is exactly the kind of
    // swallowed failure the sync rewrite exists to close.
    setStatus(`Loaded ${result.count} of ${result.count + result.failed} cookies from "${setName}" ` +
        `— ${result.failed} failed to import`);
  } else {
    setStatus(`Loaded ${result.count} cookies from "${setName}"`);
  }
  await refresh();
}));

// ---- save-as: inline expanding name field --------------------------------------
function defaultSaveAsName() {
  const date = new Date().toISOString().slice(0, 10);
  return currentProfileName ? `${currentProfileName} ${date}` : `Cookies ${date}`;
}

function openSaveAsForm() {
  $('#save-as-toggle').hidden = true;
  $('#save-as-hint').hidden = true;
  $('#save-as-form').hidden = false;
  const input = $('#save-as-name');
  input.value = defaultSaveAsName();
  input.focus();
  input.select();
}

function closeSaveAsForm() {
  $('#save-as-form').hidden = true;
  $('#save-as-toggle').hidden = false;
  $('#save-as-hint').hidden = false;
}

$('#save-as-toggle').addEventListener('click', openSaveAsForm);
$('#save-as-cancel').addEventListener('click', () => closeSaveAsForm());
$('#save-as-form').addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    event.preventDefault();
    closeSaveAsForm();
  }
});
// The name input's Enter submits the form natively; this only handles the async
// work and reporting, the same withBusy/setStatus contract every other action
// here follows -- no action may leave the form stuck mid-request with nothing
// said.
$('#save-as-form').addEventListener('submit', (event) => {
  event.preventDefault();
  void withBusy($('#save-as-confirm'), async () => {
    const name = $('#save-as-name').value.trim();
    // Answered here rather than by a round trip, so the one failure the user can
    // actually fix says so immediately and points at the field.
    if (!name) {
      setStatus('Enter a name for this cookie set first.', true);
      $('#save-as-name').focus();
      return;
    }
    setStatus('Saving to Cookies tab…');
    const result = await send({type: 'save-as-set', name});
    if (result.ok) {
      setStatus(`Saved ${result.saved} cookies to "${result.set}"`);
      closeSaveAsForm();
    } else {
      // Left open on failure (an unreachable launcher, a jar the launcher did
      // not recognize) so the user can retry without re-opening the form and
      // losing what they typed. background.js's saveAsSet returns a specific
      // reason for every failure it can produce; the fallback only covers a
      // reply that somehow carried none, and still says what to try.
      setStatus(result.error ||
          'Could not save to the Cookies tab. Relaunch this profile from Argus Launcher and try again.',
      true);
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
      // send() itself failed (background unreachable) -- result.count is absent,
      // unlike a normal import-cookies reply which always has one.
      throw new Error(result.error);
    }
    const failed = result.failed || 0;
    const imported = result.count || 0;
    lastImport = {fileName: file.name, imported, total: cookies.length, failed};
    setStatus(`Imported ${imported} of ${cookies.length} cookies` + (failed ? ` — ${failed} failed` : ''),
        failed > 0 && !imported);
    // refresh() repaints the whole panel, so the durable line is rendered from
    // lastImport inside it rather than here -- otherwise this would be undone
    // one line later.
    await refresh();
  } catch (error) {
    lastImport = {fileName: file.name, imported: 0, total: 0, failed: 0, error: true};
    renderImportResult(null);
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

void loadSession();
void refresh();
