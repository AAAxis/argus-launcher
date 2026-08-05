// The one place a launch payload is assembled. Both launch paths go through
// it: the Launch button in the profiles table, and the local automation API
// (POST /v1/profiles/{id}/launch) driven by an agent. They used to build this
// object separately, so a field added for one silently did nothing in the
// other.
import {anonymousHomeHtml, browserStartUrl, profileDataDir} from './homePage';
import {buildRuntimeFingerprint, fingerprintSwitches} from './fingerprint';
import {readSearchEngine} from './searchEngines';
import {startPageAutomations} from './startPageAutomations';
import {readStoredPreference} from '../theme';
import type {LaunchProfilePayload} from '../native';
import type {ArgusProfile, ArgusProxy, CloudState} from '../types';

export function buildLaunchPayload(
    profile: ArgusProfile,
    proxy: ArgusProxy | null,
    state: CloudState,
    // This launch's page credential and the port to spend it on. Supplied on
    // every launch: the start page needs it to re-check its own proxy even when
    // there is nothing to run. Null only when the launcher could not mint one,
    // which makes the page read-only rather than broken.
    startPage?: {port: number; token: string} | null): LaunchProfilePayload {
  // The profile's own automation plus every pinned one -- the same list
  // useProfileActions uses to decide whether this launch needs a debugging
  // port. Read from one place so the tiles on the page and the port behind them
  // cannot disagree, which they could when this was keyed off `startPage`.
  const tileAutomations = startPageAutomations(state.automations, profile)
      .map((item) => ({id: item.id, name: item.name}));
  // A saved cookie-set (Cookies tab) takes priority over the legacy
  // pasted/uploaded cookie_import_* fields -- both resolve to the same
  // cookieImportUrl the launch payload consumes, just from a different source.
  //
  // A trashed set resolves to nothing. Trashing already unassigns the profiles
  // using it, so this only catches the window where another worker trashed a
  // set that this session has not reloaded yet -- but without it Trash would be
  // cosmetic for the one thing a cookie-set is actually for.
  const savedCookie = profile.cookie_mode === 'saved' && profile.cookie_id ?
    state.cookies.find((item) => item.id === profile.cookie_id && !item.deleted_at) :
    null;
  // A profile on 'saved' launches with its set or with nothing. It must NOT
  // fall through to the legacy cookie_import_* fields, which is what the
  // ternaries below would otherwise do: those fields are hidden by the editor
  // while the mode is 'saved' and survive every save, so a profile that was
  // once imported into directly still carries a live copy of that file. Falling
  // back to it would sign the browser straight back in moments after the app
  // reported the set trashed and the profile unassigned.
  //
  // The unassign paths clear those fields too (NO_COOKIES in useCookieActions),
  // so in practice this catches the window where another worker trashed a set
  // that this session has not reloaded yet.
  const savedMode = profile.cookie_mode === 'saved';
  return {
    id: profile.id,
    name: profile.name,
    color: profile.color || null,
    userDataDir: profileDataDir(profile.id),
    proxy,
    useFreeProxy: (profile.proxy_mode || 'assigned') === 'free_proxy',
    // Filtered here rather than in main.cjs so a switched-off extension is
    // never named in the launch payload at all -- main only ever sees the set
    // it is meant to materialize. Undefined means enabled, so rows saved
    // before the switch existed still load (see SharedExtension.enabled).
    sharedExtensions: state.shared_extensions.filter((extension) => extension.enabled !== false),
    commandLineSwitches: [
      profile.command_line_switches || '',
      fingerprintSwitches(profile),
    ].filter(Boolean).join('\n'),
    runtimeFingerprint: buildRuntimeFingerprint(profile),
    startUrl: browserStartUrl(profile),
    // The search engine and the theme are read here rather than inside
    // anonymousHomeHtml so the html builder stays a pure function of its
    // arguments. Both callers of this file -- the Launch button and the local
    // automation API -- run in the renderer, so localStorage is available on
    // either path.
    homeHtml: anonymousHomeHtml(
      profile, state.shared_bookmarks, proxy, readSearchEngine(),
      readStoredPreference(), tileAutomations, startPage || null),
    cookieImportPath: savedMode ? null : (profile.cookie_import_path || null),
    cookieImportUrl: savedMode ?
      (savedCookie?.url || null) :
      (profile.cookie_import_url || null),
    cookieImportName: savedMode ?
      (savedCookie?.name || null) :
      (profile.cookie_import_name || null),
    // Passed through as saved, not normalized here: what a missing key means
    // differs per extension (the three original ones default on so state saved
    // before their toggles existed keeps them; CaptchaPlugin defaults off
    // because it costs a download), and that polarity lives in the registry.
    builtInExtensions: state.built_in_extensions,
  };
}
