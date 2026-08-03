// The one place a launch payload is assembled. Both launch paths go through
// it: the Launch button in the profiles table, and the local automation API
// (POST /v1/profiles/{id}/launch) driven by an agent. They used to build this
// object separately, so a field added for one silently did nothing in the
// other.
import {anonymousHomeHtml, browserStartUrl, profileDataDir} from './homePage';
import {buildRuntimeFingerprint, fingerprintSwitches} from './fingerprint';
import type {LaunchProfilePayload} from '../native';
import type {ArgusProfile, ArgusProxy, CloudState} from '../types';

export function buildLaunchPayload(
    profile: ArgusProfile,
    proxy: ArgusProxy | null,
    state: CloudState): LaunchProfilePayload {
  // A saved cookie-set (Cookies tab) takes priority over the legacy
  // pasted/uploaded cookie_import_* fields -- both resolve to the same
  // cookieImportUrl the launch payload consumes, just from a different source.
  const savedCookie = profile.cookie_mode === 'saved' && profile.cookie_id ?
    state.cookies.find((item) => item.id === profile.cookie_id) :
    null;
  return {
    id: profile.id,
    name: profile.name,
    userDataDir: profileDataDir(profile.id),
    proxy,
    useFreeProxy: (profile.proxy_mode || 'assigned') === 'free_proxy',
    sharedExtensions: state.shared_extensions,
    commandLineSwitches: [
      profile.command_line_switches || '',
      fingerprintSwitches(profile),
    ].filter(Boolean).join('\n'),
    runtimeFingerprint: buildRuntimeFingerprint(profile),
    startUrl: browserStartUrl(profile),
    homeHtml: anonymousHomeHtml(profile, state.shared_bookmarks, proxy),
    cookieImportPath: savedCookie ? null : (profile.cookie_import_path || null),
    cookieImportUrl: savedCookie ? savedCookie.url : (profile.cookie_import_url || null),
    cookieImportName: savedCookie ? savedCookie.name : (profile.cookie_import_name || null),
    enableCookieManager: state.built_in_extensions?.cookie_manager !== false,
    enableSmsActivate: state.built_in_extensions?.sms_activate !== false,
    enableFoxywallFreeProxy: state.built_in_extensions?.foxywall_free_proxy !== false,
  };
}
