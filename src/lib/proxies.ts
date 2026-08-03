import {comparable} from './text';
import type {ArgusProfile, ArgusProxy, CloudState} from '../types';

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
    const parts = trimmed.split(':').map((part) => part.trim()).filter(Boolean);
    const first = parts[0]?.toLowerCase();
    const hasTypePrefix = first === 'http' || first === 'https' ||
      first === 'socks' || first === 'socks5';
    const type = hasTypePrefix && first?.startsWith('http') ? 'http' : 'socks5';
    const offset = hasTypePrefix ? 1 : 0;
    if (parts.length >= 2) {
      const port = Number(parts[offset + 1]);
      if (parts[offset] && Number.isInteger(port) && port > 0 && port < 65536) {
        return {
          type,
          host: parts[offset],
          port,
          username: parts[offset + 2] || undefined,
          password: parts[offset + 3] || undefined,
        };
      }
    }
    return null;
  }
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

export function isProxyAssigned(proxy: ArgusProxy, profiles: ArgusProfile[]) {
  return profiles.some((profile) =>
    !profile.deleted_at && comparable(profile.proxy_id) === comparable(proxy.id));
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
