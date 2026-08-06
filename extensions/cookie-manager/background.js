importScripts('cookie-format.js');

const SEED_IMPORTED_KEY = 'argysSeedCookiesImported';
const SEED_SIGNATURE_KEY = 'argysSeedCookiesSignature';
const SYNC_STATE_KEY = 'argysSyncState';

// ---- push cadence -----------------------------------------------------------
// run-token.cjs's COOKIE_RATE allows 12 pushes/token/minute with a sliding 60s
// window. PUSH_DEBOUNCE_MS alone only coalesces bursts closer together than
// itself; changes spaced further apart (ad/analytics/session-refresh churn is
// routinely 3-5s apart) would each fire their own push and can reach the cap.
// PUSH_MIN_INTERVAL_MS is a floor under the debounce for exactly that case,
// with enough headroom (10/min) that a manual "Sync now" click or two never
// tips it over. PUSH_RETRY_DELAY_MS/PUSH_RATE_LIMIT_RETRY_DELAY_MS back a
// single bounded retry after an automatic push fails outright -- see
// `retryQueued` below for how that stays bounded rather than a hot loop.
const PUSH_DEBOUNCE_MS = 3000;
const PUSH_MIN_INTERVAL_MS = 6000;
const PUSH_RETRY_DELAY_MS = 10000;
const PUSH_RATE_LIMIT_RETRY_DELAY_MS = 65000;

function reportUnhandled(context) {
  return (error) => console.error(`Argus cookie sync: ${context} failed`, error);
}

async function hashText(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

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
// next event wakes a fresh instance with no memory of what this one was doing.
//
//   reachable       true unless the last launcher round trip's fetch() itself
//                    threw (nothing was listening). An HTTP error status
//                    (403/429/5xx) still counts as reachable:true -- the
//                    launcher answered, it just refused or rejected.
//   lastErrorKind    '' | 'network' | 'refused' | 'server-error' |
//                    'rate-limited' | 'saved-none' | 'import-failed' |
//                    'internal'. 'network' is the only kind that pairs with
//                    reachable:false; the rest are answered rejections of
//                    one shape or another. 'refused' (HTTP 403, "Not
//                    allowed") is specifically a dead/invalid run token;
//                    'server-error' is everything else non-2xx (5xx, or an
//                    unparseable body) and says nothing about the token.
//   lastErrorSource  '' | 'push' | 'pull' -- which operation produced
//                    lastError/lastErrorKind, since both share these fields.
//   signature        SHA-256 hex digest of ArgusCookieFormat.jarSignature(),
//                    not the raw tab-separated dump: that string is
//                    hundreds of KB for a real jar and this is rewritten on
//                    close to every cookie change. Opaque outside this file;
//                    only ever compared for equality.
//   pushTokenHash    SHA-256 hex digest of the run token signature/inSync
//                    above were captured under. A fresh token is minted every
//                    launch but this record's directory (and its storage)
//                    survives into the next one; compared against the current
//                    token on every push so a stale watermark from a
//                    previous launch can never short-circuit a real push.
//   lastAttemptAt    epoch ms of the last actual network push attempt (not
//                    the time it was scheduled); backs PUSH_MIN_INTERVAL_MS.
//   lastSet          name of the cookie set the last successful push/pull
//                    touched, so the popup can say where a push landed.
const DEFAULT_SYNC = {
  available: false, paused: false, inSync: false, reachable: true,
  pushedAt: 0, pushedCount: 0, lastError: '', lastErrorKind: '', lastErrorSource: '',
  signature: '', pushTokenHash: '', pushPending: false, lastAttemptAt: 0, lastSet: '',
};

async function getSyncState() {
  const stored = await chrome.storage.local.get(SYNC_STATE_KEY);
  return {...DEFAULT_SYNC, ...(stored[SYNC_STATE_KEY] || {})};
}

// Writes are serialized through one promise chain rather than each doing its
// own get-then-set: two overlapping calls (e.g. schedulePush's fire-and-forget
// `pushPending:true` landing mid-flight of a push's terminal patch) would
// otherwise both read the same "before" state and the later set() would
// silently discard whatever the earlier one wrote. The chain link that fails
// is still reported to ITS caller (the returned promise rejects normally);
// only the shared `syncStateChain` itself is normalized back to resolved so
// one bad write cannot wedge every write after it.
let syncStateChain = Promise.resolve();

function setSyncState(patch) {
  const result = syncStateChain.then(async () => {
    const next = {...await getSyncState(), ...patch};
    await chrome.storage.local.set({[SYNC_STATE_KEY]: next});
    await updateBadge(next);
    return next;
  });
  syncStateChain = result.catch(() => undefined);
  return result;
}

// ---- badge -----------------------------------------------------------------
// One glance at the toolbar answers "did my session make it to the launcher".
// reachable:false, lastErrorKind:'refused', and lastErrorKind:'rate-limited'
// are kept visually distinct (Important 3): a dead token, a live-but-refused
// server error, and a throttled-but-self-clearing connection are all very
// different from the launcher process not answering at all, and collapsing
// them into one red bang was actively misleading for the one class of bug
// this whole feature exists to fix (a stale/expired run token).
//
// The '×' glyph specifically means "your run token looks dead" -- gated on
// lastErrorSource === 'push' so a pull failure (e.g. loadEntries throwing,
// answered as its own HTTP 500 "server-error") can never paint it. A pull
// hitting a genuine 403 does still leave `refused` in lastError text for the
// popup to read, it just does not drive this specific glyph, which is
// documented as describing push sync status. 'server-error' (any 5xx, or an
// unparseable body) never gets a dedicated glyph on either path -- it falls
// through to pending/inSync, same as the app-level kinds below.
async function updateBadge(sync) {
  const state = sync || await getSyncState();
  let text = '';
  let color = '#1a7f3c';
  if (state.available && !state.paused) {
    if (!state.reachable) {
      text = '!';
      color = '#d53c32';
    } else if (state.lastErrorKind === 'refused' && state.lastErrorSource === 'push') {
      text = '×';
      color = '#d53c32';
    } else if (state.lastErrorKind === 'rate-limited') {
      text = '⏱';
      color = '#b45309';
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

// ---- launcher round trip -----------------------------------------------------
// Shared by push and pull so both classify failures the same way (Important
// 1 and 3): a thrown fetch (nothing answered) is 'network'. A response that
// parses but carries status:false or a non-2xx is split three ways by status
// code: 429 is 'rate-limited' (self-clearing, unlike a dead token); 403 is
// 'refused', run-token.cjs's one and only "Not allowed" refusal, i.e.
// specifically a dead/invalid/expired run token; everything else (5xx, or a
// 200 whose body would not parse) is 'server-error' and says nothing about
// the token -- run-token.cjs's own work() failures (a dead proxy, a
// renderer-side throw like loadEntries) surface as exactly this, not as 403.
function classifyStatus(status) {
  if (status === 429) return 'rate-limited';
  if (status === 403) return 'refused';
  return 'server-error';
}

async function fetchLauncher(url, payload) {
  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(payload),
    });
  } catch (error) {
    return {ok: false, kind: 'network', message: error && error.message ? error.message : String(error)};
  }
  let body;
  try {
    body = await response.json();
  } catch {
    return {
      ok: false, kind: classifyStatus(response.status),
      message: `Launcher answered HTTP ${response.status} with a response that could not be parsed.`,
    };
  }
  if (response.ok && body && body.status) {
    return {ok: true, body};
  }
  return {
    ok: false,
    kind: classifyStatus(response.status),
    message: (body && body.msg) || `Launcher answered HTTP ${response.status}`,
  };
}

// ---- push (browser -> launcher) --------------------------------------------
async function pushToLauncher(opts) {
  const manual = Boolean(opts && opts.manual);
  try {
    const config = await launchConfig();
    if (!config) {
      await setSyncState({available: false, pushPending: false});
      return {ok: false, error: 'This window was not launched from Argus Launcher.'};
    }
    let state = await setSyncState({available: true});

    // A fresh run token is minted every launch, but this state record's
    // storage survives into the next one (Important 8). If the token this
    // watermark was captured under does not match the current launch's, the
    // watermark cannot be trusted -- it may describe a set that was deleted
    // or reassigned since. Reset before the unchanged-shortcut below ever
    // gets a chance to read it.
    const tokenHash = await hashText(config.token);
    if (state.pushTokenHash !== tokenHash) {
      state = await setSyncState({inSync: false, signature: '', pushTokenHash: tokenHash});
    }

    if (!manual && state.paused) {
      await setSyncState({pushPending: false});
      return {ok: false, error: 'Sync is paused.'};
    }

    if (!manual && state.lastAttemptAt) {
      const elapsed = Date.now() - state.lastAttemptAt;
      // A negative elapsed value only happens if the system clock moved
      // backwards (NTP correction) -- treat that as "the floor is already
      // satisfied" rather than computing a wait as large as the rollback
      // itself, which would otherwise recompute identically (blocking
      // automatic sync for the rollback's whole duration) on every re-entry.
      if (elapsed >= 0 && elapsed < PUSH_MIN_INTERVAL_MS) {
        queuePush(Math.min(PUSH_MIN_INTERVAL_MS - elapsed, PUSH_MIN_INTERVAL_MS));
        return {ok: false, error: 'Waiting for the minimum interval between pushes.'};
      }
    }

    const cookies = await chrome.cookies.getAll({});
    const signature = await hashText(ArgusCookieFormat.jarSignature(cookies));
    // The shortcut requires a clean last attempt, not just a matching
    // signature: skipping the fetch while an unresolved lastErrorKind sits in
    // state would let a transient failure (network blip, a 5xx) stick
    // forever once the jar goes quiet, since nothing would ever run the real
    // request that could clear it.
    if (!manual && state.inSync && state.signature === signature && !state.lastErrorKind) {
      await setSyncState({pushPending: false});
      return {ok: true, unchanged: true};
    }

    await setSyncState({lastAttemptAt: Date.now()});
    const result = await fetchLauncher(
        `http://127.0.0.1:${config.apiPort}/v1/cookies/push-from-profile`,
        {runToken: config.token, cookies});

    if (!result.ok) {
      await setSyncState({
        reachable: result.kind !== 'network', pushPending: false,
        lastError: result.message, lastErrorKind: result.kind, lastErrorSource: 'push',
      });
      // Retries are only for the automatic path -- a manual failure must not
      // arm or disarm that bookkeeping, or an interleaved manual click could
      // let the "single" retry budget re-charge indefinitely.
      if (!manual) queueRetry(result.kind);
      return {ok: false, error: result.message};
    }
    retryQueued = false;

    const saved = Number(result.body.saved) || 0;
    // useAutomationBridge.ts refuses to persist a push that normalizes to
    // zero cookies (guards against wiping a saved set from a transient empty
    // jar) and answers 200 {status:true, saved:0} for it -- indistinguishable
    // from a real success by status code alone. Treating that as synced would
    // advance the watermark past a jar that was never actually saved, and a
    // later push of the *same* jar would then be skipped as "unchanged"
    // forever. Only a genuinely empty local jar (nothing was ever going to be
    // saved) is allowed to count as in sync.
    if (saved === 0 && cookies.length > 0) {
      const message = 'Launcher did not save the pushed cookies (none were recognizable).';
      await setSyncState({
        reachable: true, inSync: false, pushPending: false,
        lastError: message, lastErrorKind: 'saved-none', lastErrorSource: 'push',
      });
      return {ok: false, error: message};
    }
    await setSyncState({
      reachable: true, inSync: true, signature, pushPending: false,
      pushedAt: Date.now(), pushedCount: saved, lastError: '', lastErrorKind: '', lastErrorSource: '',
      lastSet: result.body.set || '',
    });
    return {ok: true, count: saved, set: result.body.set || undefined};
  } catch (error) {
    // Nothing above this point (config/state lookups, chrome.cookies.getAll,
    // hashing) was inside a catch -- a throw there used to escape as an
    // unhandled rejection from the fire-and-forget `void pushToLauncher()`
    // callers, leaving `pushPending:true` stuck with no lastError to explain
    // it. Wrapping the whole body closes that.
    const message = error && error.message ? error.message : String(error);
    console.error('Argus cookie sync: push crashed', error);
    await setSyncState({
      pushPending: false, lastError: message, lastErrorKind: 'internal', lastErrorSource: 'push',
    }).catch(reportUnhandled('persisting push crash state'));
    return {ok: false, error: message};
  }
}

// A single bounded retry after an automatic push fails outright -- not a
// backoff sequence, exactly one attempt (Important 4), so it can never become
// a hot loop: `retryQueued` blocks a second retry from being queued off the
// first retry's own failure, and any genuine cookie change (schedulePush)
// clears it, since a real change deserves its own fresh attempt rather than
// counting against this budget.
let retryQueued = false;

function queueRetry(kind) {
  if (retryQueued) {
    // This failure WAS the retry attempt, and it failed too: stop here
    // rather than queue another, and wait for the next real cookies.onChanged
    // (schedulePush resets this flag) instead of looping.
    retryQueued = false;
    return;
  }
  retryQueued = true;
  queuePush(kind === 'rate-limited' ? PUSH_RATE_LIMIT_RETRY_DELAY_MS : PUSH_RETRY_DELAY_MS);
  void setSyncState({pushPending: true}).catch(reportUnhandled('marking retry pending'));
}

let pushTimer = 0;

function queuePush(delayMs) {
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    pushTimer = 0;
    void pushToLauncher().catch(reportUnhandled('automatic push'));
  }, delayMs);
}

function schedulePush() {
  // Only write when the flag is actually changing: an idle jar generates two
  // onChanged events per imported cookie, and re-persisting the same
  // multi-field state record (Important 6) on every single one of them for no
  // observable change is the write-volume problem, not just the signature
  // field's size.
  if (!pushTimer) void setSyncState({pushPending: true}).catch(reportUnhandled('marking push pending'));
  retryQueued = false;
  queuePush(PUSH_DEBOUNCE_MS);
}

// ---- pull (launcher -> browser) --------------------------------------------
async function pullFromLauncher() {
  try {
    const config = await launchConfig();
    if (!config) {
      return {ok: false, error: 'This window was not launched from Argus Launcher.'};
    }
    const result = await fetchLauncher(
        `http://127.0.0.1:${config.apiPort}/v1/cookies/pull-for-profile`,
        {runToken: config.token});
    if (!result.ok) {
      // Persisted the same way a push failure is (Important 1): closing the
      // popup used to make a 403/429/dead-connection on pull evaporate
      // entirely while the badge kept showing whatever it showed before.
      await setSyncState({
        reachable: result.kind !== 'network',
        lastError: result.message, lastErrorKind: result.kind, lastErrorSource: 'pull',
      });
      return {ok: false, error: result.message};
    }

    const cookies = Array.isArray(result.body.cookies) ? result.body.cookies : [];
    if (!cookies.length) {
      await setSyncState({
        reachable: true, lastError: '', lastErrorKind: '', lastErrorSource: '',
        lastSet: result.body.set || '',
      });
      return {ok: true, count: 0, failed: 0, set: result.body.set || null};
    }

    const imported = await importCookies(cookies);
    if (imported.count === 0) {
      // Distinct from "the launcher had nothing for you" above: this is
      // "the launcher answered with N cookies and every single one of them
      // failed to apply", which used to come back as the identical
      // {ok:true,count:0} (Important 2).
      const message = `None of the ${cookies.length} cookies from the launcher could be applied to this browser.`;
      await setSyncState({
        reachable: true, lastError: message, lastErrorKind: 'import-failed', lastErrorSource: 'pull',
      });
      return {ok: false, count: 0, failed: imported.failed, set: result.body.set || null, error: message};
    }
    await setSyncState({
      reachable: true, lastError: '', lastErrorKind: '', lastErrorSource: '',
      lastSet: result.body.set || '',
    });
    // A partial failure (some cookies applied, some did not) is surfaced via
    // `failed` on an otherwise-ok response rather than treated as a state
    // error: the pull did substantially work, unlike the all-failed case
    // above.
    return {ok: true, count: imported.count, failed: imported.failed, set: result.body.set || null};
  } catch (error) {
    const message = error && error.message ? error.message : String(error);
    console.error('Argus cookie sync: pull crashed', error);
    await setSyncState({
      lastError: message, lastErrorKind: 'internal', lastErrorSource: 'pull',
    }).catch(reportUnhandled('persisting pull crash state'));
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
    if (!tab || !tab.url) return '';
    const url = new URL(tab.url);
    // Only http(s) tabs are "a site" with a cookie-bearing domain -- a
    // chrome://, chrome-extension://, about:, or file: active tab (this
    // popup's own extension page counts, since chrome.tabs.query can return
    // it) has a hostname too, but showing that hostname read as "the site"
    // in the popup instead surfaced this extension's own ID.
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.hostname : '';
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

// Returns both how many cookies actually made it into the browser and how
// many did not (a raw entry that failed to normalize counts the same as one
// chrome.cookies.set rejected): a caller that only reads `count` must not be
// able to mistake "500 sent, 500 failed" for "the source had nothing"
// (Important 2).
async function importCookies(rawCookies) {
  let imported = 0;
  let failed = 0;
  for (const raw of rawCookies) {
    const cookie = ArgusCookieFormat.normalizeCookie(raw);
    if (!cookie) {
      failed++;
      continue;
    }
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
      failed++;
      console.warn('Argus cookie import failed', cookie.domain, cookie.name, error);
    }
  }
  return {count: imported, failed};
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
          const paused = Boolean(message.paused);
          await setSyncState({paused});
          if (!paused) {
            // Changes made while paused had nowhere to go and the next
            // automatic trigger could be arbitrarily far off -- unpausing
            // has to be a trigger itself (Important 11).
            void pushToLauncher().catch(reportUnhandled('push after unpause'));
          }
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
          const result = await importCookies(cookies);
          sendResponse({count: result.count, failed: result.failed});
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
      const errorMessage = error && error.message ? error.message : String(error);
      console.error('Argus cookie sync: message handler failed', message && message.type, error);
      sendResponse({ok: false, error: errorMessage});
    }
  })();
  return true;
});

// ---- per-profile auto-seed on first launch ---------------------------------
// Unchanged contract from v1: electron bundles seed-cookies.json only when the
// profile has a cookie source assigned; imported once per signature.
async function importSeedCookiesIfPresent() {
  let response;
  try {
    response = await fetch(chrome.runtime.getURL('seed-cookies.json'));
  } catch {
    // No seed-cookies.json bundled for this profile -- nothing to seed, the
    // normal case for a profile with no cookie source assigned.
    return;
  }
  if (!response.ok) return;
  let payload;
  try {
    payload = await response.json();
  } catch (error) {
    // The file exists but is not valid JSON, unlike the two returns above:
    // that is a packaging bug, not "nothing to seed", and silently dropping
    // every seed cookie here would be indistinguishable from the normal case.
    console.error('Argus cookie sync: seed-cookies.json is present but could not be parsed', error);
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

chrome.runtime.onInstalled.addListener(() =>
  void importSeedCookiesIfPresent().catch(reportUnhandled('seed import (onInstalled)')));
chrome.runtime.onStartup.addListener(() =>
  void importSeedCookiesIfPresent().catch(reportUnhandled('seed import (onStartup)')));
void importSeedCookiesIfPresent().catch(reportUnhandled('seed import (initial)'));
chrome.cookies.onChanged.addListener(() => schedulePush());
void pushToLauncher().catch(reportUnhandled('initial push'));
