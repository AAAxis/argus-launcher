#!/usr/bin/env node
// Drives electron/automation/run-token.cjs -- the actual module main.cjs uses --
// over a real HTTP server, and asserts the properties the start-page trigger
// depends on.
//
// These are not style checks. The start page is a file:// document holding a
// credential, reachable from a loopback port that any process on the machine
// can talk to, on a server whose keyed routes send Access-Control-Allow-Origin:
// *. Each assertion below is one of the four conditions that made shipping this
// trigger acceptable at all; if any stops holding, the trigger should be cut
// rather than weakened.
//
//   node scripts/verify-run-token.mjs
import {createServer} from 'node:http';
import {createConnection} from 'node:net';
import {createRequire} from 'node:module';

const require = createRequire(import.meta.url);
const {
  createRunTokens, handleRecheckFromPage, handleRunFromPage,
  handleOpenInLauncherFromPage,
  handleCookiePushFromPage, handleCookiePullFromPage, COOKIE_MAX_BODY_BYTES,
} = require('../electron/automation/run-token.cjs');

const PORT = 38998;
const results = [];
function check(label, ok, detail) {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ` -- ${detail}` : ''}`);
}

const sendJson = (res, code, body) => {
  res.writeHead(code, {'Content-Type': 'application/json'});
  res.end(JSON.stringify(body));
};

// A clock we control, so the expiry case is real rather than a sleep.
let clockOffset = 0;
const tokens = createRunTokens({now: () => Date.now() + clockOffset});

let started = 0;
// Every page route on one server, told apart by path exactly as main.cjs does.
const rechecked = [];
const pushed = [];
const opened = [];
const server = createServer((req, res) => {
  if (req.url === '/open') {
    handleOpenInLauncherFromPage({
      req,
      res,
      tokens,
      sendJson,
      open: (entry, automation) => {
        opened.push({profileId: entry.profileId, automationId: automation.id});
      },
    });
    return;
  }
  if (req.url === '/recheck') {
    handleRecheckFromPage({
      req,
      res,
      tokens,
      sendJson,
      recheck: async (entry) => {
        rechecked.push(entry.profileId);
        return {proxyOk: true, title: 'Anti-detect proxy active', detail: '1.2.3.4:80 · US · 90ms'};
      },
    });
    return;
  }
  if (req.url === '/cookie-push') {
    handleCookiePushFromPage({
      req, res, tokens, sendJson,
      pushCookies: async (entry, cookies, saveAs) => {
        // `cookies` is kept, not just its length, so a chunk-boundary
        // corruption test can inspect the actual value that arrived.
        // `saveAs` is kept too, so the type-gate below (a string survives, a
        // non-string is dropped to undefined) can be asserted directly.
        pushed.push({profileId: entry.profileId, count: cookies.length, cookies, saveAs});
        return {saved: cookies.length, set: saveAs};
      },
    });
    return;
  }
  if (req.url === '/cookie-pull') {
    handleCookiePullFromPage({
      req, res, tokens, sendJson,
      pullCookies: async (entry) => ({cookies: [{name: 'sid', value: 'v', domain: entry.profileId}]}),
    });
    return;
  }
  handleRunFromPage({
    req,
    res,
    tokens,
    sendJson,
    startRun: async () => {
      started += 1;
      return `run_${started}`;
    },
  });
});

async function post(body, headers = {'Content-Type': 'application/json'}, path = '/') {
  const response = await fetch(`http://127.0.0.1:${PORT}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  return {status: response.status, text: await response.text()};
}

const postRecheck = (body, headers) =>
  post(body, headers || {'Content-Type': 'application/json'}, '/recheck');

// Sends a raw HTTP/1.1 POST with the body split into two separate socket
// writes at `splitAt` bytes -- fetch() cannot control TCP framing closely
// enough to force a multi-byte character to straddle a chunk boundary, which
// is exactly the case the StringDecoder fix has to survive.
function rawSplitPost(path, bodyBuf, splitAt) {
  return new Promise((resolve, reject) => {
    const socket = createConnection(PORT, '127.0.0.1', () => {
      socket.setNoDelay(true);
      const head = `POST ${path} HTTP/1.1\r\nHost: 127.0.0.1:${PORT}\r\n` +
          `Content-Type: application/json\r\nContent-Length: ${bodyBuf.length}\r\nConnection: close\r\n\r\n`;
      socket.write(Buffer.concat([Buffer.from(head, 'utf8'), bodyBuf.subarray(0, splitAt)]), () => {
        // The delay matters: without it, both writes can still land in one
        // OS-level read on loopback and the split proves nothing. This gives
        // the server time to actually consume the first partial chunk before
        // the rest of the character arrives.
        setTimeout(() => socket.write(bodyBuf.subarray(splitAt)), 20);
      });
    });
    let raw = Buffer.alloc(0);
    socket.on('data', (chunk) => {
      raw = Buffer.concat([raw, chunk]);
    });
    socket.on('end', () => {
      const text = raw.toString('utf8');
      const status = Number(text.split('\r\n', 1)[0].split(' ')[1]);
      resolve({status, text: text.slice(text.indexOf('\r\n\r\n') + 4)});
    });
    socket.on('error', reject);
  });
}

await new Promise((resolve) => server.listen(PORT, '127.0.0.1', resolve));

const token = tokens.mint({
  profileId: 'p1',
  profileName: 'Probe',
  cdpPort: 1234,
  automations: [{id: 'a1', name: 'Mine', steps: []}],
});

const unknown = await post({runToken: 'f'.repeat(64), automationId: 'a1'});
const wrongId = await post({runToken: token, automationId: 'someone-elses'});
const noSteps = await post({runToken: token, automationId: 'a1', steps: [{type: 'evaluate'}]});
const formPost = await post({runToken: token, automationId: 'a1'},
    {'Content-Type': 'application/x-www-form-urlencoded'});
const ok = await post({runToken: token, automationId: 'a1'});

check('a valid token runs its own automation', ok.status === 200 && started > 0, ok.text);
check('unknown token refused', unknown.status === 403);
check('valid token naming a foreign automation refused', wrongId.status === 403);
check('unknown and foreign-id refusals are byte-identical (not an oracle)',
    unknown.status === wrongId.status && unknown.text === wrongId.text, unknown.text);
check('a body carrying its own steps cannot inject them',
    noSteps.status === 200 && started === 2,
    'steps in the body are ignored; the workflow is looked up by id');
check('non-JSON content type refused (blocks a cross-origin form POST)',
    formPost.status === 403);

// ── The open-in-launcher route ───────────────────────────────────────────────
// Same credential, third power: raise the launcher window with one of this
// launch's own automations showing. It is authorized by the SAME check the run
// route uses, so the properties that matter are that it cannot be aimed at a
// workflow this launch does not offer, and that refusing is indistinguishable
// from holding a token that was never valid -- otherwise it becomes a way to
// enumerate an org's automations from a page that should know nothing.
//
// Its own token, so these four requests do not eat the run token's
// 10-per-minute budget and change what the checks above measure.
const openToken = tokens.mint({
  profileId: 'p-open',
  profileName: 'Opener',
  cdpPort: null,
  automations: [{id: 'a1', name: 'Mine', steps: []}],
});
const postOpen = (body, headers) =>
  post(body, headers || {'Content-Type': 'application/json'}, '/open');

const openOk = await postOpen({runToken: openToken, automationId: 'a1'});
check('a valid token opens one of its own automations in the launcher',
    openOk.status === 200 && opened.length === 1, openOk.text);
check('the profile comes off the token, not the request',
    opened[0]?.profileId === 'p-open' && opened[0]?.automationId === 'a1',
    JSON.stringify(opened[0]));

const openForeign = await postOpen({runToken: openToken, automationId: 'someone-elses'});
check('a workflow this launch does not offer cannot be opened',
    openForeign.status === 403 && opened.length === 1, openForeign.text);
check('and it refuses byte-identically to an unknown token (not an enumeration oracle)',
    openForeign.status === unknown.status && openForeign.text === unknown.text,
    openForeign.text);

const openForm = await postOpen({runToken: openToken, automationId: 'a1'},
    {'Content-Type': 'application/x-www-form-urlencoded'});
check('non-JSON content type refused on the open route too',
    openForm.status === 403 && opened.length === 1);

// ── The re-check route ───────────────────────────────────────────────────────
// Same credential, second power: re-check the profile's assigned proxy. It has
// to hold the same properties as the run route, and one more of its own -- the
// profile is taken off the token's entry, so a caller cannot aim it.
//
// Its own token, on its own profile, so these requests do not eat the run
// token's 10-per-minute budget and change what the checks above measure.
const pageToken = tokens.mint({
  profileId: 'p9',
  profileName: 'Page',
  // Null, as on a launch with nothing pinned and nothing attached: no debugging
  // port was reserved, and the token exists purely so the page can re-check.
  cdpPort: null,
  automations: [],
});

const recheckOk = await postRecheck({runToken: pageToken});
check('a valid token re-checks its own proxy',
    recheckOk.status === 200 && rechecked.length === 1, recheckOk.text);
check('the profile comes off the token, not the request',
    rechecked[0] === 'p9',
    'the body carries nothing but the token, so there is no id to aim');

// A token minted with no automations can re-check and nothing else -- this is
// what every ordinary launch now carries.
const runWithPageToken = await post({runToken: pageToken, automationId: 'a1'});
check('a re-check-only token cannot run anything',
    runWithPageToken.status === 403 && started === 2, runWithPageToken.text);
check('and it refuses byte-identically to an unknown token',
    runWithPageToken.text === unknown.text);

const recheckUnknown = await postRecheck({runToken: 'f'.repeat(64)});
const recheckForm = await postRecheck({runToken: pageToken},
    {'Content-Type': 'application/x-www-form-urlencoded'});
check('unknown token refused on the re-check route', recheckUnknown.status === 403);
check('re-check refusals are byte-identical to the run route\'s (not an oracle)',
    recheckUnknown.status === unknown.status && recheckUnknown.text === unknown.text,
    recheckUnknown.text);
check('non-JSON content type refused on the re-check route too',
    recheckForm.status === 403);
check('a refused re-check never reaches the checker', rechecked.length === 1);

// Expiry, via the injected clock rather than a 12-hour wait.
clockOffset = 13 * 60 * 60 * 1000;
const expired = await post({runToken: token, automationId: 'a1'});
const expiredRecheck = await postRecheck({runToken: pageToken});
check('expired token refused', expired.status === 403);
check('expired and unknown are byte-identical (not an oracle)',
    expired.status === unknown.status && expired.text === unknown.text);
check('the TTL covers the re-check route as well',
    expiredRecheck.status === 403 && rechecked.length === 1);

// ---- cookie-sync routes ----------------------------------------------------
{
  const token = tokens.mint({profileId: 'prof-cookie', profileName: 'C', cdpPort: null, automations: []});
  const good = await post({runToken: token, cookies: [{name: 'a'}, {name: 'b'}]},
      {'Content-Type': 'application/json'}, '/cookie-push');
  check('cookie push with a valid token succeeds', good.status === 200 &&
      pushed.length === 1 && pushed[0].profileId === 'prof-cookie' && pushed[0].count === 2,
  `status ${good.status}`);

  // The payload names no profile -- the entry's own profile is used
  // regardless of what the caller writes into the body, so a leaked token
  // cannot be aimed at someone else's cookies by lying about whose they are.
  const decoy = await post({runToken: token, profileId: 'victim', cookies: [{name: 'z'}]},
      {'Content-Type': 'application/json'}, '/cookie-push');
  check('a decoy profileId in the payload is ignored; the push lands on the token\'s own profile',
      decoy.status === 200 && pushed.at(-1).profileId === 'prof-cookie', JSON.stringify(pushed.at(-1)));

  const bad = await post({runToken: 'nope', cookies: []},
      {'Content-Type': 'application/json'}, '/cookie-push');
  const badRecheck = await postRecheck({runToken: 'nope'});
  check('cookie push refusal is indistinguishable from the page routes\'',
      bad.status === 403 && bad.text === badRecheck.text, bad.text);

  const pull = await post({runToken: token}, {'Content-Type': 'application/json'}, '/cookie-pull');
  check('cookie pull returns the profile\'s cookies',
      pull.status === 200 && JSON.parse(pull.text).cookies[0].domain === 'prof-cookie',
      pull.text);

  // The cookie bucket is separate: 12/min per token. Three calls above (push,
  // decoy push, pull) spent 3 of it; the next 9 must succeed and the 10th (the
  // 13th overall) must be refused with 429. Checking only the last status
  // would also pass for a bucket SHARED with the run/recheck routes -- every
  // status is asserted so this actually proves the 12/min cap, not just that
  // *some* call eventually gets rate-limited.
  const pullStatuses = [];
  for (let i = 0; i < 10; i++) {
    pullStatuses.push((await post({runToken: token}, {'Content-Type': 'application/json'}, '/cookie-pull')).status);
  }
  check('cookie bucket rate-limits at exactly 12 per token per minute',
      pullStatuses.slice(0, 9).every((status) => status === 200) && pullStatuses[9] === 429,
      `statuses ${pullStatuses.join(',')}`);

  // The same token can still use the page routes while its cookie bucket is
  // exhausted -- proving the two buckets don't starve each other, not just
  // that each one counts up independently.
  const recheckWhileCookieExhausted = await postRecheck({runToken: token});
  check('the page-route bucket is unaffected by an exhausted cookie bucket',
      recheckWhileCookieExhausted.status === 200, recheckWhileCookieExhausted.text);

  // A payload over the cookie cap destroys the connection rather than buffering.
  const bigValue = 'x'.repeat(COOKIE_MAX_BODY_BYTES + 1024);
  const oversized = await post({runToken: token, cookies: [{name: 'big', value: bigValue}]},
      {'Content-Type': 'application/json'}, '/cookie-push').then(() => 'answered', () => 'destroyed');
  check('cookie push over the 10 MB cap is destroyed', oversized === 'destroyed', oversized);

  // Expiry via the clock this script already controls, on the cookie routes
  // too. A token of its own -- `token`'s cookie budget is already spent above,
  // and a 429 here would be mistaken for the 403 this is actually testing.
  const expiryToken = tokens.mint({profileId: 'prof-cookie-2', profileName: 'C2', cdpPort: null, automations: []});
  clockOffset += 13 * 60 * 60 * 1000;
  const expiredCookiePush = await post({runToken: expiryToken, cookies: []},
      {'Content-Type': 'application/json'}, '/cookie-push');
  const expiredCookieUnknown = await post({runToken: 'e'.repeat(64), cookies: []},
      {'Content-Type': 'application/json'}, '/cookie-push');
  check('an expired token is refused on the cookie routes too, byte-identically to unknown',
      expiredCookiePush.status === 403 && expiredCookiePush.text === expiredCookieUnknown.text,
      expiredCookiePush.text);
}

// ---- saveAs: a library-save name is DATA, type-gated but never trusted ----
// `saveAs` is the one field the push route added for the "save to Cookies
// tab" feature. It carries no authority -- the profile still comes from the
// token entry above, exactly as `cookies` always has -- so this only proves
// the type gate: a string survives to `pushCookies` unchanged, anything else
// (here, a number) is dropped to undefined rather than forwarded as-is. The
// actual sanitize-or-reject of the string (trim/cap/strip) is renderer-side
// (src/lib/cookieSync.ts's sanitizeSetName, unit-tested there), out of reach
// of this Electron-free harness.
{
  const token = tokens.mint({profileId: 'prof-saveas', profileName: 'SA', cdpPort: null, automations: []});
  const withName = await post({runToken: token, cookies: [{name: 'a'}], saveAs: 'amazon login'},
      {'Content-Type': 'application/json'}, '/cookie-push');
  check('a string saveAs is passed through to the work function unchanged',
      withName.status === 200 && pushed.at(-1).saveAs === 'amazon login', JSON.stringify(pushed.at(-1)));

  const withoutName = await post({runToken: token, cookies: [{name: 'a'}]},
      {'Content-Type': 'application/json'}, '/cookie-push');
  check('an absent saveAs stays undefined (the default live-sync path)',
      withoutName.status === 200 && pushed.at(-1).saveAs === undefined, JSON.stringify(pushed.at(-1)));

  const withNonString = await post({runToken: token, cookies: [{name: 'a'}], saveAs: 12345},
      {'Content-Type': 'application/json'}, '/cookie-push');
  check('a non-string saveAs is dropped to undefined rather than forwarded',
      withNonString.status === 200 && pushed.at(-1).saveAs === undefined, JSON.stringify(pushed.at(-1)));
}

// ---- F3 regression: a non-object JSON body must not crash the process -----
// Each check below mints its own token so it neither draws on nor pollutes
// the rate-limit arithmetic the blocks above and below depend on.
{
  const nullBody = await post(null, {'Content-Type': 'application/json'}, '/cookie-pull');
  check('a literal `null` JSON body on a cookie route is refused, not thrown (F3 regression)',
      nullBody.status === 403 && nullBody.text === unknown.text, nullBody.text);

  // The real assertion is the process surviving to answer this at all: the
  // pre-fix bug dereferenced `payload.runToken` on `null` inside an async
  // handler with no unhandledRejection listener anywhere upstream, which
  // is a crash, not a rejected promise the caller can catch.
  const stillUpToken = tokens.mint({profileId: 'prof-still-up', profileName: 'S', cdpPort: null, automations: []});
  const stillUp = await post({runToken: stillUpToken}, {'Content-Type': 'application/json'}, '/cookie-pull');
  check('the server is still answering requests after a null-body request (F3 regression)',
      stillUp.status === 200, stillUp.text);
}

// ---- F1 regression: UTF-16 length under the cap, UTF-8 byte length over ---
{
  // Each of these characters is one UTF-16 code unit but three UTF-8 bytes:
  // 2000 of them is ~2000 by `.length` (comfortably under the 4096-byte page
  // cap) but ~6000 bytes on the wire (comfortably over it). A cap compared
  // against `body.length` instead of wire bytes admits this; the byte-counted
  // cap must not.
  const wideChars = '日'.repeat(2000);
  const overByteCap = await post({runToken: 'irrelevant', big: wideChars})
      .then(() => 'answered', () => 'destroyed');
  check('a body under the UTF-16-length cap but over the UTF-8-byte cap is destroyed (F1 regression)',
      overByteCap === 'destroyed', overByteCap);
}

// ---- F2 regression: a multi-byte character split across two socket writes -
{
  const multibyteToken = tokens.mint({profileId: 'prof-multibyte', profileName: 'MB', cdpPort: null, automations: []});
  const cookieValue = '日本語クッキー😀Ω';
  const payloadBuf = Buffer.from(
      JSON.stringify({runToken: multibyteToken, cookies: [{name: 'mb', value: cookieValue}]}), 'utf8');
  // Cut partway into the value's bytes -- every character in it is 2+ UTF-8
  // bytes, so this lands mid-character rather than on a boundary.
  const valueOffset = payloadBuf.indexOf(Buffer.from(cookieValue, 'utf8'));
  const split = await rawSplitPost('/cookie-push', payloadBuf, valueOffset + 4);
  check('a multi-byte character split across two socket writes arrives byte-exact, not U+FFFD (F2 regression)',
      split.status === 200 && pushed.at(-1).cookies?.[0]?.value === cookieValue,
      JSON.stringify(pushed.at(-1)));
}

// ---- F4 mirror direction: page-route bucket exhausted, cookie route unaffected
{
  const mirrorToken = tokens.mint({profileId: 'prof-mirror', profileName: 'M', cdpPort: null, automations: []});
  const pageStatuses = [];
  for (let i = 0; i < 11; i++) {
    pageStatuses.push((await post({runToken: mirrorToken, automationId: 'nope'})).status);
  }
  check('this token\'s page-route (run/recheck) bucket rate-limits at 10 per minute',
      pageStatuses.slice(0, 10).every((status) => status === 403) && pageStatuses[10] === 429,
      `statuses ${pageStatuses.join(',')}`);

  const cookiePullWhilePageExhausted = await post({runToken: mirrorToken}, {'Content-Type': 'application/json'}, '/cookie-pull');
  check('a cookie route still answers 200 while the same token\'s page-route bucket is exhausted (F4 mirror direction)',
      cookiePullWhilePageExhausted.status === 200, cookiePullWhilePageExhausted.text);
}

// A fresh store, so the earlier requests do not count toward the limit.
const fresh = createRunTokens();
const freshToken = fresh.mint({profileId: 'p2', cdpPort: 1, automations: [{id: 'a1'}]});
let limited = null;
for (let i = 0; i < 12; i++) {
  const verdict = fresh.authorize({runToken: freshToken, automationId: 'a1'});
  if (!verdict.ok && verdict.status === 429) {
    limited = i;
    break;
  }
}
check('per-token rate limit engages', limited !== null, `after ${limited} requests`);

// Lifetime: a relaunch must not leave the old launch's token working.
//
// On its own store, not the one above -- that one has its clock pushed 13 hours
// forward, so its token is already expired and pruned, and "did minting replace
// it" would be measuring the TTL instead.
const lifetime = createRunTokens();
const first = lifetime.mint({profileId: 'p1', cdpPort: 1, automations: [{id: 'a1'}]});
lifetime.mint({profileId: 'p1', cdpPort: 2, automations: [{id: 'a1'}]});
check('relaunching a profile replaces its token rather than adding one',
    lifetime.size() === 1, `size ${lifetime.size()}`);
check('the previous launch\'s token stops working',
    lifetime.authorize({runToken: first, automationId: 'a1'}).ok === false);
lifetime.dropForProfile('p1');
check('dropForProfile clears it (called when the session is killed)',
    lifetime.size() === 0);

// Org scoping. The entry carries the workspace the launch was composed under so
// the renderer can resolve the profile against the org it belongs to rather
// than whichever one is active when the request lands. The security-relevant
// half is the second check: a caller must never be able to name its own org.
const scoped = createRunTokens();
const scopedToken = scoped.mint({profileId: 'p9', orgId: 'org-alpha', automations: []});
check('the minted entry carries the workspace it was launched from',
    scoped.authorizeCookieSync({runToken: scopedToken}).entry.orgId === 'org-alpha');
check('an orgId in the request body is ignored; the entry\'s own org wins',
    scoped.authorizeCookieSync({runToken: scopedToken, orgId: 'org-attacker'})
        .entry.orgId === 'org-alpha');
const legacy = createRunTokens();
const legacyToken = legacy.mint({profileId: 'p10', automations: []});
check('a token minted without an org normalizes to empty, not undefined',
    legacy.authorizeCookieSync({runToken: legacyToken}).entry.orgId === '');

// Persistence. A browser window outlives the launcher process, so quitting it
// used to invalidate every open session -- the window kept running and its next
// push got the same 403 a forged token gets.
let saved = null;
const writing = createRunTokens({save: (entries) => { saved = entries; }});
const survivor = writing.mint({profileId: 'p11', orgId: 'org-beta', automations: []});
check('minting writes the store through', Array.isArray(saved) && saved.length === 1);
const restored = createRunTokens({load: () => saved});
check('a token minted before a restart still authorizes after one',
    restored.authorizeCookieSync({runToken: survivor}).ok === true);
check('and it still knows its workspace',
    restored.authorizeCookieSync({runToken: survivor}).entry.orgId === 'org-beta');

// Restoring must not resurrect what the TTL already killed.
const stale = [['dead-token', {profileId: 'p12', orgId: '', automations: [], expiresAt: 1}]];
const pruningLoad = createRunTokens({load: () => stale});
check('an expired entry in the store is dropped on load, not restored',
    pruningLoad.size() === 0);

// A store that cannot be read must not take the API down with it.
const brokenLoad = createRunTokens({load: () => { throw new Error('unreadable'); }});
check('an unreadable store degrades to an empty one rather than throwing',
    brokenLoad.size() === 0);
const brokenSave = createRunTokens({save: () => { throw new Error('read-only disk'); }});
const stillMinted = brokenSave.mint({profileId: 'p13', automations: []});
check('a failing write still returns a usable token for this session',
    brokenSave.authorizeCookieSync({runToken: stillMinted}).ok === true);

server.close();
console.log(`\n${results.filter(Boolean).length}/${results.length} checks passed`);
process.exit(results.every(Boolean) ? 0 : 1);
