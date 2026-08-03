// The local home page injected into every anonymous browser session: shared
// bookmarks plus a badge saying whether the anti-detect proxy is actually
// working. Built as a string here because the browser renders it from a file
// the main process writes, not from this renderer.
import {bookmarkInitial, faviconCache, normalizeBookmarkUrl} from './bookmarks';
import {escapeHtml} from './text';
import type {ArgusProfile, ArgusProxy, SharedBookmark} from '../types';

// Where profile data lives, as the renderer states it. On Windows this is a
// bare relative path that the main process resolves against the app's userData
// directory (see resolveProfileUserDataDir in electron/main.cjs); on macOS it is
// absolute and used as-is.
//
// Split from profileDataDir so the General section of Settings can show exactly
// the root that launches use, rather than a second guess at it.
export function profilesRoot() {
  return navigator.platform.includes('Mac') ?
    '/Users/dima/Library/Application Support/Argys Browser/Profiles' :
    'ArgysProfiles';
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
    profile: ArgusProfile, bookmarks: SharedBookmark[], proxy: ArgusProxy | null) {
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
        // Same resolution order as the launcher's bookmark card: manual icon,
        // then whatever the favicon fetch already cached, then the monogram.
        const icon = bookmark.icon || faviconCache.get(url) || '';
        const mark = icon ?
          `<img class="favicon" alt="" src="${escapeHtml(icon)}">` :
          `<span>${escapeHtml(bookmarkInitial(bookmark))}</span>`;
        return `<a class="bookmark" href="${safeUrl}">
          ${mark}
          <strong>${title}</strong>
          <small>${safeUrl}</small>
        </a>`;
      })
      .join('');
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${safeName}</title>
<style>
body{margin:0;background:#fbfaf8;color:#1d1c18;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
main{min-height:100vh;padding:56px;box-sizing:border-box}
header{display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #e4ddd1;padding-bottom:24px}
h1{font-size:34px;margin:0 0 8px;font-weight:850}
p{margin:0;color:#716b62;font-size:17px}
.badge{align-items:flex-start;border:1px solid #ded6c8;border-radius:14px;display:grid;gap:4px;max-width:420px;padding:10px 14px;background:#fff;font-weight:750;text-decoration:none}
.badge::before{border-radius:999px;content:"";height:10px;margin-top:4px;width:10px;grid-row:1 / span 2}
.badge.ok{border-color:#9fd3b2;background:#f1fbf5;color:#14532d;grid-template-columns:10px 1fr}
.badge.ok::before{background:#16a34a}
.badge.fail{border-color:#f0b4ad;background:#fff5f4;color:#7f1d1d;grid-template-columns:10px 1fr}
.badge.fail::before{background:#dc2626}
.badge:hover{filter:brightness(.98)}
.badge strong{font-size:13px;line-height:1.2}
.badge small{color:inherit;font-size:12px;font-weight:650;line-height:1.35;opacity:.78;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:14px;margin-top:34px}
.bookmark{display:grid;grid-template-columns:44px 1fr;gap:10px;align-items:center;text-decoration:none;color:inherit;background:#fff;border:1px solid #e4ddd1;border-radius:12px;padding:16px;min-height:82px}
.bookmark:hover{border-color:#171613}
.bookmark span{width:44px;height:44px;border-radius:12px;background:#f0ece9;border:1px solid #e4ddd1;color:#716b62;display:grid;place-items:center;font-weight:850}
.bookmark .favicon{width:44px;height:44px;border-radius:12px;object-fit:contain}
.bookmark strong{font-size:16px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bookmark small{grid-column:2;color:#716b62;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.empty{margin-top:34px;color:#716b62}
</style>
</head>
<body>
<main>
<header>
<div><h1>${safeName}</h1><p>Anonymous Argys Browser session</p></div>
<a class="${badgeClass}" href="https://ip.me/"><strong>${badgeTitle}</strong><small>${badgeDetail}</small></a>
</header>
${bookmarkItems ? `<section class="grid">${bookmarkItems}</section>` : '<p class="empty">No shared bookmarks yet.</p>'}
</main>
</body>
</html>`;
}
