import {comparable} from './text';
import {countryName} from '../data/folderIcons';
import type {ArgusProfile, ArgusProxy, CloudState} from '../types';

// What the country columns and the country search agree a proxy's country is.
//
// The check endpoints do not agree with each other: some hand back
// "United States", some only "US" (see resolveProxyLocation in main.cjs), so
// proxy.country is whichever of the two that proxy's lookup happened to land
// on. Rendering the stored string as-is meant a table full of "US" that the
// "United States" the move dialog seeds its search with could not match --
// eleven proxies ticked, and "No proxies match that search" over them.
export function proxyCountryLabel(proxy: ArgusProxy) {
  const stored = proxy.country?.trim();
  if (stored && stored.length > 2) {
    return stored;
  }
  const code = (stored || proxy.country_code)?.trim();
  return code ? countryName(code) : '';
}

// Everything a proxy can be searched by, as one lowercase haystack. Both the
// table and the move dialog filter through this so they can never disagree
// about whether a proxy matches -- the country name is in here even when the
// row only ever stored the code.
export function proxySearchText(proxy: ArgusProxy) {
  return [proxy.name, proxy.host, String(proxy.port || ''), proxy.username,
    proxy.country, proxy.country_code, proxyCountryLabel(proxy), proxy.type]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
}

export function proxyOptionLabel(proxy: ArgusProxy) {
  const name = proxy.name || `${proxy.host}:${proxy.port || ''}`;
  const type = (proxy.type || 'http').toUpperCase();
  const port = proxy.port ? proxy.port : 'no port';
  return `${name} · ${type} · ${proxy.host}:${port}`;
}

// Parses the "<type>://<host>:<port>:<username>:<password>" connection string
// the browser/inventory tooling embeds in proxy_name (see argus-browser's CSV
// fix-up), e.g. "socks5://45.192.39.37:63947:Evd8sDYf:pr1Ywfsh".
export function parseProxyConnectionString(raw: string): {
  type: 'http' | 'socks5';
  host: string;
  port: number;
  username: string;
  password: string;
} | null {
  const match = /^(http|socks5):\/\/([^:]+):(\d+):([^:]*):(.*)$/.exec(raw.trim());
  if (!match) {
    return null;
  }
  const [, type, host, port, username, password] = match;
  return {type: type as 'http' | 'socks5', host, port: Number(port), username, password};
}

export function proxyDedupeKey(type: string, host: string, port: number, username: string) {
  return [type, host, port, username].join('|').toLowerCase();
}

// Accepts either a real URL (http://user:pass@host:port, socks5://...) or the
// colon-delimited "type:host:port:user:pass" shorthand people paste from proxy
// vendors, which is not a URL at all.
export function parseProxyLink(value: string): Omit<ArgusProxy, 'id' | 'name'> | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  try {
    const withProtocol = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `socks5://${trimmed}`;
    const url = new URL(withProtocol);
    const protocol = url.protocol.replace(':', '').toLowerCase();
    const type = protocol.startsWith('http') ? 'http' : 'socks5';
    const port = Number(url.port);
    if (!url.hostname || !Number.isInteger(port) || port < 1 || port > 65535) {
      return null;
    }
    return {
      type,
      host: url.hostname,
      port,
      username: decodeURIComponent(url.username || '') || undefined,
      password: decodeURIComponent(url.password || '') || undefined,
    };
  } catch {
    // "socks5://host:port:user:pass" lands here rather than in the URL branch
    // above -- ":1080:user:pass" is not a valid URL port, so the parse throws.
    // Flattening "://" to ":" makes it the same shape as the bare shorthand;
    // without this the leading "//" stayed glued to the host and every such
    // line imported a hostname curl could not resolve.
    const flat = trimmed.replace(/^([a-z][a-z0-9+.-]*):\/\//i, '$1:');
    // Empty segments are kept (no filter(Boolean)): dropping them silently
    // shifted a password into the username slot for "host:port::pass".
    const parts = flat.split(':').map((part) => part.trim());
    const first = parts[0]?.toLowerCase();
    const hasTypePrefix = first === 'http' || first === 'https' ||
      first === 'socks' || first === 'socks5';
    const type = hasTypePrefix && first?.startsWith('http') ? 'http' : 'socks5';
    const rest = hasTypePrefix ? parts.slice(1) : parts;
    // host:port:user:pass, the order every vendor list uses.
    if (rest[0] && isPort(rest[1])) {
      return {
        type,
        host: rest[0],
        port: Number(rest[1]),
        username: rest[2] || undefined,
        password: rest[3] || undefined,
      };
    }
    // user:pass:host:port -- the other order in circulation, and the reason
    // this does not simply read slots 0 and 1. Only accepted when the third
    // segment actually looks like a host and the fourth like a port, so a
    // password that happens to be numeric cannot turn a line inside out.
    if (rest.length === 4 && looksLikeProxyHost(rest[2]) && isPort(rest[3])) {
      return {
        type,
        host: rest[2],
        port: Number(rest[3]),
        username: rest[0] || undefined,
        password: rest[1] || undefined,
      };
    }
    return null;
  }
}

function isPort(value: string | undefined) {
  if (!value || !/^\d{1,5}$/.test(value)) {
    return false;
  }
  const port = Number(value);
  return port > 0 && port < 65536;
}

// An IPv4 literal, a bracketed IPv6 one, or a dotted hostname. Deliberately
// stricter than "not empty": this is only ever asked about a segment whose
// position is ambiguous, and a credential is far more likely than a hostname
// with no dot in it.
//
// Exported for the proxy editor, which offers to split a pasted line in every
// field including Password -- a password of "hunter2:1080" parses perfectly
// well as a connection string, and this is what stops it being treated as one.
export function looksLikeProxyHost(value: string | undefined) {
  if (!value) {
    return false;
  }
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(value) ||
    /^\[[0-9a-f:]+\]$/i.test(value) ||
    /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i.test(value);
}

// One line of a pasted or imported proxy list, already classified against the
// proxies that exist. `duplicate` rows are kept rather than dropped so the
// import preview can say "8 new, 2 already in your list" instead of silently
// importing a different number than the file contained.
export type ParsedProxyLine = {
  line: number;
  raw: string;
  proxy: Omit<ArgusProxy, 'id'> | null;
  duplicate: boolean;
  // False when the line was a bare "host:port:user:pass" and the type is only
  // parseProxyLink's socks5 default, so the import dialog knows which rows its
  // type selector is allowed to reassign.
  explicitType: boolean;
  error?: string;
};

// The name a proxy gets when the source gave us none -- every vendor list is
// bare connection strings, and "206.251.200.171:47450" is what the user
// recognises a row by. Kept identical to the fallback in useProxyActions.save
// so a hand-added proxy and an imported one are named the same way.
export function defaultProxyName(host: string, port: number) {
  return `${host}:${port}`;
}

// Splits a proxy list file (or a pasted block) into one result per non-empty
// line. Blank lines and `#` comments are dropped entirely; anything else that
// fails to parse comes back with an error so the preview can show which line
// was wrong rather than quietly importing fewer proxies than the file held.
//
// Every line format parseProxyLink accepts works here: the bare
// "host:port:user:pass" that vendors hand out, the "socks5://..." URL form,
// and a "type:host:port:user:pass" prefix.
export function parseProxyList(content: string, existing: ArgusProxy[]): ParsedProxyLine[] {
  const seen = new Set(existing.map((proxy) =>
    proxyDedupeKey(proxy.type || 'http', proxy.host, proxy.port, proxy.username || '')));
  const results: ParsedProxyLine[] = [];
  content.split(/\r?\n/).forEach((rawLine, index) => {
    const raw = rawLine.trim();
    if (!raw || raw.startsWith('#')) {
      return;
    }
    const parsed = parseProxyLink(raw);
    if (!parsed) {
      results.push({line: index + 1, raw, proxy: null, duplicate: false, explicitType: false,
        error: 'Not a proxy — expected host:port:username:password'});
      return;
    }
    const explicitType = /^(https?|socks5?):(\/\/)?/i.test(raw);
    const type = parsed.type || 'socks5';
    const key = proxyDedupeKey(type, parsed.host, parsed.port, parsed.username || '');
    // Duplicates are matched against the file's own earlier lines too, so a
    // list that repeats a proxy imports it once.
    const duplicate = seen.has(key);
    seen.add(key);
    results.push({
      line: index + 1,
      raw,
      proxy: {...parsed, type, name: defaultProxyName(parsed.host, parsed.port)},
      duplicate,
      explicitType,
    });
  });
  return results;
}

export function matchedProxyForProfile(profile: ArgusProfile, proxies: ArgusProxy[]) {
  const current = proxies.find((proxy) =>
    comparable(proxy.id) === comparable(profile.proxy_id));
  if (current) {
    return current;
  }
  const profileName = comparable(profile.name);
  return proxies.find((proxy) => {
    const proxyName = comparable(proxy.name);
    return proxyName === `${profileName} proxy` ||
      proxyName === profileName ||
      proxyName.startsWith(`${profileName} `);
  }) || null;
}

// Which profiles are actually holding this proxy. Assignment is many-to-one --
// nothing stops two profiles pointing at the same proxy -- so this returns a
// list rather than a profile, and the table's "Assigned to" column says "+2"
// instead of pretending there is one answer.
//
// Trashed profiles do not count. A soft-deleted profile is not launching
// anything, so a proxy held only by one is free to be reused.
export function profilesUsingProxy(proxy: ArgusProxy, profiles: ArgusProfile[]) {
  return profiles.filter((profile) =>
    !profile.deleted_at && comparable(profile.proxy_id) === comparable(proxy.id));
}

// Defined over profilesUsingProxy rather than repeating its filter, so the
// Assigned/Not-assigned dropdown and the column that names the profiles can
// never disagree about what "assigned" means.
export function isProxyAssigned(proxy: ArgusProxy, profiles: ArgusProfile[]) {
  return profilesUsingProxy(proxy, profiles).length > 0;
}

export function repairProxyAssignments(state: CloudState) {
  let repaired = 0;
  const profiles = state.profiles.map((profile) => {
    const proxy = matchedProxyForProfile(profile, state.proxies);
    if (!proxy) {
      return profile;
    }
    const alreadyAssigned = comparable(profile.proxy_id) === comparable(proxy.id);
    const alreadyAssignedMode = (profile.proxy_mode || 'assigned') === 'assigned';
    if (alreadyAssigned && alreadyAssignedMode) {
      return profile;
    }
    repaired++;
    return {...profile, proxy_id: proxy.id, proxy_mode: 'assigned' as const};
  });
  return {state: {...state, profiles}, repaired};
}
