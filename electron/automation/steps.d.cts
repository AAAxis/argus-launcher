// Hand-written declarations for steps.cjs, so the vitest suite under src/ can
// import the real cookie mapper and filter instead of testing a copy. Nothing
// compiles electron/ (see notify.d.cts beside this for the same pattern) --
// change one side of this contract, change the other.

// CDP Storage.getCookies' cookie shape (a subset -- only the fields the
// mapper reads). `expires` is in seconds; -1 means session.
export type CdpCookie = {
  name: string;
  value: string;
  domain: string;
  path: string;
  secure?: boolean;
  httpOnly?: boolean;
  sameSite?: 'Strict' | 'Lax' | 'None';
  expires?: number;
};

// The shape src/lib/cookieFile.ts normalizeCookie() expects on the way in --
// see its header comment for why this contract must not drift.
export type MappedCookie = {
  name: string;
  value: string;
  domain: string;
  path: string;
  secure: boolean;
  httpOnly: boolean;
  sameSite?: 'strict' | 'lax' | 'no_restriction';
  expirationDate?: number;
};

export function cdpCookieToEntry(cookie: CdpCookie): MappedCookie;

export function filterCookiesByDomain(cookies: CdpCookie[], domain: string | undefined): CdpCookie[];
