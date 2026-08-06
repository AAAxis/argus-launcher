importScripts('cookie-format.js');

const SEED_IMPORTED_KEY = 'argysSeedCookiesImported';
const SEED_SIGNATURE_KEY = 'argysSeedCookiesSignature';
const SYNC_STATE_KEY = 'argysSyncState';

// ---- launch config ---------------------------------------------------------
// argus-launch.json is written per launch by built-in-extensions.cjs and only
// when the launcher minted a run token. Absent file => the extension is
// running outside a profile launch (or minting failed): sync is shown as
// unavailable, everything else still works.
async function launchConfig() {
  try {
    const response = await fetch(chrome.runtime.getURL('argus-launch.json'));
    if (!response.ok) return null;
    const parsed = await response.json();
    return parsed.token && parsed.apiPort ? parsed : null;
  } catch {
    return null;
  }
}

async function profileMeta() {
  try {
    const response = await fetch(chrome.runtime.getURL('profile-meta.json'));
    if (!response.ok) return {};
    return await response.json();
  } catch {
    return {};
  }
}

// ---- sync state --------------------------------------------------------------
// Everything the badge and popup need lives here, not in module-scope
// variables: a service worker can be evicted between any two lines, and the
// next event wakes a fresh instance with no memory of what this one was
// doing. `pushPending` is part of this record (not the brief's module-scope
// `pushTimer`) specifically so a badge repaint after eviction is still
// correct -- see updateBadge().
const DEFAULT_SYNC = {
  available: false, paused: false, inSync: false, reachable: true,
  pushedAt: 0, pushedCount: 0, lastError: '', signature: '', pushPending: false,
};

async function getSyncState() {
  const stored = await chrome.storage.local.get(SYNC_STATE_KEY);
  return {...DEFAULT_SYNC, ...(stored[SYNC_STATE_KEY] || {})};
}

async function setSyncState(patch) {
  const next = {...await getSyncState(), ...patch};
  await chrome.storage.local.set({[SYNC_STATE_KEY]: next});
  await updateBadge(next);
  return next;
}

// ---- badge -----------------------------------------------------------------
// One glance at the toolbar answers "did my session make it to the launcher":
// green check in sync, amber dots push pending, red bang launcher unreachable,
// nothing when sync is paused or unavailable. Reads `state.pushPending` from
// storage rather than a module-scope timer flag -- a fresh worker instance
// (after eviction) has no timer to read, but does have the persisted state.
async function updateBadge(sync) {
  const state = sync || await getSyncState();
  let text = '';
  let color = '#1a7f3c';
  if (state.available && !state.paused) {
    if (!state.reachable) {
      text = '!';
      color = '#d53c32';
    } else if (state.pushPending) {
      text = '…';
      color = '#b45309';
    } else if (state.inSync) {
      text = '✓';
      color = '#1a7f3c';
    }
  }
  try {
    await chrome.action.setBadgeText({text});
    await chrome.action.setBadgeBackgroundColor({color});
  } catch (error) {
    // Badge is decoration; never let it fail a sync. Still logged (not a bare
    // catch) so a broken action API is not invisible.
    console.error('Argus cookie sync: failed to update badge', error);
  }
}

// ---- push (browser -> launcher) --------------------------------------------
async function pushToLauncher({manual = false} = {}) {
  const config = await launchConfig();
  if (!config) {
    await setSyncState({available: false, pushPending: false});
    return {ok: false, error: 'This window was not launched from Argus Launcher.'};
  }
  const state = await setSyncState({available: true});
  if (!manual && state.paused) {
    await setSyncState({pushPending: false});
    return {ok: false, error: 'Sync is paused.'};
  }
  const cookies = await chrome.cookies.getAll({});
  const signature = ArgusCookieFormat.jarSignature(cookies);
  if (!manual && state.inSync && state.signature === signature) {
    await setSyncState({pushPending: false});
    return {ok: true, unchanged: true};
  }
  try {
    const response = await fetch(
        `http://127.0.0.1:${config.apiPort}/v1/cookies/push-from-profile`, {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({runToken: config.token, cookies}),
        });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || !body.status) {
      throw new Error(body.msg || `Launcher answered HTTP ${response.status}`);
    }
    const saved = Number(body.saved) || 0;
    // useAutomationBridge.ts refuses to persist a push that normalizes to zero
    // cookies (guards against wiping a saved set from a transient empty jar)
    // and answers 200 {status:true, saved:0} for it -- indistinguishable from
    // a real success by status code alone. Treating that as synced would
    // advance the watermark past a jar that was never actually saved, and a
    // later push of the *same* jar would then be skipped as "unchanged"
    // forever. Only a genuinely empty local jar (nothing was ever going to be
    // saved) is allowed to count as in sync.
    if (saved === 0 && cookies.length > 0) {
      const message = 'Launcher did not save the pushed cookies (none were recognizable).';
      await setSyncState({
        reachable: true, inSync: false, pushPending: false, lastError: message,
      });
      return {ok: false, error: message};
    }
    await setSyncState({
      reachable: true, inSync: true, signature, pushPending: false,
      pushedAt: Date.now(), pushedCount: saved, lastError: '',
    });
    return {ok: true, count: saved};
  } catch (error) {
    const message = error && error.message ? error.message : String(error);
    await setSyncState({reachable: false, inSync: false, pushPending: false, lastError: message});
    return {ok: false, error: message};
  }
}

let pushTimer = 0;

function schedulePush() {
  if (pushTimer) clearTimeout(pushTimer);
  // Persisted immediately, not just held in `pushTimer`: if the worker is
  // evicted before the timer fires, a fresh instance's badge still needs to
  // read "push pending" correctly, and pushToLauncher() always clears this
  // flag on every exit path so it can never get stuck true.
  void setSyncState({pushPending: true});
  pushTimer = setTimeout(() => {
    pushTimer = 0;
    void pushToLauncher();
  }, 3000);
}

// ---- pull (launcher -> browser) --------------------------------------------
async function pullFromLauncher() {
  const config = await launchConfig();
  if (!config) {
    return {ok: false, error: 'This window was not launched from Argus Launcher.'};
  }
  try {
    const response = await fetch(
        `http://127.0.0.1:${config.apiPort}/v1/cookies/pull-for-profile`, {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({runToken: config.token}),
        });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || !body.status) {
      throw new Error(body.msg || `Launcher answered HTTP ${response.status}`);
    }
    const cookies = Array.isArray(body.cookies) ? body.cookies : [];
    if (!cookies.length) {
      return {ok: true, count: 0, set: body.set || null};
    }
    const result = await importCookies(cookies);
    return {ok: true, count: result.count, set: body.set || null};
  } catch (error) {
    const message = error && error.message ? error.message : String(error);
    return {ok: false, error: message};
  }
}

// ---- import / export -------------------------------------------------------
function downloadFile(filename, text, mime) {
  const url = `data:${mime};charset=utf-8,${encodeURIComponent(text)}`;
  return chrome.downloads.download({url, filename, saveAs: true});
}

async function currentSiteDomain() {
  const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
  try {
    return tab && tab.url ? new URL(tab.url).hostname : '';
  } catch {
    return '';
  }
}

async function exportCookies(scope, format) {
  const domain = scope === 'site' ? await currentSiteDomain() : '';
  if (scope === 'site' && !domain) return {count: 0};
  const cookies = await chrome.cookies.getAll(domain ? {domain} : {});
  if (!cookies.length) return {count: 0};
  const meta = await profileMeta();
  const stem = (meta.name || domain || 'argus-cookies')
      .replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '') || 'argus-cookies';
  if (format === 'netscape') {
    await downloadFile(`${stem}-cookies.txt`,
        ArgusCookieFormat.toNetscapeCookies(cookies), 'text/plain');
  } else {
    await downloadFile(`${stem}-cookies.json`,
        ArgusCookieFormat.toCookieJson(cookies), 'application/json');
  }
  return {count: cookies.length};
}

function cookieUrl(cookie) {
  if (cookie.url) return cookie.url;
  const domain = String(cookie.domain || '').replace(/^\./, '');
  const path = cookie.path || '/';
  return `${cookie.secure ? 'https' : 'http'}://${domain}${path}`;
}

async function importCookies(rawCookies) {
  let imported = 0;
  for (const raw of rawCookies) {
    const cookie = ArgusCookieFormat.normalizeCookie(raw);
    if (!cookie) continue;
    try {
      const details = {
        url: cookieUrl(cookie),
        name: cookie.name,
        value: cookie.value,
        path: cookie.path,
        secure: cookie.secure,
        httpOnly: cookie.httpOnly,
        sameSite: cookie.sameSite,
      };
      if (cookie.domain) details.domain = cookie.domain;
      if (cookie.expirationDate) details.expirationDate = cookie.expirationDate;
      await chrome.cookies.set(details);
      imported++;
    } catch (error) {
      console.warn('Argus cookie import failed', cookie.domain, cookie.name, error);
    }
  }
  return {count: imported};
}

// ---- status for the popup --------------------------------------------------
async function statusForPopup() {
  const [meta, sync, seedState, all, siteDomain] = await Promise.all([
    profileMeta(),
    getSyncState(),
    chrome.storage.local.get([SEED_IMPORTED_KEY, 'seededAt', 'seededCount']),
    chrome.cookies.getAll({}),
    currentSiteDomain(),
  ]);
  const site = siteDomain ? await chrome.cookies.getAll({domain: siteDomain}) : [];
  const config = await launchConfig();
  return {
    profile: meta.id ? {id: meta.id, name: meta.name || ''} : null,
    sync: {...sync, available: Boolean(config)},
    seed: {
      imported: Boolean(seedState[SEED_IMPORTED_KEY]),
      seededAt: seedState.seededAt || 0,
      seededCount: seedState.seededCount || 0,
    },
    counts: {total: all.length, site: site.length, siteDomain},
  };
}

// ---- messages --------------------------------------------------------------
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  void (async () => {
    try {
      switch (message && message.type) {
        case 'get-status':
          sendResponse(await statusForPopup());
          return;
        case 'sync-now':
          sendResponse(await pushToLauncher({manual: true}));
          return;
        case 'set-paused': {
          await setSyncState({paused: Boolean(message.paused)});
          sendResponse({ok: true});
          return;
        }
        case 'pull-from-launcher':
          sendResponse(await pullFromLauncher());
          return;
        case 'export-cookies':
          sendResponse(await exportCookies(message.scope, message.format));
          return;
        case 'import-cookies': {
          const cookies = Array.isArray(message.cookies) ? message.cookies :
            Array.isArray(message.cookies && message.cookies.cookies) ?
              message.cookies.cookies : [];
          sendResponse(await importCookies(cookies));
          return;
        }
        default:
          sendResponse({ok: false, error: 'Unknown message'});
      }
    } catch (error) {
      // A handler throwing here (rather than returning an error shape) would
      // leave sendResponse uncalled and the popup's await hanging forever with
      // nothing on screen -- the same class of silent failure this rewrite
      // exists to close, just one layer up from the network calls.
      const message2 = error && error.message ? error.message : String(error);
      console.error('Argus cookie sync: message handler failed', message && message.type, error);
      sendResponse({ok: false, error: message2});
    }
  })();
  return true;
});

// ---- per-profile auto-seed on first launch ---------------------------------
// Unchanged contract from v1: electron bundles seed-cookies.json only when the
// profile has a cookie source assigned; imported once per signature.
async function importSeedCookiesIfPresent() {
  let payload;
  try {
    const response = await fetch(chrome.runtime.getURL('seed-cookies.json'));
    if (!response.ok) return;
    payload = await response.json();
  } catch {
    return;
  }
  const cookies = Array.isArray(payload) ? payload :
    Array.isArray(payload && payload.cookies) ? payload.cookies : [];
  const signature = ArgusCookieFormat.jarSignature(cookies);
  const state = await chrome.storage.local.get([SEED_IMPORTED_KEY, SEED_SIGNATURE_KEY]);
  if (state[SEED_IMPORTED_KEY] && state[SEED_SIGNATURE_KEY] === signature) return;
  const result = await importCookies(cookies);
  if (!result.count) return;
  await chrome.storage.local.set({
    [SEED_IMPORTED_KEY]: true,
    [SEED_SIGNATURE_KEY]: signature,
    seededAt: Date.now(),
    seededCount: result.count,
  });
}

chrome.runtime.onInstalled.addListener(() => void importSeedCookiesIfPresent());
chrome.runtime.onStartup.addListener(() => void importSeedCookiesIfPresent());
void importSeedCookiesIfPresent();
chrome.cookies.onChanged.addListener(() => schedulePush());
void pushToLauncher();
