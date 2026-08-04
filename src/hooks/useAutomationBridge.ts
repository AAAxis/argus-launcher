// The renderer half of the local automation API. electron/main.cjs serves
// http://127.0.0.1:39219 but owns no data, so every /v1/* request is forwarded
// here, answered against the signed-in cloud state, and reported back for the
// HTTP response.
//
// Each handler re-subscribes whenever cloud state changes, because it answers
// from the render cache rather than re-reading the database on every call.
import {useEffect} from 'react';
import type {DependencyList} from 'react';
import * as db from '../db';
import {buildLaunchPayload} from '../lib/launch';
import {cloudCookieFromSelection} from '../lib/cookieUpload';
import {normalizeTags} from '../lib/tags';
import {comparable} from '../lib/text';
import {repairProxyAssignments} from '../lib/proxies';
import {native} from '../native';
import {supabase} from '../supabase';
import {newId} from '../workspace/core';
import type {CookieFileSelection} from '../native';
import type {WorkspaceValue} from '../workspace/WorkspaceProvider';
import type {ArgusProxy} from '../types';

// One subscribe/respond pair, with the try/catch every handler needs. Fifteen
// copies of that boilerplate is where the two handlers that forgot to answer on
// failure came from -- an unanswered request hangs the HTTP caller until it
// times out.
function useChannel<Req extends {requestId: string}, Res>(
    subscribe: ((callback: (payload: Req) => void) => () => void) | undefined,
    respond: ((requestId: string, result?: Res, error?: string) => void) | undefined,
    handler: (payload: Req) => Res | Promise<Res>,
    deps: DependencyList) {
  useEffect(() => {
    if (!subscribe || !respond) {
      return;
    }
    return subscribe((payload) => {
      void (async () => {
        try {
          respond(payload.requestId, await handler(payload));
        } catch (error) {
          respond(payload.requestId, undefined,
              error instanceof Error ? error.message : String(error));
        }
      })();
    });
    // The handler closes over the deps the caller declares; `subscribe` and
    // `respond` are stable module-level bridge functions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

export function useAutomationBridge(workspace: WorkspaceValue) {
  const {data, toast, profiles: profileActions} = workspace;
  const state = data.state;
  const {withDb, patch, setState} = data;
  const cloud = [state] as const;

  // POST /v1/cookies/bulk-match -- runs against the signed-in cloud state via
  // the same matching logic the "Import cookies" button uses.
  useChannel(
      native?.onBulkMatchCookiesRequest,
      native?.sendBulkMatchCookiesResult,
      ({folderPath, profileIds}) => profileActions.matchCookies(folderPath, profileIds),
      cloud);

  // Argus Cookie Manager extensions can push decrypted local browser cookies
  // over the loopback automation API. Store that snapshot as the profile's
  // cloud cookie-import source so other machines and later launches seed it.
  useChannel(
      native?.onPushLocalCookiesRequest,
      native?.sendPushLocalCookiesResult,
      async ({profileId, profileName, cookies}) => {
        const profile = state.profiles.find((item) => item.id === profileId) ||
          state.profiles.find((item) => comparable(item.name) === comparable(profileName));
        if (!profile) {
          return {matched: false, count: 0};
        }
        const safeName = (profile.name || profileId)
            .replace(/[^a-z0-9._-]+/gi, '-')
            .replace(/^-+|-+$/g, '') || profileId;
        const raw = JSON.stringify({
          exportedAt: new Date().toISOString(),
          scope: 'all',
          source: 'local-profile',
          profileId,
          cookies,
        }, null, 2);
        const selection: CookieFileSelection = {
          path: `local-profile:${profileId}`,
          name: `argys-local-cookies-${safeName}.json`,
          count: cookies.length,
          base64: btoa(unescape(encodeURIComponent(raw))),
        };
        const fields = await cloudCookieFromSelection(profile.id, selection);
        if (!await withDb((orgId) => db.profiles.update(orgId, profile.id, fields))) {
          throw new Error('Failed to save to cloud state.');
        }
        patch.profiles((list) => list.map((item) =>
          item.id === profile.id ? {...item, ...fields} : item));
        toast.setMessage(`Migrated ${cookies.length} local cookies for ${profile.name}`);
        return {matched: true, count: cookies.length};
      },
      cloud);

  useChannel(
      native?.onReimportProxiesRequest,
      native?.sendReimportProxiesResult,
      async ({proxies: rows}) => {
        let updated = 0;
        let created = 0;
        const proxies = [...state.proxies];
        // The rows this run actually created or changed, so untouched proxies
        // are not rewritten.
        const touched: ArgusProxy[] = [];
        const keyFor = (type: string, host: string, port: number) =>
          `${type.toLowerCase()}|${host.toLowerCase()}|${port}`;
        const indexByKey = new Map<string, number>();
        proxies.forEach((proxy, index) => {
          indexByKey.set(keyFor(proxy.type || 'http', proxy.host, proxy.port), index);
        });
        for (const row of rows) {
          const host = String(row.ip || row.host || '').trim();
          const socksPort = Number(row.port_socks5 || row.socks_port || 0);
          const httpPort = Number(row.port_http || row.http_port || row.port || 0);
          const type: ArgusProxy['type'] = socksPort ? 'socks5' : 'http';
          const port = type === 'socks5' ? socksPort : httpPort;
          if (!host || !Number.isInteger(port) || port <= 0 || port > 65535) {
            continue;
          }
          const username = String(row.username || '').trim();
          const password = String(row.password || '');
          const country = String(row.country || '').trim();
          const key = keyFor(type, host, port);
          const existingIndex = indexByKey.get(key);
          const existing = existingIndex == null ? null : proxies[existingIndex];
          const nextProxy: ArgusProxy = {
            ...(existing || {}),
            id: existing ? existing.id : String(row.id || newId(created)),
            name: existing ?
              existing.name :
              (country ? `${country.toUpperCase()} proxy ${host}` : `${host}:${port}`),
            type,
            host,
            port,
            username: username || undefined,
            password: password || undefined,
            country: country || existing?.country,
            country_code: country || existing?.country_code,
            checked_at: undefined,
            check_error: undefined,
            egress_ip: undefined,
            ping_ms: undefined,
          };
          if (existingIndex == null) {
            indexByKey.set(key, proxies.length);
            proxies.push(nextProxy);
            created++;
          } else {
            proxies[existingIndex] = nextProxy;
            updated++;
          }
          touched.push(nextProxy);
        }
        // repairProxyAssignments only ever rewrites proxy_id/proxy_mode, and it
        // returns the same object for a profile it did not change -- so an
        // identity comparison is enough to find the profiles that need writing.
        const repairedProfiles = repairProxyAssignments({...state, proxies}).state.profiles;
        const ok = await withDb(async (orgId) => {
          for (const proxy of touched) {
            await db.proxies.upsert(orgId, proxy);
          }
          for (let index = 0; index < repairedProfiles.length; index++) {
            const profile = repairedProfiles[index];
            if (profile === state.profiles[index]) {
              continue;
            }
            await db.profiles.update(orgId, profile.id,
                {proxy_id: profile.proxy_id, proxy_mode: profile.proxy_mode});
          }
        });
        if (!ok) {
          throw new Error('Failed to save to cloud state.');
        }
        setState((current) => ({...current, proxies, profiles: repairedProfiles}));
        toast.setMessage(`Reimported proxies: ${updated} updated, ${created} created`);
        return {updated, created, total: rows.length};
      },
      cloud);

  useChannel(
      native?.onAssignProfileProxyRequest,
      native?.sendAssignProfileProxyResult,
      async ({profileId, proxyId, proxyHost, proxyPort, allowedFolders}) => {
        if (!await resolveInScope(profileId, allowedFolders)) {
          return {matched: false, profileId};
        }
        const proxy = state.proxies.find((item) => proxyId && item.id === proxyId) ||
          state.proxies.find((item) =>
            proxyHost && item.host === proxyHost && (!proxyPort || item.port === proxyPort));
        if (!proxy) {
          return {matched: false, profileId};
        }
        const ok = await withDb((orgId) =>
          db.profiles.update(orgId, profileId, {proxy_id: proxy.id, proxy_mode: 'assigned'}));
        if (!ok) {
          throw new Error('Failed to save to cloud state.');
        }
        patch.profiles((list) => list.map((profile) =>
          profile.id === profileId ?
            {...profile, proxy_id: proxy.id, proxy_mode: 'assigned' as const} :
            profile));
        toast.setMessage(`Assigned ${proxy.host}:${proxy.port} to ${profileId}`);
        return {matched: true, profileId, proxyId: proxy.id};
      },
      cloud);

  useChannel(
      native?.onGetProfileRequest,
      native?.sendGetProfileResult,
      ({profileId, allowedFolders}) => {
        requireSignedIn();
        const profile = state.profiles.find((item) => item.id === profileId && !item.deleted_at);
        if (!profile || (allowedFolders && !allowedFolders.includes(profile.folder_id || ''))) {
          return {profile: null};
        }
        return {profile};
      },
      cloud);

  useChannel(
      native?.onListProxiesRequest,
      native?.sendListProxiesResult,
      () => {
        requireSignedIn();
        return {
          // Credentials are deliberately not returned. This used to spread the
          // whole row, so a single list call put every proxy username and
          // password the account owns into the caller's context in clear text --
          // and for an MCP client that context is an LLM's transcript, which is
          // logged, and which the user cannot unsend. Nothing a caller does with
          // this list needs them: proxies are assigned to profiles by id, and
          // argus_check_proxy takes credentials as explicit arguments for
          // testing a proxy that has not been saved yet. `hasCredentials` keeps
          // the one fact that was actually useful.
          proxies: state.proxies.map(({username, password, ...proxy}) => ({
            ...proxy,
            hasCredentials: Boolean(username || password),
            assignedProfileIds: state.profiles
                .filter((profile) => !profile.deleted_at && profile.proxy_id === proxy.id)
                .map((profile) => profile.id),
          })),
        };
      },
      cloud);

  useChannel(
      native?.onCreateProxyRequest,
      native?.sendCreateProxyResult,
      async ({name, type, host, port, username, password}) => {
        const proxy: ArgusProxy = {
          id: newId(),
          name: name || `${host}:${port}`,
          type,
          host,
          port,
          username,
          password,
        };
        if (!await workspace.proxies.create(proxy)) {
          throw new Error('Failed to save to cloud state.');
        }
        toast.setMessage(`Created proxy ${proxy.name}`);
        return {proxyId: proxy.id};
      },
      cloud);

  useChannel(
      native?.onUpdateProxyRequest,
      native?.sendUpdateProxyResult,
      async ({proxyId, fields}) => {
        const existing = state.proxies.find((item) => item.id === proxyId);
        if (!existing) {
          return {matched: false};
        }
        if (!await workspace.proxies.update({...existing, ...fields})) {
          throw new Error('Failed to save to cloud state.');
        }
        toast.setMessage(`Updated proxy ${proxyId}`);
        return {matched: true};
      },
      cloud);

  useChannel(
      native?.onDeleteProxyRequest,
      native?.sendDeleteProxyResult,
      async ({proxyId}) => {
        if (!state.proxies.some((item) => item.id === proxyId)) {
          return {deleted: false, unassignedProfileIds: []};
        }
        const unassignedProfileIds = state.profiles
            .filter((profile) => profile.proxy_id === proxyId)
            .map((profile) => profile.id);
        if (!await workspace.proxies.remove([proxyId])) {
          throw new Error('Failed to save to cloud state.');
        }
        toast.setMessage(`Deleted proxy ${proxyId}${unassignedProfileIds.length ? ` (unassigned from ${unassignedProfileIds.length} profile(s))` : ''}`);
        return {deleted: true, unassignedProfileIds};
      },
      cloud);

  // Signed out is not the same as "this account has no profiles", and from the
  // outside the two used to be indistinguishable: this bridge is mounted above
  // the sign-in gate in App.tsx, so with no session every list answered 200
  // with an empty array and a caller would reasonably conclude the account was
  // empty and stop. Failing loudly is the only honest answer.
  function requireSignedIn() {
    if (!data.orgId) {
      throw new Error('Argus Launcher is signed out. Sign in to use the automation API.');
    }
  }

  // allowedFolders is an authorization gate, not a display filter, so every
  // path it guards has to re-read where the profile lives *now* rather than
  // trusting this window's render cache -- the same reasoning the delete path
  // below already documents.
  //
  // Three write paths took no scope at all until this existed: update,
  // assign-proxy and update-fingerprint. Since folder_id is one of the settable
  // fields, a key scoped to one folder could move any profile in the account
  // into that folder and then read and launch it entirely legitimately. The
  // scope was a read filter, not a boundary.
  async function resolveInScope(profileId: string, allowedFolders?: string[] | null) {
    if (!data.orgId) {
      throw new Error('No organization is selected yet.');
    }
    const latest = await db.profiles.list(data.orgId);
    const target = latest.find((item) => item.id === profileId && !item.deleted_at);
    if (!target || (allowedFolders && !allowedFolders.includes(target.folder_id || ''))) {
      return null;
    }
    return target;
  }

  useChannel(
      native?.onUpdateProfileRequest,
      native?.sendUpdateProfileResult,
      async ({profileId, fields, allowedFolders}) => {
        const existing = await resolveInScope(profileId, allowedFolders);
        if (!existing) {
          return {matched: false, profileId};
        }
        // Both ends of a move have to be in scope. Checking only the source
        // would let a scoped key relocate its own profiles into a folder it has
        // no rights to, which is the same escape in the other direction.
        if (allowedFolders && 'folder_id' in fields &&
            !allowedFolders.includes(fields.folder_id || '')) {
          return {matched: false, profileId};
        }
        // An agent posting eight tags gets five, on the same terms as the
        // editor and the CSV importer -- this is the third and last write path
        // into profiles.tags, and none of them may leave a row the dialog
        // would then refuse to save.
        const patch = 'tags' in fields ? {...fields, tags: normalizeTags(fields.tags || [])} : fields;
        if (!await profileActions.update(existing, patch)) {
          throw new Error('Failed to save to cloud state.');
        }
        toast.setMessage(`Updated ${profileId}`);
        return {matched: true, profileId};
      },
      cloud);

  useChannel(
      native?.onDeleteProfileRequest,
      native?.sendDeleteProfileResult,
      async ({profileId, permanent, allowedFolders}) => {
        if (!data.orgId) {
          throw new Error('No organization is selected yet.');
        }
        // Still re-read before the folder check: allowedFolders is an
        // authorization gate, so it has to see where the profile lives now
        // rather than trusting this window's render cache. The delete itself
        // is one statement against one id and needs nothing fresh.
        const latestProfiles = await db.profiles.list(data.orgId);
        const target = latestProfiles.find((item) => item.id === profileId);
        if (!target || (allowedFolders && !allowedFolders.includes(target.folder_id || ''))) {
          return {deleted: false, permanent};
        }
        const ok = await withDb((orgId) => permanent ?
          db.profiles.purge(orgId, [profileId]) :
          db.profiles.softDelete(orgId, [profileId]));
        if (!ok) {
          throw new Error('Failed to save to cloud state.');
        }
        // Patched from the list we just read rather than from the render
        // cache, so profiles another worker added since the last load are
        // picked up by the same round trip the authorization check needed.
        const remaining = permanent ?
          latestProfiles.filter((item) => item.id !== profileId) :
          latestProfiles.map((item) =>
            item.id === profileId ? {...item, deleted_at: new Date().toISOString()} : item);
        patch.profiles(() => remaining);
        if (workspace.selectedProfileId === profileId) {
          workspace.setSelectedProfileId(remaining.find((item) => !item.deleted_at)?.id || null);
        }
        toast.setMessage(permanent ?
          `${profileId} permanently deleted` :
          `${profileId} moved to Trash`);
        return {deleted: true, permanent};
      },
      cloud);

  useChannel(
      native?.onUpdateFingerprintRequest,
      native?.sendUpdateFingerprintResult,
      async ({profileId, fingerprint, allowedFolders}) => {
        const target = await resolveInScope(profileId, allowedFolders);
        if (!target) {
          return {matched: false, profileId};
        }
        const merged = {...target.fingerprint, ...fingerprint};
        if (!await profileActions.update(target, {fingerprint: merged})) {
          throw new Error('Failed to save to cloud state.');
        }
        toast.setMessage(`Updated fingerprint for ${profileId}`);
        return {matched: true, profileId};
      },
      cloud);

  useChannel(
      native?.onListProfilesRequest,
      native?.sendListProfilesResult,
      ({folder, allowedFolders}) => {
        requireSignedIn();
        return {
          profiles: state.profiles
              .filter((profile) => !profile.deleted_at)
              .filter((profile) => !folder || profile.folder_id === folder)
              .filter((profile) => !allowedFolders || allowedFolders.includes(profile.folder_id || ''))
              .map((profile) => ({id: profile.id, name: profile.name})),
        };
      },
      cloud);

  // Unlike the manual Launch button this skips the interactive pre-check/retry
  // UI (there is nothing to show it to) and skips fingerprint rotate-on-launch,
  // since automated QA/monitoring runs want a stable, comparable fingerprint
  // across repeated sweeps rather than a fresh one each time.
  // spawnProfileUnchecked (main process) remains the authoritative proxy gate.
  useChannel(
      native?.onLaunchAutomationRequest,
      native?.sendLaunchAutomationResult,
      async ({profileId, cdpPort, allowedFolders}) => {
        const launchProfile = native?.launchProfile;
        const profile = state.profiles.find((item) => item.id === profileId && !item.deleted_at);
        if (!profile || !launchProfile) {
          return {ok: false, error: 'Profile not found'};
        }
        if (allowedFolders && !allowedFolders.includes(profile.folder_id || '')) {
          return {ok: false, error: 'This key is not scoped to that profile\'s folder'};
        }
        let proxy = null;
        if ((profile.proxy_mode || 'assigned') === 'assigned') {
          proxy = profileActions.proxyFor(profile);
          if (!proxy?.host || !proxy.port) {
            return {ok: false, error: `Proxy for ${profile.name} is invalid`};
          }
        }
        const result = await launchProfile(
            buildLaunchPayload(profile, proxy, state),
            [`--remote-debugging-port=${cdpPort}`]);
        return {ok: result.ok, pid: result.pid, error: result.error};
      },
      cloud);

  // Monitoring results go straight to Supabase rather than through cloud state,
  // so this one does not care when the render cache changes.
  useChannel(
      native?.onMonitoringReportRequest,
      native?.sendMonitoringReportResult,
      async ({runId, profileId, ok, detail, screenshotBase64}) => {
        if (!supabase) {
          throw new Error('Supabase env is missing in .env');
        }
        const {data: userData, error: userError} = await supabase.auth.getUser();
        const userId = userData.user?.id;
        if (userError || !userId) {
          throw new Error('Not signed in');
        }
        const {error} = await supabase.from('argus_monitoring_results').insert({
          user_id: userId,
          run_id: runId,
          profile_id: profileId,
          ok,
          detail: detail || null,
          screenshot_base64: screenshotBase64,
        });
        if (error) {
          throw new Error(error.message);
        }
        return {ok: true} as const;
      },
      []);
}
