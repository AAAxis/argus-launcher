// Two things that run on their own once cloud state lands, and that nothing in
// the UI has to ask for.
import {useEffect, useRef, useState} from 'react';
import {faviconCache, faviconWarmed, normalizeBookmarkUrl} from '../lib/bookmarks';
import {native} from '../native';
import type {WorkspaceValue} from '../workspace/WorkspaceProvider';

// Proxy checks are automatic: any proxy that has never passed a check, or that
// failed its last one, is re-checked once per session. Two refs rather than one
// because "queued" and "already tried this session" are different questions --
// collapsing them let a re-render queue the same proxy twice.
export function useBackgroundProxyChecks(workspace: WorkspaceValue, enabled: boolean) {
  const {data, proxies, beginProxyCheck, endProxyCheck} = workspace;
  const inFlight = useRef(new Set<string>());
  const attempted = useRef(new Set<string>());
  const proxyRows = data.state.proxies;
  const loading = data.loading;
  const orgId = data.orgId;

  // A different org's proxies have never been checked by this session.
  useEffect(() => {
    inFlight.current.clear();
    attempted.current.clear();
  }, [orgId]);

  useEffect(() => {
    if (loading || !enabled || !native?.checkProxy) {
      return;
    }
    const pending = proxyRows.filter((proxy) =>
      proxy.host &&
      proxy.port &&
      (!proxy.checked_at || proxy.check_error) &&
      !attempted.current.has(proxy.id) &&
      !inFlight.current.has(proxy.id));
    if (pending.length === 0) {
      return;
    }
    let cancelled = false;
    for (const proxy of pending) {
      inFlight.current.add(proxy.id);
      attempted.current.add(proxy.id);
    }
    void (async () => {
      // Each check writes only its own proxy's six result columns, so they can
      // run one after another without threading a merged state through.
      for (const proxy of pending) {
        if (cancelled) {
          break;
        }
        beginProxyCheck(proxy.id);
        try {
          await proxies.recordCheck(await proxies.runCheck(proxy));
        } catch (error) {
          await proxies.recordCheck({
            ...proxy,
            checked_at: new Date().toISOString(),
            check_error: error instanceof Error ? error.message : String(error),
          });
        } finally {
          inFlight.current.delete(proxy.id);
          endProxyCheck(proxy.id);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // Re-runs when the proxy list changes; `proxies` and the setter are
    // rebuilt every render and would make this loop restart on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, enabled, proxyRows]);
}

// Warm the favicon cache for every bookmark as soon as cloud state arrives,
// rather than only for the ones the Bookmarks tab has rendered.
// anonymousHomeHtml() builds the injected browser home page synchronously and
// can only read this in-memory map, so launching a profile before that tab
// had ever been opened gave every bookmark a monogram. The main process
// caches to disk, so this costs one round trip per host per month.
export function useFaviconWarmer(workspace: WorkspaceValue) {
  const bookmarks = workspace.data.state.shared_bookmarks;
  useEffect(() => {
    if (!native?.bookmarkFavicon) {
      return;
    }
    for (const bookmark of bookmarks) {
      const url = normalizeBookmarkUrl(bookmark.url);
      // faviconWarmed rather than faviconCache: a host is marked as attempted
      // before the answer lands, so a re-render mid-flight cannot queue it
      // twice, while faviconCache stays empty until there is a real result for
      // BookmarkFavicon to read.
      if (!url || bookmark.icon || faviconCache.has(url) || faviconWarmed.has(url)) {
        continue;
      }
      faviconWarmed.add(url);
      void native.bookmarkFavicon(url)
          .then((dataUri) => {
            faviconCache.set(url, dataUri);
          })
          .catch((error) => {
            console.warn('[favicon] warm failed for', url, error);
            faviconCache.set(url, null);
          });
    }
  }, [bookmarks]);
}

export type OAuthRequest = {requestId: string; clientName: string; requestedScope: string};

// The loopback "Connect" flow (GET /v1/oauth/authorize): an external app opens
// that URL in a real browser, and this surfaces the approve/deny dialog. The
// human approving can narrow the grant below whatever the caller asked for.
export function useOAuthApproval(onApproved: () => Promise<void> | void) {
  const [request, setRequest] = useState<OAuthRequest | null>(null);
  const [folder, setFolder] = useState('');

  useEffect(() => {
    const onRequest = native?.onOAuthAuthorizeRequest;
    if (!onRequest) {
      return;
    }
    return onRequest((payload) => {
      setFolder(payload.requestedScope.startsWith('folder:') ?
        payload.requestedScope.slice('folder:'.length) :
        '');
      setRequest(payload);
    });
  }, []);

  async function respond(approved: boolean) {
    if (!request || !native?.sendOAuthAuthorizeResult) {
      return;
    }
    native.sendOAuthAuthorizeResult(
        request.requestId,
        approved,
        approved && folder ? [folder] : null,
        request.clientName,
    );
    setRequest(null);
    if (approved) {
      await onApproved();
    }
  }

  return {request, folder, setFolder, respond};
}
