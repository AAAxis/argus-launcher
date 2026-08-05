#!/usr/bin/env node
// Asserts the route table and the server agree, in both directions.
//
// electron/api/routes.json is the source of truth for three consumers: the
// pathname allow-list in electron/main.cjs, the tool catalogue in
// electron/mcp/tools.cjs, and the endpoint list the API tab shows. main.cjs now
// derives its allow-list from the table, so those two cannot disagree by
// construction -- but the older routes are still *dispatched* by hand-written
// blocks further down that file, and a route present in the table with no block
// behind it is a documented 404. That is the drift this checks for, and it is
// the exact failure the previous hand-written catalogue shipped: three routes
// documented that were never built.
//
//   node scripts/verify-api-routes.mjs
//
// No Electron, no Supabase, no running launcher. Exits non-zero on the first
// failure so it can sit in the verification checklist next to the other two.
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

const {routes, sessionTools} = JSON.parse(
    readFileSync(join(root, 'electron/api/routes.json'), 'utf8'));
const mainSource = readFileSync(join(root, 'electron/main.cjs'), 'utf8');
const toolsSource = readFileSync(join(root, 'electron/mcp/tools.cjs'), 'utf8');

let failures = 0;

function check(ok, message) {
  if (ok) {
    return;
  }
  failures += 1;
  console.error(`FAIL  ${message}`);
}

// Reports the section just finished. It has to consult the failure count
// rather than print unconditionally: the first version did print
// unconditionally, and a run with ten failures still ended every section with
// an "ok" line -- including "ok 30 tools, no duplicates" directly underneath
// the duplicates it had just found.
let reported = 0;

function pass(message) {
  if (failures > reported) {
    console.log(`FAIL  ${message}`);
    reported = failures;
    return;
  }
  console.log(`ok    ${message}`);
}

// ── 1. Every route is dispatched somewhere ───────────────────────────────────
// A table route is served either by a `channel` (table-driven dispatch), by
// `local: true` (answered in main), or by a hand-written block that names its
// pathname as a string literal.
for (const route of routes) {
  const key = `${route.method} ${route.path}`;
  if (route.channel || route.local) {
    continue;
  }
  check(
      mainSource.includes(`'${route.path}'`),
      `${key} is documented but no handler in main.cjs names its pathname`);
}
pass(`${routes.length} routes each reach a handler`);

// ── 2. Every pathname main.cjs compares against is in the table ──────────────
// The reverse direction: a route served but not documented is invisible to
// agents and to the API tab.
const served = new Set();
for (const match of mainSource.matchAll(/pathname === '(\/v1\/[^']+)'/g)) {
  served.add(match[1]);
}
// The two page routes authenticate with a per-launch run token instead of a key
// and sit above the bearer gate on purpose -- they are not part of the keyed
// surface and must never be advertised as one. run-from-page runs one of the
// launch's own automations; recheck-from-page re-checks that launch's own
// proxy. Both take an id from the token's entry rather than from the request,
// which is what makes them safe to open to a file:// document.
const PAGE_ROUTES = new Set([
  '/v1/automations/run-from-page',
  '/v1/proxies/recheck-from-page',
]);

for (const pathname of served) {
  if (PAGE_ROUTES.has(pathname) || pathname.startsWith('/v1/oauth/')) {
    continue;
  }
  check(
      routes.some((route) => route.path === pathname),
      `main.cjs serves ${pathname} but the table does not document it`);
}
pass(`${served.size} pathnames in main.cjs are accounted for`);

// ── 3. Table-driven routes declare a channel preload will accept ─────────────
const preloadSource = readFileSync(join(root, 'electron/preload.cjs'), 'utf8');
check(
    preloadSource.includes('api/routes.json'),
    'preload.cjs builds its channel allow-list from the table');
for (const route of routes.filter((item) => item.channel)) {
  check(
      /^argus:[a-z-]+$/.test(route.channel),
      `${route.path} declares a malformed channel: ${route.channel}`);
}
pass('table-driven routes declare well-formed channels');

// ── 4. Declared fields are well formed ───────────────────────────────────────
const FIELD_TYPES = new Set(['string', 'number', 'boolean', 'object', 'steps', 'tags', 'strings']);
for (const route of routes) {
  for (const field of route.fields || []) {
    check(
        FIELD_TYPES.has(field.type),
        `${route.path} field ${field.key} has unknown type ${field.type}`);
  }
  check(
      route.scope === 'any' || route.scope === 'unscoped',
      `${route.path} has unknown scope ${route.scope}`);
}
pass('every declared field has a known type');

// ── 5. Every named MCP tool exists ───────────────────────────────────────────
// The generated automations tools come from the table itself, so this catches
// the other direction: a route naming a hand-written tool that was renamed or
// removed, which would leave the agent brief advertising a tool that is not
// there.
const generated = new Set(routes.filter((r) => r.channel || r.local).map((r) => r.mcp));
for (const route of routes.filter((item) => item.mcp)) {
  if (generated.has(route.mcp)) {
    continue;
  }
  check(
      toolsSource.includes(`name: '${route.mcp}'`),
      `${route.path} names MCP tool ${route.mcp}, which tools.cjs does not define`);
}
for (const tool of sessionTools) {
  check(
      toolsSource.includes(`name: '${tool}'`),
      `sessionTools names ${tool}, which tools.cjs does not define`);
}
pass('every MCP tool named in the table is defined');

// ── 6. Tools that need a description have one ────────────────────────────────
for (const route of routes.filter((item) => item.channel || item.local)) {
  check(
      Boolean(route.mcpDescription),
      `${route.path} is table-driven and exposed as ${route.mcp} but has no mcpDescription`);
}
pass('generated tools carry descriptions');

// ── 7. The built catalogue has no duplicates ─────────────────────────────────
// The generator filters on `channel || local`, not on `mcp`, because nine of
// the hand-written tools also carry an `mcp` name so the agent brief can list
// every tool from one file. Filtering on `mcp` alone silently generated a
// second, field-less copy of each of those nine: tools/list answered with
// thirty tools, and BY_NAME resolved argus_update_profile to the generated
// copy, which forwards no fields at all. Nothing else would have caught it.
const {listed} = await import(`file://${join(root, 'electron/mcp/tools.cjs')}`)
    .then((module) => module.default || module);
const built = listed();
const names = built.map((tool) => tool.name);
check(
    names.length === new Set(names).size,
    `tools.cjs defines duplicate tool names: ${
      names.filter((name, i) => names.indexOf(name) !== i).join(', ')}`);
for (const tool of built) {
  check(
      Boolean(tool.description) && Boolean(tool.inputSchema),
      `${tool.name} is missing a description or inputSchema`);
}
pass(`${built.length} tools, no duplicates`);

if (failures > 0) {
  console.error(`\n${failures} check${failures === 1 ? '' : 's'} failed.`);
  process.exit(1);
}
console.log('\nAll route-table checks passed.');
