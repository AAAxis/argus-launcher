// Per-launch credentials for the generated start page, and the two endpoints
// they open.
//
// The start page (ArgysHome/home.html) is a file:// document with no key and no
// way to be given one, but it offers a launch's automations as tiles and shows
// whether the profile's proxy is working. This is how it asks for one of those
// automations to be run, and for that proxy to be re-checked.
//
// The token's safety comes from being NARROW, not from being secret. It
// authorizes exactly two things:
//
//   1. run one of THIS launch's listed automations, against THIS profile, on
//      THIS port;
//   2. re-check THIS profile's assigned proxy.
//
// It cannot create, edit or delete anything, cannot read another run, cannot
// mint keys, cannot supply its own steps -- the run request carries an id and
// the workflow is looked up here -- and cannot supply its own proxy: the
// re-check request carries nothing at all, and the proxy is resolved from the
// profile on the entry. Worst case for a leaked token is someone re-running a
// workflow the user pinned, or re-testing one proxy, in a window the user
// already has open.
//
// A token is minted on EVERY launch, including one with nothing pinned and
// nothing attached -- the proxy panel needs it. Those launches have no
// debugging port, so cdpPort is null and `automations` is empty, and an empty
// list matches no id: such a token can only re-check.
//
// It lives in its own file rather than in main.cjs so its refusal paths can be
// tested against the real code. scripts/verify-run-token.mjs drives exactly the
// handlers below; a copy of this logic living in a test would be free to drift
// from what actually ships, which for an auth path is the whole ballgame.

const crypto = require('node:crypto');
const {StringDecoder} = require('node:string_decoder');

const TTL_MS = 12 * 60 * 60 * 1000;
// 32 random bytes makes guessing a non-issue. These limits exist so the
// endpoint cannot be used to hammer the runner, and so a wrong guess costs the
// same as a right one.
const RATE = {perTokenPerMin: 10, globalPerMin: 60};
const MAX_BODY_BYTES = 4096;
// The cookie-sync routes carry whole cookie jars, not 200-byte run requests:
// their own body cap, and their own rate bucket so a busy sync can never
// starve the start page's shared limiter (or be starved by it).
const COOKIE_RATE = {perTokenPerMin: 12, globalPerMin: 120};
const COOKIE_MAX_BODY_BYTES = 10 * 1024 * 1024;

function createRunTokens({now = () => Date.now()} = {}) {
  const tokens = new Map();
  const hits = [];
  const cookieHits = [];

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
      // Null on a launch with nothing to run. Normalized here so every entry
      // holds the same shape and the run path has one thing to test.
      cdpPort: typeof cdpPort === 'number' ? cdpPort : null,
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

  // Resolves a request to its entry, or to a refusal.
  //
  // EVERY refusal returns the same 403 and the same body, so neither endpoint
  // is an oracle: an unknown token, an expired one, and a valid one naming an
  // automation it does not own are indistinguishable from outside. Only success
  // and rate-limiting are separable.
  //
  // The rate limiter is shared across both routes on purpose. It is there to
  // stop the token being used to hammer this process, and which of the two
  // things it is hammering with does not change that.
  function resolve(payload) {
    const token = typeof payload.runToken === 'string' ? payload.runToken : '';
    if (!rateLimit(token)) {
      return {ok: false, status: 429, body: {status: false, msg: 'Too many requests'}};
    }
    prune();
    const entry = tokens.get(token);
    if (!entry) {
      return {ok: false, status: 403, body: {status: false, msg: 'Not allowed'}};
    }
    return {ok: true, entry};
  }

  function authorize(payload) {
    const verdict = resolve(payload);
    if (!verdict.ok) {
      return verdict;
    }
    const automation = verdict.entry.automations.find((item) => item.id === payload.automationId);
    // Same refusal as an unknown token, deliberately: naming an automation this
    // launch does not offer must not be distinguishable from holding a token
    // that was never valid.
    if (!automation) {
      return {ok: false, status: 403, body: {status: false, msg: 'Not allowed'}};
    }
    return {ok: true, entry: verdict.entry, automation};
  }

  // Re-checking needs no id: the proxy is the one assigned to the profile on
  // the entry, so there is nothing in the request for a caller to choose. That
  // is what makes this safe to open to a document with no key -- it is not a
  // proxy-testing endpoint, it is "re-check the thing this page is showing".
  function authorizeRecheck(payload) {
    return resolve(payload);
  }

  function rateLimitCookie(token) {
    const at = now();
    while (cookieHits.length > 0 && at - cookieHits[0].at > 60000) {
      cookieHits.shift();
    }
    if (cookieHits.length >= COOKIE_RATE.globalPerMin) {
      return false;
    }
    if (cookieHits.filter((hit) => hit.token === token).length >= COOKIE_RATE.perTokenPerMin) {
      return false;
    }
    cookieHits.push({token, at});
    return true;
  }

  // The cookie-sync twin of resolve(): same refusal semantics, its own bucket.
  function authorizeCookieSync(payload) {
    const token = typeof payload.runToken === 'string' ? payload.runToken : '';
    if (!rateLimitCookie(token)) {
      return {ok: false, status: 429, body: {status: false, msg: 'Too many requests'}};
    }
    prune();
    const entry = tokens.get(token);
    if (!entry) {
      return {ok: false, status: 403, body: {status: false, msg: 'Not allowed'}};
    }
    return {ok: true, entry};
  }

  return {
    authorize,
    authorizeCookieSync,
    authorizeRecheck,
    clear: () => tokens.clear(),
    dropForProfile,
    mint,
    prune,
    size: () => tokens.size,
  };
}

// The shared half of both page routes: reject anything that is not a JSON POST
// from the page, read a bounded body, authorize it, and hand the entry to the
// work. `authorizeWith` names which of the two token checks applies and `work`
// does the rest; both are injected so this file needs neither the runner, nor
// the proxy checker, nor Electron.
function handlePageRequest({req, res, tokens, sendJson, authorizeWith, work, maxBodyBytes = MAX_BODY_BYTES}) {
  // A cross-origin <form> POST cannot set this, so requiring it means a hostile
  // page has to send a preflight -- which this server does not answer for these
  // routes. The loopback API sets Access-Control-Allow-Origin: * on its keyed
  // routes, so without this the wildcard would effectively reach here too.
  const contentType = String(req.headers['content-type'] || '');
  if (!contentType.includes('application/json')) {
    sendJson(res, 403, {status: false, msg: 'Not allowed'});
    return;
  }
  let body = '';
  let bytes = 0;
  // `body.length` after `body += chunk` counts UTF-16 code units, not wire
  // bytes -- multi-byte characters would let the cap admit up to ~3x its
  // stated size, and coercing each Buffer to a string independently can split
  // a multi-byte character across a socket-read boundary, corrupting it to
  // U+FFFD without JSON.parse ever noticing. `bytes` is measured off the raw
  // chunks, and StringDecoder holds back any trailing partial character until
  // the bytes that complete it arrive.
  const decoder = new StringDecoder('utf8');
  req.on('data', (chunk) => {
    bytes += chunk.length;
    if (bytes > maxBodyBytes) {
      req.destroy();
      return;
    }
    body += decoder.write(chunk);
  });
  req.on('end', async () => {
    body += decoder.end();
    let payload;
    try {
      payload = JSON.parse(body || '{}');
    } catch {
      sendJson(res, 403, {status: false, msg: 'Not allowed'});
      return;
    }
    // JSON.parse accepts any JSON value, not just objects -- a body of `null`
    // parses cleanly and would otherwise be dereferenced below with nothing to
    // catch the crash, killing the process rather than answering the request.
    // Same refusal as every other auth failure: this must not be an oracle
    // either.
    if (!payload || typeof payload !== 'object') {
      sendJson(res, 403, {status: false, msg: 'Not allowed'});
      return;
    }
    const verdict = tokens[authorizeWith](payload);
    if (!verdict.ok) {
      sendJson(res, verdict.status, verdict.body);
      return;
    }
    try {
      sendJson(res, 200, {status: true, ...await work(verdict, payload)});
    } catch (error) {
      // A failure from the work itself is an answer the page can show, unlike
      // the refusals above: the caller already proved it holds a valid token,
      // so there is nothing left to leak. (409 and 429 from the runner, a dead
      // proxy from the checker.)
      sendJson(res, error?.status || 500,
          {status: false, msg: error?.message || 'The request did not complete'});
    }
  });
}

// Runs one of this launch's automations. `startRun` returns the run id.
function handleRunFromPage({req, res, tokens, sendJson, startRun}) {
  handlePageRequest({
    req,
    res,
    tokens,
    sendJson,
    authorizeWith: 'authorize',
    work: async ({entry, automation}) => ({runId: await startRun(entry, automation)}),
  });
}

// Re-checks this launch's assigned proxy. `recheck` returns the panel's next
// {proxyOk, title, detail} -- composed by homeProxyStatus in the renderer, the
// same function that wrote the wording the page launched with.
function handleRecheckFromPage({req, res, tokens, sendJson, recheck}) {
  handlePageRequest({
    req,
    res,
    tokens,
    sendJson,
    authorizeWith: 'authorizeRecheck',
    work: ({entry}) => recheck(entry),
  });
}

// Saves a running profile's live cookie jar into the launcher. The profile is
// the token entry's own -- the payload names no profile, so a leaked token can
// only ever write to the launch it was minted for.
function handleCookiePushFromPage({req, res, tokens, sendJson, pushCookies}) {
  handlePageRequest({
    req, res, tokens, sendJson,
    authorizeWith: 'authorizeCookieSync',
    maxBodyBytes: COOKIE_MAX_BODY_BYTES,
    work: async ({entry}, payload) => {
      const cookies = Array.isArray(payload.cookies) ? payload.cookies : [];
      return await pushCookies(entry, cookies);
    },
  });
}

// Hands the profile's assigned cookie set back to its running browser, for
// "Load from Launcher" without a relaunch. Read-only; carries nothing but the
// token, so there is nothing in the request for a caller to choose.
function handleCookiePullFromPage({req, res, tokens, sendJson, pullCookies}) {
  handlePageRequest({
    req, res, tokens, sendJson,
    authorizeWith: 'authorizeCookieSync',
    work: async ({entry}) => await pullCookies(entry),
  });
}

module.exports = {
  COOKIE_MAX_BODY_BYTES,
  COOKIE_RATE,
  MAX_BODY_BYTES,
  RATE,
  TTL_MS,
  createRunTokens,
  handleCookiePullFromPage,
  handleCookiePushFromPage,
  handleRecheckFromPage,
  handleRunFromPage,
};
