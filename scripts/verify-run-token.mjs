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
  handleOpenInLauncherFromPage, handleRunStatusFromPage, handleCancelRunFromPage,
  handleCookiePushFromPage, handleCookiePullFromPage, handleCookieListFromPage,
  handleCookieSetsFromPage, handleAutomationListFromPage, handleRunAnyFromPage,
  COOKIE_MAX_BODY_BYTES,
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
const pulled = [];
const listed = [];
const setsListed = [];
const automationsListed = [];
const anyRuns = [];
const opened = [];
const statused = [];
const cancelled = [];
const server = createServer((req, res) => {
  if (req.url === '/open') {
    handleOpenInLauncherFromPage({
      req,
      res,
      tokens,
      sendJson,
      // `automation` is null when the request named none. Recorded as null
      // rather than dereferenced, which is what the old `automation.id` did --
      // and what would crash the process on a body that omitted the field.
      open: (entry, automation) => {
        opened.push({profileId: entry.profileId, automationId: automation ? automation.id : null});
      },
    });
    return;
  }
  if (req.url === '/status') {
    handleRunStatusFromPage({
      req,
      res,
      tokens,
      sendJson,
      status: (entry) => {
        statused.push(entry.profileId);
        return {run: {runId: 'run_1', status: 'running', progress: 0.5}, last: null};
      },
    });
    return;
  }
  if (req.url === '/cancel') {
    handleCancelRunFromPage({
      req,
      res,
      tokens,
      sendJson,
      cancel: (entry) => {
        cancelled.push(entry.profileId);
        return 'run_1';
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
      pushCookies: async (entry, cookies, saveAs, saveToSetId) => {
        // `cookies` is kept, not just its length, so a chunk-boundary
        // corruption test can inspect the actual value that arrived.
        // `saveAs` and `saveToSetId` are kept too, so their type-gates below (a
        // string survives, a non-string is dropped to undefined) can be
        // asserted directly.
        pushed.push({
          profileId: entry.profileId, count: cookies.length, cookies, saveAs, saveToSetId,
        });
        return {saved: cookies.length, set: saveAs};
      },
    });
    return;
  }
  if (req.url === '/cookie-pull') {
    handleCookiePullFromPage({
      req, res, tokens, sendJson,
      pullCookies: async (entry, setId) => {
        pulled.push({profileId: entry.profileId, setId});
        return {cookies: [{name: 'sid', value: 'v', domain: entry.profileId}], setId};
      },
    });
    return;
  }
  if (req.url === '/cookie-list') {
    handleCookieListFromPage({
      req, res, tokens, sendJson,
      listCookies: async (entry, setId) => {
        listed.push({profileId: entry.profileId, setId});
        return {set: 'Work', setId: setId || null, count: 0, cookies: []};
      },
    });
    return;
  }
  if (req.url === '/cookie-sets') {
    handleCookieSetsFromPage({
      req, res, tokens, sendJson,
      listSets: async (entry) => {
        setsListed.push(entry.profileId);
        return {assignedId: 'set_1', sets: [{id: 'set_1', name: 'Work', count: 3}]};
      },
    });
    return;
  }
  if (req.url === '/automation-list') {
    handleAutomationListFromPage({
      req, res, tokens, sendJson,
      listAutomations: async (entry) => {
        automationsListed.push({profileId: entry.profileId, orgId: entry.orgId});
        return {automations: [{id: 'other_org_workflow', name: 'Teammate flow'}]};
      },
    });
    return;
  }
  if (req.url === '/run-any') {
    handleRunAnyFromPage({
      req, res, tokens, sendJson,
      startAnyRun: async (entry, automationId) => {
        anyRuns.push({profileId: entry.profileId, orgId: entry.orgId, automationId});
        return `run_any_${anyRuns.length}`;
      },
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

// Naming NO automation is allowed, and means "the Automations tab for this
// profile" -- what the side panel's empty state offers a launch that has none
// attached. Widening an authorized route to accept a missing field is exactly
// the kind of change that turns into "and null means everything", so the
// properties asserted are that it still needs a real token and still cannot name
// a profile.
const openNoId = await postOpen({runToken: openToken});
check('naming no automation raises the launcher on the Automations tab',
    openNoId.status === 200 && opened.length === 2, openNoId.text);
check('an open with no automation still takes its profile off the token',
    opened[1]?.profileId === 'p-open' && opened[1]?.automationId === null,
    JSON.stringify(opened[1]));

const openNoIdNoToken = await postOpen({});
check('naming no automation does not also excuse the token',
    openNoIdNoToken.status === 403 && opened.length === 2, openNoIdNoToken.text);

// An empty string is not a name, and must take the no-id path rather than being
// looked up and refused -- otherwise the panel's empty state breaks the first
// time something passes '' instead of omitting the field.
const openEmptyId = await postOpen({runToken: openToken, automationId: ''});
check('an empty automation id reads as naming none, not as a foreign id',
    openEmptyId.status === 200 && opened.length === 3, openEmptyId.text);

// ── The status and cancel routes ─────────────────────────────────────────────
// What the side panel polls, and the Stop button beside it. Neither names a run:
// the runner is asked for whatever is in flight against the profile ON THE
// TOKEN, so a leaked token cannot read or stop a run belonging to another
// profile even by guessing its id.
//
// Status has its own rate bucket (STATUS_RATE) because it arrives on a timer;
// the property that matters is that spending it cannot starve the run button,
// which is what the separate buckets are for.
const panelToken = tokens.mint({
  profileId: 'p-panel',
  profileName: 'Panel',
  cdpPort: null,
  automations: [],
});
const postStatus = (body, headers) =>
  post(body, headers || {'Content-Type': 'application/json'}, '/status');
const postCancel = (body, headers) =>
  post(body, headers || {'Content-Type': 'application/json'}, '/cancel');

const statusOk = await postStatus({runToken: panelToken});
check('a valid token reads its own run status',
    statusOk.status === 200 && statused.length === 1, statusOk.text);
check('the status profile comes off the token, not the request',
    statused[0] === 'p-panel',
    'the body carries nothing but the token, so there is no id to aim');

const statusUnknown = await postStatus({runToken: 'f'.repeat(64)});
check('an unknown token cannot read a run status',
    statusUnknown.status === 403 && statused.length === 1);
check('and it refuses byte-identically to every other refusal (not an oracle)',
    statusUnknown.text === unknown.text, statusUnknown.text);

const statusForm = await postStatus({runToken: panelToken},
    {'Content-Type': 'application/x-www-form-urlencoded'});
check('non-JSON content type refused on the status route too',
    statusForm.status === 403 && statused.length === 1);

// A token naming no automations can still watch and stop -- the run it is
// watching may have been started from the launcher's own window or by a
// schedule, which is the whole reason status is scoped by profile rather than by
// the token's automations list. This is the shape every ordinary launch carries.
const bareToken = tokens.mint({
  profileId: 'p-bare',
  profileName: 'Bare',
  cdpPort: null,
  automations: [],
});
const statusNoAutomations = await postStatus({runToken: bareToken});
check('a token with no automations can still watch its profile',
    statusNoAutomations.status === 200 && statused[1] === 'p-bare',
    statusNoAutomations.text);

const cancelOk = await postCancel({runToken: panelToken});
check('a valid token stops the run on its own profile',
    cancelOk.status === 200 && cancelled.length === 1, cancelOk.text);
check('the cancel profile comes off the token, not the request',
    cancelled[0] === 'p-panel',
    'nothing in the body names a run, so a leaked token cannot stop someone else\'s');

// A body that tries to aim it is not an error, it is ignored: the fields are
// simply never read. Asserted, because "ignored" and "honoured" look identical
// from the outside unless something checks.
const cancelAimed = await postCancel(
    {runToken: panelToken, profileId: 'p-open', runId: 'run_99'});
check('a cancel body cannot aim at another profile or run',
    cancelAimed.status === 200 && cancelled[1] === 'p-panel',
    JSON.stringify(cancelled));

const cancelUnknown = await postCancel({runToken: 'f'.repeat(64)});
check('an unknown token cannot stop a run',
    cancelUnknown.status === 403 && cancelled.length === 2);

// The reason status gets its own bucket at all. Sixty polls is a minute of the
// panel's cadence and would be six times RATE's per-token allowance; the run
// route has to still work afterwards.
for (let i = 0; i < 60; i++) {
  await postStatus({runToken: panelToken});
}
const statusAfterBurst = await postStatus({runToken: panelToken});
check('a minute of polling does not exhaust the status bucket',
    statusAfterBurst.status === 200, statusAfterBurst.text);
const cancelAfterBurst = await postCancel({runToken: panelToken});
check('and it does not starve the routes on the ordinary bucket',
    cancelAfterBurst.status === 200, cancelAfterBurst.text);

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

// ── The team-reach routes ────────────────────────────────────────────────────
// The side panel lists, and can run, every automation in the launch's
// WORKSPACE -- not just the ones the launch was handed. That is a deliberate
// widening of what a run token authorizes, and these checks pin down which
// properties survived it.
//
// What did NOT change, and is what the checks below are for: the profile and
// the org still come off the entry, so a body cannot aim any of this at another
// window or another workspace; and every refusal is still the same 403 with the
// same body.
const teamToken = tokens.mint({
  profileId: 'p-team',
  profileName: 'Team',
  orgId: 'org-team',
  cdpPort: 4321,
  // Empty on purpose: this launch was handed nothing, which is exactly the case
  // the old routes refused outright and these are built to serve.
  automations: [],
});
const postAt = (path) => (body, headers) =>
  post(body, headers || {'Content-Type': 'application/json'}, path);
const postList = postAt('/automation-list');
const postRunAny = postAt('/run-any');
const postSets = postAt('/cookie-sets');
const postList2 = postAt('/cookie-list');
const postPull = postAt('/cookie-pull');

const listOk = await postList({runToken: teamToken});
check('a launch handed no automations can still list its workspace',
    listOk.status === 200 && automationsListed.length === 1, listOk.text);
check('the listed workspace comes off the entry, not the request',
    automationsListed[0].orgId === 'org-team' && automationsListed[0].profileId === 'p-team');
const listDecoy = await postList({runToken: teamToken, orgId: 'org-attacker', profileId: 'p-other'});
check('a decoy org/profile in a list body is ignored',
    listDecoy.status === 200 &&
      automationsListed[1].orgId === 'org-team' && automationsListed[1].profileId === 'p-team');
const listUnknown = await postList({runToken: 'f'.repeat(64)});
check('listing with an unknown token is refused', listUnknown.status === 403);

// The widening itself: an id this launch was never handed now runs. The narrow
// route refuses the same id in the same breath, which is the pair worth seeing
// together -- run-from-page did not get looser, a second route got added.
const anyOk = await postRunAny({runToken: teamToken, automationId: 'not-in-this-launch'});
check('a workflow this launch was not handed runs through run-any',
    anyOk.status === 200 && anyRuns.length === 1, anyOk.text);
check('and the id it was given is passed through verbatim',
    anyRuns[0].automationId === 'not-in-this-launch');
check('while the narrow run route still refuses that same id',
    (await post({runToken: teamToken, automationId: 'not-in-this-launch'})).status === 403);
check('the profile and org still come off the entry, not the body',
    anyRuns[0].profileId === 'p-team' && anyRuns[0].orgId === 'org-team');
const anyDecoy = await postRunAny({
  runToken: teamToken, automationId: 'x', profileId: 'p1', orgId: 'org-attacker',
});
check('a decoy profile/org on a run-any body is ignored',
    anyDecoy.status === 200 &&
      anyRuns[1].profileId === 'p-team' && anyRuns[1].orgId === 'org-team');
const anyNamed = await postRunAny({runToken: teamToken});
check('run-any naming no automation is a 400, not a run',
    anyNamed.status === 400 && anyRuns.length === 2, anyNamed.text);
const anyNonString = await postRunAny({runToken: teamToken, automationId: {id: 'x'}});
check('a non-string automationId is dropped rather than forwarded',
    anyNonString.status === 400 && anyRuns.length === 2, anyNonString.text);
const anyUnknown = await postRunAny({runToken: 'f'.repeat(64), automationId: 'x'});
check('run-any with an unknown token is refused', anyUnknown.status === 403);
check('and that refusal is byte-identical to the narrow route\'s',
    anyUnknown.status === unknown.status && anyUnknown.text === unknown.text, anyUnknown.text);
check('non-JSON content type refused on run-any too',
    (await postRunAny({runToken: teamToken, automationId: 'x'},
        {'Content-Type': 'application/x-www-form-urlencoded'})).status === 403);

// The cookie half. `setId` is the first field on these routes that chooses WHAT
// to read, so the type gate is the thing to pin: a string reaches the handler,
// anything else becomes undefined and the handler falls back to the assigned
// set. The id is not validated here on purpose -- that happens in the renderer,
// against the entry's own workspace.
const setsOk = await postSets({runToken: teamToken});
check('the workspace cookie-set list answers for a valid token',
    setsOk.status === 200 && setsListed.length === 1, setsOk.text);
check('its profile comes off the entry', setsListed[0] === 'p-team');
check('listing sets with an unknown token is refused',
    (await postSets({runToken: 'f'.repeat(64)})).status === 403);

// Counted from here, not from zero: the cookie-route checks earlier in this
// file drive the same handler and have already recorded pulls of their own.
const pullBase = pulled.length;
await postPull({runToken: teamToken});
check('a pull with no setId asks for the assigned set',
    pulled.length === pullBase + 1 && pulled[pullBase].setId === undefined);
await postPull({runToken: teamToken, setId: 'set_other'});
check('a string setId reaches the handler unchanged',
    pulled.length === pullBase + 2 && pulled[pullBase + 1].setId === 'set_other');
await postPull({runToken: teamToken, setId: {id: 'set_other'}});
check('a non-string setId is dropped, not forwarded',
    pulled.length === pullBase + 3 && pulled[pullBase + 2].setId === undefined);
await postList2({runToken: teamToken, setId: 'set_other'});
check('the read-only cookie list takes the same setId',
    listed.length === 1 && listed[0].setId === 'set_other');
await postList2({runToken: teamToken, setId: 7});
check('and drops a non-string one the same way',
    listed.length === 2 && listed[1].setId === undefined);

// saveToSetId, the overwrite field, gated exactly like saveAs beside it.
const pushToken = tokens.mint({profileId: 'p-push', orgId: 'org-team', automations: []});
const postPush = postAt('/cookie-push');
await postPush({runToken: pushToken, cookies: [{name: 'a'}], saveToSetId: 'set_1'});
const lastPush = () => pushed[pushed.length - 1];
check('a string saveToSetId reaches the handler', lastPush().saveToSetId === 'set_1');
await postPush({runToken: pushToken, cookies: [{name: 'a'}], saveToSetId: ['set_1']});
check('a non-string saveToSetId is dropped rather than forwarded',
    lastPush().saveToSetId === undefined);
await postPush({runToken: pushToken, cookies: [{name: 'a'}]});
check('an absent saveToSetId stays undefined (an ordinary live sync)',
    lastPush().saveToSetId === undefined && lastPush().saveAs === undefined);

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
