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
import {createRequire} from 'node:module';

const require = createRequire(import.meta.url);
const {createRunTokens, handleRunFromPage} = require('../electron/automation/run-token.cjs');

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
const server = createServer((req, res) => handleRunFromPage({
  req,
  res,
  tokens,
  sendJson,
  startRun: async () => {
    started += 1;
    return `run_${started}`;
  },
}));

async function post(body, headers = {'Content-Type': 'application/json'}) {
  const response = await fetch(`http://127.0.0.1:${PORT}/`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  return {status: response.status, text: await response.text()};
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

// Expiry, via the injected clock rather than a 12-hour wait.
clockOffset = 13 * 60 * 60 * 1000;
const expired = await post({runToken: token, automationId: 'a1'});
check('expired token refused', expired.status === 403);
check('expired and unknown are byte-identical (not an oracle)',
    expired.status === unknown.status && expired.text === unknown.text);

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

server.close();
console.log(`\n${results.filter(Boolean).length}/${results.length} checks passed`);
process.exit(results.every(Boolean) ? 0 : 1);
