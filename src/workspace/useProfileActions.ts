import * as db from '../db';
import {toCsv} from '../lib/csv';
import {buildLaunchPayload} from '../lib/launch';
import {cloudCookieFromSelection} from '../lib/cookieUpload';
import {matchedProxyForProfile, parseProxyConnectionString, proxyDedupeKey} from '../lib/proxies';
import {isFsSafeId} from '../lib/trash';
import {normalizeTags} from '../lib/tags';
import {numberOrNull} from '../lib/text';
import {native} from '../native';
import {fingerprintFromDraftPatch, tagsFromDraft} from '../drafts';
import {
  defaultWindowsFingerprintPattern,
  languagePresets,
  mediaDevicePresets,
  randomFingerprintPatch,
} from '../lib/fingerprintPresets';
import {DEFAULT_PROFILE_COLOR} from '../lib/profileColors';
import {newId} from './core';
import type {ProxyActions} from './useProxyActions';
import type {WorkspaceCore} from './core';
import type {CookieImportFields} from '../lib/cookieUpload';
import type {ArgusFolder, ArgusProfile, ArgusProxy} from '../types';

export type ProfileActions = ReturnType<typeof useProfileActions>;

export function useProfileActions(
    {data, toast, selectedProfileId, setSelectedProfileId, setCheckingProxyId}: WorkspaceCore,
    proxies: ProxyActions) {
  const {state, setState, withDb, patch} = data;

  function proxyFor(profile: ArgusProfile) {
    return matchedProxyForProfile(profile, state.proxies);
  }

  function folderFor(profile: ArgusProfile) {
    return state.folders.find((folder) => folder.id === profile.folder_id) || null;
  }

  // withDb surfaces the real error via the toast on failure; this used to give
  // no feedback either way, so a failed save (e.g. a status change) looked
  // identical to a successful one -- the change would show locally but silently
  // never reach the cloud, then vanish on another machine's next fresh load.
  async function update(profile: ArgusProfile, fields: Partial<ArgusProfile>): Promise<boolean> {
    if (!await withDb((activeOrgId) => db.profiles.update(activeOrgId, profile.id, fields))) {
      return false;
    }
    patch.profiles((list) => list.map((item) =>
      item.id === profile.id ? {...item, ...fields} : item));
    return true;
  }

  // One row, keyed on the profile's own id -- which stays exactly what it was,
  // because it is also the E:\ArgysProfiles\<id> directory name. Create and
  // edit are separate statements on purpose (see db/profiles.ts): only the
  // create path should be able to raise profile_limit_reached.
  async function save(profile: ArgusProfile): Promise<boolean> {
    const isExisting = state.profiles.some((item) => item.id === profile.id);
    if (!await withDb((activeOrgId) => db.profiles.save(activeOrgId, profile, isExisting))) {
      return false;
    }
    patch.profiles((list) => isExisting ?
      list.map((item) => item.id === profile.id ? profile : item) :
      [...list, profile]);
    setSelectedProfileId(profile.id);
    return true;
  }

  // A proxy is offered for "also delete" only when every profile assigned to
  // it is in the set being deleted -- otherwise removing it would silently
  // break a surviving profile's launch.
  function exclusiveProxyIdsFor(profileIds: string[]): string[] {
    const deletingIds = new Set(profileIds);
    const assigned = new Set(
      state.profiles
          .filter((profile) => deletingIds.has(profile.id) && profile.proxy_id)
          .map((profile) => profile.proxy_id as string));
    return [...assigned].filter((proxyId) =>
      !state.profiles.some((profile) =>
        !deletingIds.has(profile.id) && profile.proxy_id === proxyId));
  }

  // One UPDATE stamping deleted_at on these ids, and nothing else. The old path
  // re-read the whole profiles array from the server first, because it was
  // about to rewrite all of it; there is nothing left to be stale about.
  async function softDelete(profileIds: string[], alsoDeleteProxyIds: string[] = []): Promise<boolean> {
    const deletedAt = new Date().toISOString();
    const ok = await withDb(async (activeOrgId) => {
      await db.profiles.softDelete(activeOrgId, profileIds);
      if (alsoDeleteProxyIds.length) {
        await db.proxies.remove(activeOrgId, alsoDeleteProxyIds);
      }
    });
    if (!ok) {
      return false;
    }
    const profiles = state.profiles.map((item) =>
      profileIds.includes(item.id) ? {...item, deleted_at: deletedAt} : item);
    patch.profiles(() => profiles);
    if (alsoDeleteProxyIds.length) {
      // The proxies FK is ON DELETE SET NULL, so the affected profiles lose
      // their proxy_id server-side; mirror that locally.
      patch.proxies((list) => list.filter((proxy) => !alsoDeleteProxyIds.includes(proxy.id)));
      patch.profiles((list) => list.map((item) =>
        item.proxy_id && alsoDeleteProxyIds.includes(item.proxy_id) ?
          {...item, proxy_id: null} :
          item));
    }
    if (selectedProfileId && profileIds.includes(selectedProfileId)) {
      setSelectedProfileId(profiles.find((item) => !item.deleted_at)?.id || null);
    }
    return true;
  }

  // Restoring crosses the profile limit as much as creating does, so
  // trg_profile_limit_restore fires on exactly this update and can refuse it.
  // A bulk restore is one statement, so it either all lands or none of it does.
  async function restore(profileIds: string[]): Promise<boolean> {
    if (!await withDb((activeOrgId) => db.profiles.restore(activeOrgId, profileIds))) {
      return false;
    }
    patch.profiles((list) => list.map((item) =>
      profileIds.includes(item.id) ? {...item, deleted_at: null} : item));
    return true;
  }

  async function purge(profileIds: string[]): Promise<boolean> {
    if (!await withDb((activeOrgId) => db.profiles.purge(activeOrgId, profileIds))) {
      return false;
    }
    patch.profiles((list) => list.filter((item) => !profileIds.includes(item.id)));
    return true;
  }

  async function assignToFolder(profileIds: string[], folderId: string | null): Promise<boolean> {
    const ok = await withDb(async (activeOrgId) => {
      for (const id of profileIds) {
        await db.profiles.update(activeOrgId, id, {folder_id: folderId});
      }
    });
    if (!ok) {
      return false;
    }
    patch.profiles((list) => list.map((profile) =>
      profileIds.includes(profile.id) ? {...profile, folder_id: folderId} : profile));
    return true;
  }

  // Resolves the proxy a launch will actually use, checking it first if its
  // stored result is missing or stale. Returns null when the launch must be
  // blocked -- the reason has already been shown by then.
  //
  // spawnProfileUnchecked (main process) is the authoritative proxy gate on
  // every launch regardless; this is a UI convenience that skips re-checking a
  // proxy already known-good and, unlike the automation path, has somewhere to
  // show a failure.
  async function resolveLaunchProxy(profile: ArgusProfile): Promise<ArgusProxy | null | 'blocked'> {
    if ((profile.proxy_mode || 'assigned') !== 'assigned') {
      return null;
    }
    const assigned = proxyFor(profile);
    if (!assigned?.host || !assigned.port) {
      toast.fail('Launch blocked',
          `Proxy for ${profile.name} is invalid. Fix host and port before launch.`);
      return 'blocked';
    }
    if (assigned.checked_at && !assigned.check_error) {
      return assigned;
    }
    if (!native?.checkProxy) {
      toast.fail('Launch blocked',
          'Native proxy checker is not available. Restart Argus Launcher and try again.');
      return 'blocked';
    }
    toast.setMessage(`Checking proxy for ${profile.name}`);
    setCheckingProxyId(assigned.id);
    let checked: ArgusProxy;
    try {
      checked = await proxies.runCheck(assigned);
      // Only the proxy's check result is new here -- the profile was already
      // written above if its fingerprint rotated.
      await proxies.recordCheck(checked);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toast.fail('Launch blocked', `Proxy for ${profile.name} failed its check: ${message}`);
      return 'blocked';
    } finally {
      setCheckingProxyId('');
    }
    if (checked.check_error) {
      toast.fail('Launch blocked',
          `Proxy for ${profile.name} failed its check: ${checked.check_error}`);
      return 'blocked';
    }
    return checked;
  }

  // Rotate-on-launch profiles get a fresh identity persisted before the browser
  // starts, so the fingerprint the browser applies is the one that was saved.
  async function withRotatedFingerprint(profile: ArgusProfile): Promise<ArgusProfile> {
    if (!profile.fingerprint?.rotate_on_launch) {
      return profile;
    }
    const rotated = fingerprintFromDraftPatch(randomFingerprintPatch(profile.fingerprint?.os || ''));
    const next: ArgusProfile = {
      ...profile,
      fingerprint: {...profile.fingerprint, ...rotated, rotate_on_launch: true},
    };
    await withDb((activeOrgId) =>
      db.profiles.update(activeOrgId, profile.id, {fingerprint: next.fingerprint}));
    patch.profiles((list) => list.map((item) => item.id === profile.id ? next : item));
    return next;
  }

  async function launch(profile: ArgusProfile) {
    if (!native) {
      toast.setMessage('Native launcher bridge is not available');
      return;
    }
    try {
      const target = await withRotatedFingerprint(profile);
      const proxy = await resolveLaunchProxy(target);
      if (proxy === 'blocked') {
        return;
      }
      // Without this message the main process's own re-check is invisible:
      // several seconds of silence between clicking Launch and either the
      // window opening or an error dialog.
      toast.setMessage(`Launching ${target.name}`);

      // The debugging port is opened ONLY when something is going to drive this
      // session. An always-on --remote-debugging-port would be a real
      // anti-detect regression: the port is connectable by any local process,
      // and CDP attachment is observable from the page. So a profile with no
      // automation attached launches exactly as it did before, with no extra
      // switches at all.
      const attached = target.automation_id ?
        state.automations.find((item) => item.id === target.automation_id) :
        null;
      const cdpPort = attached ? await native.reserveCdpPort?.() : undefined;
      const extraArgs = cdpPort ?
        [`--remote-debugging-port=${cdpPort}`, '--remote-allow-origins=*'] :
        [];

      const result = await native.launchProfile(
          buildLaunchPayload(target, proxy, state), extraArgs);
      if (result.ok) {
        toast.setMessage(`Launched ${target.name}`);
        if (attached && cdpPort) {
          // Deliberately not awaited: a run is minutes long and the Launch
          // button must not sit spinning for it. Failures surface as a toast
          // and as a `failed` row in the history, never as a stuck button.
          //
          // The run is started here rather than through automations.run()
          // because the profile is already open -- run() would resolve the
          // session first and, finding the port still binding, report a window
          // that is opening as "not open". Persistence is unaffected: the
          // record is written by whoever is listening to run events, which is
          // useAutomationRuns regardless of who started it.
          void (async () => {
            const ready = await native.waitForCdp?.(cdpPort, 20000);
            if (!ready?.ok || !ready.cdpUrl) {
              toast.fail(`Couldn't run ${attached.name}`,
                  ready?.error || 'The browser never answered on its debugging port.');
              return;
            }
            const started = await native.startAutomationRun?.({
              automation: attached,
              profile: target,
              trigger: 'launch',
              cdpUrl: ready.cdpUrl,
            });
            if (started && !started.ok) {
              toast.fail(`Couldn't run ${attached.name}`, started.error || 'The run did not start.');
            }
          })();
        }
      } else {
        toast.fail(`Couldn't launch ${target.name}`,
            result.error || 'Launch failed for an unknown reason.');
      }
    } catch (error) {
      toast.fail(`Couldn't launch ${profile.name}`,
          error instanceof Error ? error.message : String(error));
    }
  }

  async function exportToCsv(list: ArgusProfile[]) {
    if (!list.length) {
      return;
    }
    if (!native?.saveTextFile) {
      toast.setMessage('Native file export is not available. Restart Argus Launcher and try again.');
      return;
    }
    const header = [
      'name', 'status', 'folder', 'proxy', 'tags', 'start_url', 'created_at',
      'os', 'browser_version', 'user_agent', 'language', 'timezone',
    ];
    const csv = toCsv(header, list, (profile) => {
      const proxy = proxyFor(profile);
      const folder = folderFor(profile);
      return {
        name: profile.name || '',
        status: profile.status || '',
        folder: folder?.name || '',
        proxy: proxy ? `${proxy.type || 'http'}://${proxy.host}:${proxy.port}` : '',
        tags: profile.tags?.join('; ') || '',
        start_url: profile.start_url || '',
        created_at: profile.created_at || '',
        os: profile.fingerprint?.os || '',
        browser_version: profile.fingerprint?.browser_version || '',
        user_agent: profile.fingerprint?.user_agent || '',
        language: profile.fingerprint?.language || '',
        timezone: profile.fingerprint?.timezone || '',
      };
    });
    const savedPath = await native.saveTextFile(`argys-profiles-${Date.now()}.csv`, csv);
    if (savedPath) {
      toast.setMessage(`Exported ${list.length} ${list.length === 1 ? 'profile' : 'profiles'} to ${savedPath.split('/').pop()}`);
    }
  }

  // Shared by the "Import cookies" button (folder picked via native dialog,
  // targetProfileIds = the checked selection) and the local automation API
  // (POST /v1/cookies/bulk-match, targetProfileIds = null meaning "every
  // profile"). Matches by name against files in `folderPath`, same as the
  // Dolphin-export naming convention (dolphin-anty-cookies-<Name>-<id>.txt).
  async function matchCookies(
      folderPath: string,
      targetProfileIds: string[] | null): Promise<{matched: number; total: number}> {
    if (!native?.matchCookieFiles) {
      throw new Error('Native cookie import is not available. Restart Argus Launcher and try again.');
    }
    const targetIds = targetProfileIds ? new Set(targetProfileIds) : null;
    const isTarget = (profile: ArgusProfile) =>
      !profile.deleted_at && (!targetIds || targetIds.has(profile.id));
    const selected = state.profiles.filter(isTarget);
    const matches = await native.matchCookieFiles(folderPath, selected.map((profile) => profile.name));
    const cookiePatches = new Map<string, CookieImportFields>();
    for (const profile of selected) {
      const match = matches[profile.name];
      if (!match) {
        continue;
      }
      cookiePatches.set(profile.id, await cloudCookieFromSelection(profile.id, match));
    }
    // One update per profile that actually matched a cookie file; the ones that
    // did not match are never rewritten.
    const ok = await withDb(async (activeOrgId) => {
      for (const [profileId, fields] of cookiePatches) {
        await db.profiles.update(activeOrgId, profileId, fields);
      }
    });
    if (!ok) {
      throw new Error('Failed to save matched cookies to cloud state.');
    }
    patch.profiles((list) => list.map((profile) => {
      const fields = isTarget(profile) ? cookiePatches.get(profile.id) : undefined;
      return fields ? {...profile, ...fields} : profile;
    }));
    return {matched: cookiePatches.size, total: selected.length};
  }

  async function importFromCsv(rows: Record<string, string>[]): Promise<ImportResult | null> {
    const plan = planCsvImport(rows, state.profiles, state.proxies, state.folders);
    // FK order: a profile cannot reference a folder or proxy that is not there
    // yet. Unlike the single blob write this replaces, these are separate
    // statements -- if the org hits its profile limit partway through, the rows
    // written before that point stay written, and the counts below are what the
    // loop planned rather than what landed.
    const writtenProfiles: string[] = [];
    const ok = await withDb(async (activeOrgId) => {
      for (const folder of plan.newFolders) {
        await db.folders.create(activeOrgId, folder);
      }
      for (const proxy of plan.newProxies) {
        await db.proxies.upsert(activeOrgId, proxy);
      }
      for (const {profile, exists} of plan.touchedProfiles) {
        await db.profiles.save(activeOrgId, profile, exists);
        writtenProfiles.push(profile.id);
      }
    });
    setState((current) => ({
      ...current,
      folders: plan.folders,
      proxies: plan.proxies,
      profiles: plan.profiles.filter((profile) =>
        writtenProfiles.includes(profile.id) ||
        current.profiles.some((item) => item.id === profile.id)),
    }));
    return ok ? plan.result : null;
  }

  return {
    proxyFor,
    folderFor,
    update,
    save,
    exclusiveProxyIdsFor,
    softDelete,
    restore,
    purge,
    assignToFolder,
    launch,
    exportToCsv,
    matchCookies,
    importFromCsv,
  };
}

export type ImportResult = {
  created: number;
  updated: number;
  proxiesCreated: number;
  proxiesReused: number;
  foldersCreated: number;
  // Rows that carried more than MAX_PROFILE_TAGS tags and had the extras
  // dropped. Reported rather than silently trimmed: a CSV written against
  // another tool has no reason to know this app's limit, and losing a tag
  // without being told is the kind of thing found weeks later.
  tagsTrimmed: number;
  skipped: Array<{name: string; reason: string}>;
};

// Works out what a Dolphin-style inventory CSV would change, without writing
// anything. Pure, so the "what will this do" half of the importer is testable
// on its own and the caller only has to sequence the writes.
function planCsvImport(
    rows: Record<string, string>[],
    existingProfiles: ArgusProfile[],
    existingProxies: ArgusProxy[],
    existingFolders: ArgusFolder[]) {
  const profiles = [...existingProfiles];
  const proxies = [...existingProxies];
  const folders = [...existingFolders];
  // What this run actually has to write. The blob path rewrote everything; rows
  // the CSV never mentioned are now left alone.
  const newProxies: ArgusProxy[] = [];
  const newFolders: ArgusFolder[] = [];
  const touchedProfiles: Array<{profile: ArgusProfile; exists: boolean}> = [];

  const proxyIndexByKey = new Map<string, number>();
  proxies.forEach((proxy, index) => {
    proxyIndexByKey.set(
        proxyDedupeKey(proxy.type || 'http', proxy.host, proxy.port, proxy.username || ''), index);
  });
  const folderIdByCsvValue = new Map<string, string>();
  folders.forEach((folder) => {
    const match = /^Imported (.+)$/.exec(folder.name);
    if (match) {
      folderIdByCsvValue.set(match[1], folder.id);
    }
  });

  const result: ImportResult = {
    created: 0,
    updated: 0,
    proxiesCreated: 0,
    proxiesReused: 0,
    foldersCreated: 0,
    tagsTrimmed: 0,
    skipped: [],
  };

  for (const row of rows) {
    const name = (row.name || '').trim();
    if (!name) {
      result.skipped.push({name: row.profile_id || '(unnamed)', reason: 'Missing name'});
      continue;
    }

    let proxyId: string | null = null;
    const parsedProxy = parseProxyConnectionString(row.proxy_name || '');
    if (parsedProxy) {
      const key = proxyDedupeKey(
          parsedProxy.type, parsedProxy.host, parsedProxy.port, parsedProxy.username);
      const existingIndex = proxyIndexByKey.get(key);
      if (existingIndex !== undefined) {
        proxyId = proxies[existingIndex].id;
        result.proxiesReused++;
      } else {
        const proxy: ArgusProxy = {
          id: newId(proxies.length),
          name: row.proxy_id ? `${name} proxy` : `${parsedProxy.host}:${parsedProxy.port}`,
          type: parsedProxy.type,
          host: parsedProxy.host,
          port: parsedProxy.port,
          username: parsedProxy.username || undefined,
          password: parsedProxy.password || undefined,
        };
        proxies.push(proxy);
        newProxies.push(proxy);
        proxyIndexByKey.set(key, proxies.length - 1);
        proxyId = proxy.id;
        result.proxiesCreated++;
      }
    } else {
      result.skipped.push({
        name,
        reason: `Could not parse proxy from "${row.proxy_name || row.proxy_host || 'unknown'}"`,
      });
    }

    let folderId: string | null = null;
    const csvFolder = (row.folder || '').trim();
    if (csvFolder) {
      const existingFolderId = folderIdByCsvValue.get(csvFolder);
      if (existingFolderId) {
        folderId = existingFolderId;
      } else {
        const folder = {
          id: newId(folders.length),
          name: `Imported ${csvFolder}`,
          created_at: new Date().toISOString(),
        };
        folders.push(folder);
        newFolders.push(folder);
        folderIdByCsvValue.set(csvFolder, folder.id);
        folderId = folder.id;
        result.foldersCreated++;
      }
    }

    // profile_id is written verbatim on purpose: re-creating a profile with
    // its exact original id is what reclaims an existing
    // E:\ArgysProfiles\<id> directory, cookies and logged-in sessions
    // intact. Which is also why a malformed one has to be refused here
    // rather than quietly renumbered.
    const importId = (row.profile_id || '').trim() || newId();
    if (!isFsSafeId(importId)) {
      result.skipped.push({
        name,
        reason: `Profile id "${importId}" can't be a folder name (letters, digits, dot, dash, underscore only)`,
      });
      continue;
    }
    const existingIndex = profiles.findIndex((item) => item.id === importId);
    const existing = existingIndex >= 0 ? profiles[existingIndex] : null;
    const createdAt = Date.parse(row.created_at || '') ?
      new Date(row.created_at).toISOString() :
      new Date().toISOString();
    const csvTags = tagsFromDraft(row.tags || '');
    const tags = normalizeTags(csvTags);
    if (tags.length < csvTags.length) {
      result.tagsTrimmed++;
    }
    const profile: ArgusProfile = {
      id: importId,
      name,
      status: row.status_name?.trim() || 'Ready',
      color: existing?.color ?? DEFAULT_PROFILE_COLOR,
      folder_id: folderId,
      proxy_id: proxyId,
      tags,
      start_url: null,
      cookie_import_path: null,
      cookie_import_url: null,
      cookie_import_name: null,
      cookie_import_count: null,
      command_line_switches: null,
      fingerprint: existing?.fingerprint ?? importedProfileFingerprint(),
      created_at: existing?.created_at ?? createdAt,
    };
    if (existing) {
      profiles[existingIndex] = profile;
      result.updated++;
    } else {
      profiles.push(profile);
      result.created++;
    }
    touchedProfiles.push({profile, exists: Boolean(existing)});
  }

  return {profiles, proxies, folders, newProxies, newFolders, touchedProfiles, result};
}

function importedProfileFingerprint(): NonNullable<ArgusProfile['fingerprint']> {
  return {
    os: 'Windows 11',
    browser_version: 'Auto',
    language: languagePresets[0],
    timezone: 'Auto from proxy',
    geolocation: 'Ask',
    webrtc: 'Proxy only',
    canvas: 'Noise',
    webgl: 'Noise',
    webgpu: 'Real',
    client_rects: 'Noise',
    audio: 'Noise',
    webgl_vendor: defaultWindowsFingerprintPattern.fingerprint_webgl_vendor,
    webgl_renderer: defaultWindowsFingerprintPattern.fingerprint_webgl_renderer,
    screen: defaultWindowsFingerprintPattern.fingerprint_screen,
    cpu_model: defaultWindowsFingerprintPattern.fingerprint_cpu_model,
    cpu_cores: numberOrNull(defaultWindowsFingerprintPattern.fingerprint_cpu_cores),
    memory_gb: numberOrNull(defaultWindowsFingerprintPattern.fingerprint_memory_gb),
    media_devices: mediaDevicePresets[0],
    do_not_track: false,
    rotate_on_launch: true,
  };
}
