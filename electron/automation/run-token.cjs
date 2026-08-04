// Per-launch credentials for the generated start page, and the one endpoint
// they open.
//
// The start page (ArgysHome/home.html) is a file:// document with no key and no
// way to be given one, but it can offer a launch's automations as tiles. This
// is how it asks for one to be run.
//
// The token's safety comes from being NARROW, not from being secret. It
// authorizes exactly: run one of THIS launch's listed automations, against THIS
// profile, on THIS port. It cannot create, edit or delete anything, cannot read
// another run, cannot mint keys, and cannot supply its own steps -- the request
// carries an id and the workflow is looked up here. Worst case for a leaked
// token is someone re-running a workflow the user pinned, in a window the user
// already has open.
//
// It lives in its own file rather than in main.cjs so its refusal paths can be
// tested against the real code. scripts/verify-run-token.mjs drives exactly the
// handler below; a copy of this logic living in a test would be free to drift
// from what actually ships, which for an auth path is the whole ballgame.

const crypto = require('node:crypto');

const TTL_MS = 12 * 60 * 60 * 1000;
// 32 random bytes makes guessing a non-issue. These limits exist so the
// endpoint cannot be used to hammer the runner, and so a wrong guess costs the
// same as a right one.
const RATE = {perTokenPerMin: 10, globalPerMin: 60};
const MAX_BODY_BYTES = 4096;

function createRunTokens({now = () => Date.now()} = {}) {
  const tokens = new Map();
  const hits = [];

  function prune() {
    const at = now();
    for (const [token, entry] of tokens) {
      if (entry.expiresAt <= at) {
        tokens.delete(token);
      }
    }
  }

  function dropForProfile(profileId) {
    for (const [token, entry] of tokens) {
      if (entry.profileId === profileId) {
        tokens.delete(token);
      }
    }
  }

  function mint({profileId, profileName, cdpPort, automations}) {
    prune();
    // One live token per profile: relaunching must not leave the previous
    // launch's token working against a window that is gone.
    dropForProfile(profileId);
    const token = crypto.randomBytes(32).toString('hex');
    tokens.set(token, {
      profileId,
      profileName: profileName || '',
      cdpPort,
      automations: Array.isArray(automations) ? automations : [],
      expiresAt: now() + TTL_MS,
    });
    return token;
  }

  function rateLimit(token) {
    const at = now();
    while (hits.length > 0 && at - hits[0].at > 60000) {
      hits.shift();
    }
    if (hits.length >= RATE.globalPerMin) {
      return false;
    }
    if (hits.filter((hit) => hit.token === token).length >= RATE.perTokenPerMin) {
      return false;
    }
    hits.push({token, at});
    return true;
  }

  // Resolves a request to {entry, automation}, or to a refusal.
  //
  // EVERY refusal returns the same 403 and the same body, so the endpoint is
  // not an oracle: an unknown token, an expired one, and a valid one naming an
  // automation it does not own are indistinguishable from outside. Only success
  // and rate-limiting are separable.
  function authorize(payload) {
    const token = typeof payload.runToken === 'string' ? payload.runToken : '';
    if (!rateLimit(token)) {
      return {ok: false, status: 429, body: {status: false, msg: 'Too many requests'}};
    }
    prune();
    const entry = tokens.get(token);
    const automation = entry ?
      entry.automations.find((item) => item.id === payload.automationId) :
      null;
    if (!entry || !automation) {
      return {ok: false, status: 403, body: {status: false, msg: 'Not allowed'}};
    }
    return {ok: true, entry, automation};
  }

  return {authorize, clear: () => tokens.clear(), dropForProfile, mint, prune, size: () => tokens.size};
}

// Wires authorize() to an http request. `startRun` does the actual work and is
// injected so this file needs neither the runner nor Electron.
function handleRunFromPage({req, res, tokens, sendJson, startRun}) {
  // A cross-origin <form> POST cannot set this, so requiring it means a hostile
  // page has to send a preflight -- which this server does not answer for this
  // route. The loopback API sets Access-Control-Allow-Origin: * on its keyed
  // routes, so without this the wildcard would effectively reach here too.
  const contentType = String(req.headers['content-type'] || '');
  if (!contentType.includes('application/json')) {
    sendJson(res, 403, {status: false, msg: 'Not allowed'});
    return;
  }
  let body = '';
  req.on('data', (chunk) => {
    body += chunk;
    if (body.length > MAX_BODY_BYTES) {
      req.destroy();
    }
  });
  req.on('end', async () => {
    let payload;
    try {
      payload = JSON.parse(body || '{}');
    } catch {
      sendJson(res, 403, {status: false, msg: 'Not allowed'});
      return;
    }
    const verdict = tokens.authorize(payload);
    if (!verdict.ok) {
      sendJson(res, verdict.status, verdict.body);
      return;
    }
    try {
      const runId = await startRun(verdict.entry, verdict.automation);
      sendJson(res, 200, {status: true, runId});
    } catch (error) {
      // 409 and 429 from the runner are answers the tile can show, unlike the
      // refusals above: the caller already proved it holds a valid token, so
      // there is nothing left to leak.
      sendJson(res, error?.status || 500,
          {status: false, msg: error?.message || 'The run did not start'});
    }
  });
}

module.exports = {MAX_BODY_BYTES, RATE, TTL_MS, createRunTokens, handleRunFromPage};
