// The sample CSV behind the importer's "Download example" button.
//
// The columns here are not a suggestion: they are exactly the keys
// planCsvImport() in workspace/useProfileActions.ts reads off each row. Any
// other column in the file is parsed and then ignored, which is the failure the
// example exists to prevent -- the format used to be described in prose only,
// so the first import attempt was usually a header-name guess.
import {toCsv} from '../lib/csv';

// name and proxy_name are the two the importer will refuse a row without: a row
// with no name is skipped outright, and one whose proxy_name does not parse is
// skipped with the string it could not read.
export const importColumns: Array<{name: string; required?: boolean; note: string}> = [
  {
    name: 'name',
    required: true,
    note: 'Profile name. A row without one is skipped.',
  },
  {
    name: 'proxy_name',
    required: true,
    note: 'Connection string, exactly http:// or socks5:// then host:port:username:password. ' +
      'Leave the last two empty for an open proxy (host:port::). Proxies are matched and ' +
      'reused by host/port/username, so repeating one does not duplicate it.',
  },
  {
    name: 'profile_id',
    note: 'Re-importing with the same id updates that profile and reclaims its existing ' +
      'browser directory, cookies and sessions. Letters, digits, dot, dash and underscore ' +
      'only. Left empty, a new id is generated.',
  },
  {name: 'status_name', note: 'Defaults to Ready.'},
  {name: 'folder', note: 'Created on demand as "Imported <value>" if it does not exist.'},
  {name: 'tags', note: 'Comma-separated.'},
  {name: 'created_at', note: 'ISO timestamp. Defaults to the time of import.'},
];

// Documentation ranges (RFC 5737 / 3849) rather than anything routable, so a
// copied-and-run example cannot point at someone else's host.
const exampleRows: Record<string, string>[] = [
  {
    name: 'Facebook warmup 01',
    proxy_name: 'socks5://198.51.100.10:1080:proxy-user:proxy-pass',
    profile_id: 'fb-warmup-001',
    status_name: 'Ready',
    folder: 'Facebook',
    tags: 'warmup, facebook',
    created_at: '2026-01-15T09:00:00.000Z',
  },
  {
    name: 'Shop EU 02',
    // The credential-less shape: the trailing colons stay, both fields empty.
    proxy_name: 'http://203.0.113.44:8080::',
    profile_id: 'shop-eu-002',
    status_name: 'Active',
    folder: 'Storefronts',
    tags: 'shop',
    created_at: '',
  },
];

export function profileImportExampleCsv() {
  return toCsv(importColumns.map((column) => column.name), exampleRows, (row) => row);
}

// The proxy-list twin, behind the proxy importer's own "Download example".
// Not a CSV: that importer takes a bare list of connection strings, so the
// example has to be one too, comments and all -- a header row would be the
// first line it reported as unreadable.
//
// Every line here round-trips through parseProxyList unchanged, and the hosts
// are documentation ranges (RFC 5737) rather than anything routable, so a file
// imported as-is cannot point a browser at someone else's machine.
export function proxyImportExampleList() {
  return [
    '# Example proxy list for Argus Launcher.',
    '# One proxy per line. Lines starting with # are ignored.',
    '#',
    '# host:port:username:password -- what most vendors hand out.',
    '198.51.100.10:1080:proxy-user:proxy-pass',
    '198.51.100.11:1080:proxy-user:proxy-pass',
    '',
    '# No credentials? Leave them off, or leave the trailing colons empty.',
    '203.0.113.20:8080',
    '203.0.113.21:8080::',
    '',
    '# A scheme in front sets that line\'s type on its own, whatever the Type',
    '# selector in the dialog says.',
    'http://203.0.113.30:3128:shop-eu:s3cret',
    'socks5://198.51.100.40:9050:warmup:pa55',
    '',
    '# A hostname works exactly like an IP.',
    'gate.example-proxies.test:7000:rotating-user:rotating-pass',
    '',
  ].join('\n');
}
