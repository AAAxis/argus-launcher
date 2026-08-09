// SCRATCH — not part of the app. Aliased over src/native.ts by
// vite.preview.config.ts so the three import dialogs can be screenshotted.
//
// Each of them raises a native file picker the moment it mounts and, with no
// picker there, stops on its own source step -- which is the one step that did
// not need looking at. This hands back fixture files instead, so the review and
// destination steps render exactly as they do in the packaged app.
//
// The proxy fixture is deliberately the shape the bug was about: a headed CSV,
// with a name column, a type column, a row whose endpoint sits in the host cell,
// a duplicate of one already in the fixture library, and a line that cannot be
// read at all. Every badge in the review table has a row.
//
// Delete with the other preview-* files.
const PROXY_CSV = [
  'name,type,host,port,username,password',
  'Berlin 1,socks5,198.51.100.10,1080,proxy-user,proxy-pass',
  'Berlin 2,socks5,198.51.100.11,1080,proxy-user,proxy-pass',
  'Shop EU,http,203.0.113.30,3128,shop-eu,s3cret',
  // No credentials at all, so the banner has something to offer a login to.
  'Open relay,http,203.0.113.40,8080,,',
  'Rotating,socks5,gate.example-proxies.test,7000,,',
  // Already in the fixture library -- lands pre-skipped, badged "Already added".
  'Duplicate,socks5,198.51.100.10,1080,proxy-user,proxy-pass',
  // No port anywhere: unreadable, and fixable in the table.
  'Broken,socks5,not-a-host,,,',
].join('\n');

const PROFILE_CSV = [
  'name,os,status,proxy,tags,folder,start_url',
  'Renter DE-1,Windows,Active,socks5://198.51.100.10:1080:proxy-user:proxy-pass,' +
    'warmup;client-a,Social,https://www.immobilienscout24.de',
  'Renter DE-2,macOS,Ready,198.51.100.12:1080,warmup,Social,',
  // No credentials -- the credential banner's whole case.
  'Renter DE-3,Windows,Warmup,203.0.113.50:8080,,Rentals,',
  'Renter DE-4,Windows,Ready,,client-b,Rentals,',
  // Same name as a profile in the fixture library, so the duplicate row shows.
  'Renter DE-1,Windows,Ready,198.51.100.11:1080,,Social,',
].join('\n');

// A minimal cookie export in each of the two formats the importer accepts, so
// the review table shows a JSON set and a Netscape one side by side.
const JSON_COOKIES = JSON.stringify([
  {domain: '.immobilienscout24.de', name: 'sid', value: 'abc', path: '/',
    secure: true, httpOnly: true, sameSite: 'lax',
    expirationDate: Math.floor(Date.now() / 1000) + 86_400},
  {domain: '.immobilienscout24.de', name: 'csrf', value: 'def', path: '/',
    secure: true, httpOnly: false, sameSite: 'strict',
    expirationDate: Math.floor(Date.now() / 1000) + 86_400},
  {domain: 'www.immobilienscout24.de', name: 'consent', value: 'yes', path: '/',
    secure: false, httpOnly: false, sameSite: 'no_restriction'},
]);

// Two of these expired last year, which is what the amber note is for.
const NETSCAPE_COOKIES = [
  '# Netscape HTTP Cookie File',
  '.facebook.com\tTRUE\t/\tTRUE\t1735689600\tc_user\t100001',
  '.facebook.com\tTRUE\t/\tTRUE\t1735689600\txs\tabcdef',
  '.facebook.com\tTRUE\t/\tTRUE\t2735689600\tdatr\tghijkl',
].join('\n');

const encode = (text: string) =>
  btoa(String.fromCharCode(...new TextEncoder().encode(text)));

export const native = {
  selectProxyFile: async () => ({path: '/Users/roman/Downloads/proxies.csv', content: PROXY_CSV}),
  selectImportCsv: async () => ({path: '/Users/roman/Downloads/profiles.csv', content: PROFILE_CSV}),
  selectCookieFiles: async () => [
    {path: '/Users/roman/Downloads/is24-session.json', name: 'is24-session.json',
      count: 3, base64: encode(JSON_COOKIES)},
    {path: '/Users/roman/Downloads/facebook-cookies.txt', name: 'facebook-cookies.txt',
      count: 3, base64: encode(NETSCAPE_COOKIES)},
  ],
  saveTextFile: async () => null,
};
