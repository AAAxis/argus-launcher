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
import {cookieFileToBase64, cookiesFromJsonValue, toCookieJson} from '../lib/cookieFile';
import {resolveLiveSetAction} from '../lib/cookieSync';
import {cloudCookieFromSelection} from '../lib/cookieUpload';
import {canRecheckProxy, homeProxyStatus} from '../lib/homePage';
import {normalizeTags} from '../lib/tags';
import {comparable} from '../lib/text';
import {matchedProxyForProfile, repairProxyAssignments} from '../lib/proxies';
import {startPageAutomations} from '../lib/startPageAutomations';
import {native} from '../native';
import {supabase} from '../supabase';
import {newId} from '../workspace/core';
import {useColumnLayouts} from '../tables/ColumnLayouts';
import {
  applyColumnChange, columnChangeProblem, describeAllTables, describeTable,
} from '../tables/apiColumns';
import {isTableId, TABLE_IDS} from '../tables/columns';
import type {ColumnChange} from '../tables/apiColumns';
import type {CookieFileSelection} from '../native';
import type {WorkspaceValue} from '../workspace/WorkspaceProvider';
import type {AutomationStep} from '../automations/types';
import type {ArgusAutomation, ArgusProxy} from '../types';

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

// An error that names its own HTTP code. Everything thrown by a handler is a
// 500 by default, which is the wrong answer for "no automation by that id" --
// an agent that reads 500 retries, and an agent that reads 404 stops.
class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

// The table-driven equivalent of useChannel: one shared channel pair for every
// route declared in electron/api/routes.json, rather than a named on*/send*
// pair per route.
function useApiChannel<Req extends {requestId: string}, Res>(
    channel: string,
    handler: (payload: Req) => Res | Promise<Res>,
    deps: DependencyList) {
  useEffect(() => {
    const subscribe = native?.onApiRequest;
    const respond = native?.sendApiResult;
    if (!subscribe || !respond) {
      return;
    }
    return subscribe(channel, (payload: Req) => {
      void (async () => {
        try {
          respond(payload.requestId, await handler(payload));
        } catch (error) {
          respond(
              payload.requestId, undefined,
              error instanceof Error ? error.message : String(error),
              error instanceof ApiError ? error.status : 500);
        }
      })();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

export function useAutomationBridge(workspace: WorkspaceValue) {
  const {
    data, toast, automations: automationActions, profiles: profileActions,
    proxies: proxyActions, cookies: cookieActions,
  } = workspace;
  const state = data.state;
  const {withDb, patch, setState} = data;
  const cloud = [state] as const;
  // Column layouts, for the two /v1/tables routes at the end of this file.
  // App mounts this bridge inside ColumnLayoutsProvider, so an agent and the
  // picker in the toolbar are writing the same value.
  const columnLayouts = useColumnLayouts();
  // The same flag the three tabs pass: on a one-person workspace the team-only
  // columns are not offered, so the API must not accept them either.
  const isTeam = state.members.length > 1;

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

  // The cookie-manager extension's live sync (run-token routes, not the keyed
  // API). Pushes land as a VISIBLE library set named "«profile» (live)",
  // assigned to the profile -- inspectable, exportable, re-assignable --
  // unlike the legacy push-local above, which writes hidden per-profile
  // fields and stays for external API callers.
  useChannel(
      native?.onCookieSyncPushRequest,
      native?.sendCookieSyncPushResult,
      async ({profileId, cookies: pushed}) => {
        const profile = state.profiles.find(
            (item) => item.id === profileId && !item.deleted_at);
        if (!profile) {
          throw new Error('This launch\'s profile no longer exists.');
        }
        const entries = cookiesFromJsonValue(pushed);
        const action = resolveLiveSetAction(profile, state.cookies);
        if (action.kind === 'update') {
          if (!await cookieActions.saveEntries(action.set, entries)) {
            throw new Error('Could not save the pushed cookies.');
          }
          return {saved: entries.length, set: action.set.name};
        }
        const created = await cookieActions.addCookieSet({
          path: `live-sync:${profile.id}`,
          name: `${action.name}.json`,
          count: entries.length,
          base64: cookieFileToBase64(toCookieJson(entries)),
        });
        if (!created) {
          throw new Error('Could not create the live cookie set.');
        }
        if (!await cookieActions.assignToProfiles(created.id, [profile.id])) {
          throw new Error('Could not assign the live cookie set.');
        }
        toast.setMessage(`Synced ${entries.length} cookies from ${profile.name}`);
        return {saved: entries.length, set: created.name};
      },
      cloud);

  // The reverse direction: "Load from Launcher" in the extension popup. Reads
  // whatever set the profile is assigned right now, through the same
  // cache-then-file path the inspector uses.
  useChannel(
      native?.onCookieSyncPullRequest,
      native?.sendCookieSyncPullResult,
      async ({profileId}) => {
        const profile = state.profiles.find(
            (item) => item.id === profileId && !item.deleted_at);
        if (!profile) {
          throw new Error('This launch\'s profile no longer exists.');
        }
        const assigned = profile.cookie_mode === 'saved' && profile.cookie_id ?
          state.cookies.find(
              (item) => item.id === profile.cookie_id && !item.deleted_at) :
          null;
        if (!assigned) {
          return {cookies: [], set: null};
        }
        const rows = await cookieActions.loadEntries(assigned);
        return {
          cookies: rows.map(({id: _rowId, ...entry}) => entry),
          set: assigned.name,
        };
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

  // POST /v1/proxies/recheck-from-page -- a launch's own start page asking for
  // its proxy line to be brought up to date.
  //
  // The page shows a country and a latency measured once, at launch, and a
  // session outlives that by hours. This is the only surface that can ask for a
  // fresh one: you cannot reach the launcher from inside an anonymous window.
  //
  // It answers here rather than in main.cjs because both halves of the answer
  // live in the renderer -- recordCheck writes the result to the proxy row, so
  // the Proxies tab and every other profile on that proxy agree with what the
  // page now says, and homeProxyStatus is the one place the panel's wording is
  // decided. main.cjs has already verified the run token; the profile id on the
  // request came off that token's entry, not off the request body, so there is
  // nothing here for a caller to choose.
  useChannel(
      native?.onRecheckProxyRequest,
      native?.sendRecheckProxyResult,
      async ({profileId}) => {
        const profile = state.profiles.find((item) => item.id === profileId);
        if (!profile) {
          throw new Error('That profile is no longer in this workspace');
        }
        const proxy = matchedProxyForProfile(profile, state.proxies);
        if (!canRecheckProxy(profile, proxy) || !proxy) {
          // The page only draws the button when there is something to re-check,
          // so this is a workspace that changed under an open session. Answer
          // with the current status rather than an error: "no proxy assigned"
          // is exactly what the panel should now say.
          const status = homeProxyStatus(profile, proxy);
          return {proxyOk: status.ok, title: status.title, detail: status.detail};
        }
        // Failures are recorded too, the same way the background sweep records
        // them -- a proxy that has stopped working should say so on its card as
        // well as on the page that just found out.
        const checked = await proxyActions.runCheck(proxy);
        await proxyActions.recordCheck(checked);
        const status = homeProxyStatus(profile, checked);
        return {proxyOk: status.ok, title: status.title, detail: status.detail};
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
        // The same start page a hand-launched profile gets. This window is a
        // real browser someone may well look at, and it already has a debugging
        // port, so there is no reason for it to be the one launch whose page
        // cannot run its tiles or re-check its proxy. Minted with the port the
        // caller reserved, so a tile drives this session rather than a stale one.
        const runToken = await native?.mintRunToken?.(
            profile.id, profile.name, cdpPort,
            startPageAutomations(state.automations, profile)) || '';
        const apiPort = runToken ? (await native?.getApiStatus?.())?.port : 0;
        const result = await launchProfile(
            buildLaunchPayload(profile, proxy, state,
                runToken && apiPort ? {port: apiPort, token: runToken} : null),
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

  // ── Automations ────────────────────────────────────────────────────────────
  // The five routes an agent authors workflows through. main.cjs has already
  // validated the declared fields and the step tree, and has already refused a
  // folder-scoped key on create/update/delete -- automations are org-wide and
  // have no folder to scope against.

  // Deliberately not the whole step tree: a workspace with thirty automations
  // would put every step of every one of them into an agent's context on a
  // request that only asked what exists. argus_get_automation is one call away.
  useApiChannel(
      'argus:list-automations-request',
      () => ({
        automations: state.automations.map((automation) => ({
          id: automation.id,
          name: automation.name,
          description: automation.description || null,
          stepCount: automation.steps.length,
          pinned: Boolean(automation.pinned),
          runsOnLaunchFor: state.profiles
              .filter((profile) => !profile.deleted_at &&
                profile.automation_id === automation.id)
              .map((profile) => profile.id),
        })),
      }),
      cloud);

  useApiChannel(
      'argus:get-automation-request',
      ({automationId}: {requestId: string; automationId: string}) => {
        const found = state.automations.find((item) => item.id === automationId);
        if (!found) {
          throw new ApiError(`No automation with id ${automationId}`, 404);
        }
        return {automation: found};
      },
      cloud);

  useApiChannel(
      'argus:create-automation-request',
      async (payload: {
        requestId: string;
        name: string;
        description?: string;
        steps: AutomationStep[];
        tags?: string[];
        pinned?: boolean;
        timeoutMs?: number;
        closeOnFinish?: boolean;
      }) => {
        requireSignedIn();
        const automation: ArgusAutomation = {
          // Minted here, never taken from the caller: the id doubles as a
          // directory name under <userData>/AutomationRuns and the column has
          // a filesystem-safety check constraint on it.
          id: newId(),
          name: payload.name.trim(),
          description: payload.description?.trim() || null,
          steps: payload.steps,
          variables: {},
          // automationToRow runs these through normalizeTags, which is the one
          // enforcement point for the 5-tag cap -- an agent posting eight gets
          // five, on the same terms as the editor and the CSV importer.
          tags: payload.tags || [],
          pinned: Boolean(payload.pinned),
          timeout_ms: Math.min(payload.timeoutMs ?? 300000, 600000),
          close_on_finish: Boolean(payload.closeOnFinish),
        };
        // exists: false, so this is an INSERT and never an upsert. The org's
        // automation_limit is enforced by trg_automation_limit on the way in
        // and comes back through here as a plain sentence.
        const error = await automationActions.save(automation, false);
        if (error) {
          throw new ApiError(error, 400);
        }
        toast.setMessage(`Created ${automation.name}`);
        return {automation};
      },
      cloud);

  useApiChannel(
      'argus:update-automation-request',
      async (payload: {
        requestId: string;
        automationId: string;
        name?: string;
        description?: string;
        steps?: AutomationStep[];
        tags?: string[];
        pinned?: boolean;
        timeoutMs?: number;
        closeOnFinish?: boolean;
      }) => {
        requireSignedIn();
        const existing = state.automations.find((item) => item.id === payload.automationId);
        if (!existing) {
          throw new ApiError(`No automation with id ${payload.automationId}`, 404);
        }
        // Only what was sent. Spreading the payload wholesale would write
        // `undefined` over every field the caller left out, which is how a
        // rename would silently empty the step list.
        const next: ArgusAutomation = {
          ...existing,
          ...(payload.name !== undefined ? {name: payload.name.trim()} : {}),
          ...(payload.description !== undefined ?
            {description: payload.description.trim() || null} :
            {}),
          ...(payload.steps !== undefined ? {steps: payload.steps} : {}),
          ...(payload.tags !== undefined ? {tags: payload.tags} : {}),
          ...(payload.pinned !== undefined ? {pinned: payload.pinned} : {}),
          ...(payload.timeoutMs !== undefined ?
            {timeout_ms: Math.min(payload.timeoutMs, 600000)} :
            {}),
          ...(payload.closeOnFinish !== undefined ?
            {close_on_finish: payload.closeOnFinish} :
            {}),
        };
        const error = await automationActions.save(next, true);
        if (error) {
          throw new ApiError(error, 400);
        }
        toast.setMessage(`Updated ${next.name}`);
        return {automation: next};
      },
      cloud);

  useApiChannel(
      'argus:delete-automation-request',
      async ({automationId}: {requestId: string; automationId: string}) => {
        requireSignedIn();
        const existing = state.automations.find((item) => item.id === automationId);
        if (!existing) {
          throw new ApiError(`No automation with id ${automationId}`, 404);
        }
        await automationActions.remove([automationId]);
        toast.setMessage(`Deleted ${existing.name}`);
        return {deleted: automationId};
      },
      cloud);

  useApiChannel(
      'argus:run-automation-request',
      async (payload: {
        requestId: string;
        automationId: string;
        profileId: string;
        vars?: Record<string, unknown>;
        allowedFolders?: string[] | null;
      }) => {
        const automation = state.automations.find((item) => item.id === payload.automationId);
        if (!automation) {
          throw new ApiError(`No automation with id ${payload.automationId}`, 404);
        }
        // The profile still goes through the folder gate. A scoped key may run
        // a shared automation, but only against a profile it can see -- and
        // re-read from the database, not from this window's render cache, for
        // the reason resolveInScope documents.
        const profile = await resolveInScope(payload.profileId, payload.allowedFolders);
        if (!profile) {
          throw new ApiError(
              `Profile ${payload.profileId} is not visible to this key`, 403);
        }
        const result = await automationActions.run(automation, profile, {
          trigger: 'mcp',
          vars: payload.vars,
        });
        if (!result?.ok) {
          throw new ApiError(result?.error || 'The run did not start.', 409);
        }
        return {runId: result.runId, automationId: automation.id, profileId: profile.id};
      },
      cloud);

  // The two routes that let an agent set up a table the way the user would.
  //
  // Not folder-scoped: a layout is a property of the person, not of the rows,
  // and a key granted one folder changing its own user's view harms nothing --
  // which is why these are `scope: any` where authoring an automation is not.

  // Discovery. An agent that has to guess "browser version" is `fpBrowser` gets
  // one failed call and no way to learn from it; this says what exists, what is
  // on, and what cannot be turned off.
  useApiChannel(
      'argus:table-columns-request',
      () => ({tables: describeAllTables(columnLayouts.layouts, {isTeam})}),
      [columnLayouts.layouts, isTeam]);

  useApiChannel(
      'argus:set-table-columns-request',
      (payload: {requestId: string; table?: string} & ColumnChange) => {
        requireSignedIn();
        if (!isTableId(payload.table)) {
          throw new ApiError(
              `No table called ${payload.table}. There are: ${TABLE_IDS.join(', ')}.`, 400);
        }
        const table = payload.table;
        const context = {isTeam};
        // Refused whole rather than applied in part: an agent whose typo is
        // quietly dropped cannot tell that half its request did nothing.
        const problem = columnChangeProblem(table, payload, context);
        if (problem) {
          throw new ApiError(problem, 400);
        }
        const next = applyColumnChange(table, payload, columnLayouts.layouts, context);
        columnLayouts.setLayouts(next);
        // The table it just changed, in the same shape the GET answers with, so
        // a caller can check its own write without a second round trip.
        return describeTable(table, next, context);
      },
      [columnLayouts, isTeam]);
}
