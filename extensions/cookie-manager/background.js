async function currentTab() {
  const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
  return tab || null;
}

function downloadJson(filename, payload) {
  const json = JSON.stringify(payload, null, 2);
  const url = `data:application/json;charset=utf-8,${encodeURIComponent(json)}`;
  return chrome.downloads.download({url, filename, saveAs: true});
}

function domainFromUrl(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

async function exportCurrentSiteCookies() {
  const tab = await currentTab();
  const domain = tab?.url ? domainFromUrl(tab.url) : '';
  if (!domain) {
    return {count: 0};
  }
  const cookies = await chrome.cookies.getAll({domain});
  const safeName = domain.replace(/[^a-z0-9.-]+/gi, '-');
  await downloadJson(`argys-cookies-${safeName}.json`, {
    exportedAt: new Date().toISOString(),
    scope: 'current-site',
    domain,
    cookies,
  });
  return {count: cookies.length};
}

async function exportAllCookies() {
  // No domain filter: every cookie in this profile, across every site.
  const cookies = await chrome.cookies.getAll({});
  await downloadJson('argys-cookies-all.json', {
    exportedAt: new Date().toISOString(),
    scope: 'all',
    cookies,
  });
  return {count: cookies.length};
}

async function profileMeta() {
  try {
    const response = await fetch(chrome.runtime.getURL('profile-meta.json'));
    if (!response.ok) {
      return {};
    }
    return await response.json();
  } catch {
    return {};
  }
}

async function pushLocalCookiesToLauncher() {
  const meta = await profileMeta();
  if (!meta.id) {
    return;
  }
  const cookies = await chrome.cookies.getAll({});
  const signature = seedSignature(cookies);
  const state = await chrome.storage.local.get(PUSH_SIGNATURE_KEY);
  if (state[PUSH_SIGNATURE_KEY] === signature) {
    return;
  }
  try {
    const response = await fetch('http://127.0.0.1:39219/v1/cookies/push-local', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        profileId: meta.id,
        profileName: meta.name || '',
        cookies,
      }),
    });
    if (response.ok) {
      await chrome.storage.local.set({
        [PUSH_SIGNATURE_KEY]: signature,
        pushedAt: Date.now(),
        pushedCount: cookies.length,
      });
    }
  } catch (error) {
    console.warn('Argus local cookie migration failed', error);
  }
}

let pushTimer = 0;

function scheduleCookieCloudSync() {
  if (pushTimer) {
    clearTimeout(pushTimer);
  }
  pushTimer = setTimeout(() => {
    pushTimer = 0;
    void pushLocalCookiesToLauncher();
  }, 3000);
}

function cookieUrl(cookie) {
  if (cookie.url) {
    return cookie.url;
  }
  const domain = String(cookie.domain || '').replace(/^\./, '');
  const path = cookie.path || '/';
  return `${cookie.secure ? 'https' : 'http'}://${domain}${path}`;
}

async function importCookies(cookies) {
  let imported = 0;
  for (const cookie of cookies) {
    try {
      const details = {
        url: cookieUrl(cookie),
        name: String(cookie.name || ''),
        value: String(cookie.value ?? ''),
        path: cookie.path || '/',
        secure: Boolean(cookie.secure),
        httpOnly: Boolean(cookie.httpOnly || cookie.http_only),
        sameSite: cookie.sameSite || cookie.same_site || 'lax',
      };
      if (cookie.domain) {
        details.domain = cookie.domain;
      }
      const expirationDate = Number(cookie.expirationDate || cookie.expiration_date || cookie.expires);
      if (Number.isFinite(expirationDate) && expirationDate > 0) {
        details.expirationDate = expirationDate > 10000000000 ?
          Math.floor(expirationDate / 1000) :
          expirationDate;
      }
      if (!details.name || !details.url) {
        continue;
      }
      await chrome.cookies.set(details);
      imported++;
    } catch (error) {
      console.warn('Argus cookie import failed', cookie?.domain, cookie?.name, error);
    }
  }
  return {count: imported};
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  void (async () => {
    if (message?.type === 'export-current-site-cookies') {
      sendResponse(await exportCurrentSiteCookies());
      return;
    }
    if (message?.type === 'export-all-cookies') {
      sendResponse(await exportAllCookies());
      return;
    }
    if (message?.type === 'import-cookies') {
      const cookies = Array.isArray(message.cookies) ? message.cookies :
        Array.isArray(message.cookies?.cookies) ? message.cookies.cookies :
          [];
      sendResponse(await importCookies(cookies));
      return;
    }
    sendResponse({count: 0});
  })();
  return true;
});

// ---- Per-profile auto-seed on first launch ---------------------------------
// electron/main.cjs bundles a `seed-cookies.json` alongside this extension's
// files only when the profile has a cookie file assigned (Edit > "Select
// cookies file", or the bulk "Import cookies" / bulk-match API). Runs once:
// imports it through the same importCookies() the popup's manual import
// uses, then remembers it's done so later launches don't re-seed.
const SEED_IMPORTED_KEY = 'argysSeedCookiesImported';
const SEED_SIGNATURE_KEY = 'argysSeedCookiesSignature';
const PUSH_SIGNATURE_KEY = 'argysCloudPushedCookiesSignature';

function seedSignature(cookies) {
  return cookies
      .map((cookie) => `${cookie.domain || ''}\t${cookie.path || '/'}\t${cookie.name || ''}\t${cookie.value || ''}`)
      .join('\n');
}

async function importSeedCookiesIfPresent() {
  let payload;
  try {
    const response = await fetch(chrome.runtime.getURL('seed-cookies.json'));
    if (!response.ok) {
      return;
    }
    payload = await response.json();
  } catch (error) {
    // No seed-cookies.json bundled for this profile -- nothing to seed.
    return;
  }
  const cookies = Array.isArray(payload) ? payload :
    Array.isArray(payload?.cookies) ? payload.cookies : [];
  const signature = seedSignature(cookies);
  const state = await chrome.storage.local.get([SEED_IMPORTED_KEY, SEED_SIGNATURE_KEY]);
  if (state[SEED_IMPORTED_KEY] && state[SEED_SIGNATURE_KEY] === signature) {
    return;
  }
  const result = await importCookies(cookies);
  if (!result.count) {
    return;
  }
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
chrome.runtime.onInstalled.addListener(() => void pushLocalCookiesToLauncher());
chrome.runtime.onStartup.addListener(() => void pushLocalCookiesToLauncher());
chrome.cookies.onChanged.addListener(() => scheduleCookieCloudSync());
void pushLocalCookiesToLauncher();
