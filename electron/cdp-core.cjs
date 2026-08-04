// Chrome DevTools Protocol transport, shared by the two things that speak it.
//
// Both callers drive a profile the launcher started with
// --remote-debugging-port, but they want opposite connection lifetimes:
//
//   electron/mcp/cdp.cjs      one socket per tool call, closed in a finally.
//                             A pooled socket would save a few milliseconds on
//                             loopback and buy a class of stale-handle bugs
//                             when the window is closed between two calls.
//   electron/automation/      one socket for a whole run. A workflow's steps
//                             share a page, and `waitFor` subscribes to events
//                             that must stay live across step boundaries --
//                             reconnecting per step cannot express that.
//
// So the transport lives here and the lifetime is the caller's business. This
// file is the only place that knows the wire format; adding a second copy is
// the drift hazard AGENTS.md warns about for src/lib/cookieFile.ts.
//
// `ws` is the launcher's own dependency and resolves from *inside* app.asar. It
// must NOT be added to asarUnpack: a script at app.asar.unpacked/... cannot see
// app.asar/node_modules, because module resolution walks up the literal path.
// Verified both ways -- the unpacked form fails with "Cannot find module 'ws'".

const http = require('node:http');
const WebSocket = require('ws');

const CONNECT_TIMEOUT_MS = 10000;
const COMMAND_TIMEOUT_MS = 30000;
// Long enough for a slow page behind a residential proxy, short enough that a
// navigation to somewhere that never settles still returns.
const LOAD_TIMEOUT_MS = 30000;

function httpJson(url) {
  return new Promise((resolve, reject) => {
    const request = http.get(url, {timeout: CONNECT_TIMEOUT_MS}, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        body += chunk;
      });
      response.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch (error) {
          reject(new Error(`${url} did not return JSON: ${error.message}`));
        }
      });
    });
    request.on('timeout', () => request.destroy(new Error(`Timed out reading ${url}`)));
    request.on('error', reject);
  });
}

// Chromium's DevToolsHttpHandler validates the Host header, and `ws` derives it
// from the URL -- so a target advertised on `localhost` must be dialled on
// 127.0.0.1 or the upgrade is refused.
function loopback(url) {
  return url.replace('localhost', '127.0.0.1');
}

async function listTargets(cdpUrl) {
  const targets = await httpJson(`${loopback(cdpUrl).replace(/\/$/, '')}/json/list`);
  return Array.isArray(targets) ? targets : [];
}

// The page target, not the browser target: Page.* and Runtime.* only exist on a
// page. Attaching to the page endpoint directly also avoids every bit of
// Target.attachToTarget / sessionId plumbing.
//
// Prefers a real http(s) page over devtools:// and chrome:// so a profile
// sitting on its start page with an inspector open still resolves sensibly.
async function pageTarget(cdpUrl) {
  const pages = (await listTargets(cdpUrl))
      .filter((target) => target.type === 'page' && target.webSocketDebuggerUrl);
  const real = pages.find((target) => /^https?:/i.test(target.url || ''));
  const chosen = real || pages[0];
  if (!chosen) {
    throw new Error('That profile has no open page to drive');
  }
  return chosen;
}

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    // No Origin header: Chromium accepts a browserless client without one, and
    // the browser is launched with --remote-allow-origins=* anyway.
    const socket = new WebSocket(loopback(wsUrl), {
      perMessageDeflate: false,
      maxPayload: 256 * 1024 * 1024,
      handshakeTimeout: CONNECT_TIMEOUT_MS,
    });
    const timer = setTimeout(() => {
      socket.terminate();
      reject(new Error('Timed out opening the debugging connection'));
    }, CONNECT_TIMEOUT_MS);
    socket.once('open', () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

// One socket, for as long as the caller holds it.
class Session {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    this.waiters = [];
    // Long-lived subscribers, unlike `waiters` which are one-shot. A run needs
    // these to notice a navigation that happens between two steps.
    this.listeners = new Map();
    this.closed = false;
    socket.on('message', (raw) => this.receive(raw));
    socket.on('close', () => {
      this.closed = true;
      this.fail(new Error('The browser closed the debugging connection'));
    });
    socket.on('error', (error) => this.fail(error));
  }

  receive(raw) {
    let message;
    try {
      message = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (message.id !== undefined) {
      const waiting = this.pending.get(message.id);
      if (!waiting) {
        return;
      }
      this.pending.delete(message.id);
      clearTimeout(waiting.timer);
      if (message.error) {
        waiting.reject(new Error(message.error.message || 'CDP command failed'));
        return;
      }
      waiting.resolve(message.result || {});
      return;
    }
    this.waiters = this.waiters.filter((waiter) => {
      if (waiter.method !== message.method) {
        return true;
      }
      clearTimeout(waiter.timer);
      waiter.resolve(message.params || {});
      return false;
    });
    const subscribers = this.listeners.get(message.method);
    if (subscribers) {
      for (const subscriber of subscribers) {
        try {
          subscriber(message.params || {});
        } catch {
          // A listener that throws must not take down the socket pump.
        }
      }
    }
  }

  // A dead socket must reject everything outstanding, or a caller hangs to its
  // own timeout with no explanation of what actually happened.
  fail(error) {
    for (const waiting of this.pending.values()) {
      clearTimeout(waiting.timer);
      waiting.reject(error);
    }
    this.pending.clear();
    for (const waiter of this.waiters) {
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
    this.waiters = [];
  }

  send(method, params = {}, timeoutMs = COMMAND_TIMEOUT_MS) {
    return new Promise((resolve, reject) => {
      if (this.closed) {
        reject(new Error('The debugging connection is closed'));
        return;
      }
      const id = this.nextId++;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      this.pending.set(id, {resolve, reject, timer});
      try {
        this.socket.send(JSON.stringify({id, method, params}));
      } catch (error) {
        this.pending.delete(id);
        clearTimeout(timer);
        reject(error);
      }
    });
  }

  // Resolves on the next occurrence of `method`. One-shot.
  once(method, timeoutMs) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter((waiter) => waiter.timer !== timer);
        reject(new Error(`Timed out waiting for ${method}`));
      }, timeoutMs);
      this.waiters.push({method, resolve, reject, timer});
    });
  }

  // Standing subscription, for events a run cares about between steps. Returns
  // an unsubscribe.
  on(method, callback) {
    const subscribers = this.listeners.get(method) || new Set();
    subscribers.add(callback);
    this.listeners.set(method, subscribers);
    return () => {
      subscribers.delete(callback);
    };
  }

  close() {
    this.closed = true;
    this.listeners.clear();
    try {
      this.socket.close();
    } catch {
      // Already gone.
    }
  }
}

// Opens a session on the profile's active page, runs `body`, and always closes.
async function withPage(cdpUrl, body) {
  const target = await pageTarget(cdpUrl);
  const session = new Session(await connect(target.webSocketDebuggerUrl));
  try {
    return await body(session, target);
  } finally {
    session.close();
  }
}

// Opens a session the caller owns and must close. This is the run path.
async function openPageSession(cdpUrl) {
  const target = await pageTarget(cdpUrl);
  const session = new Session(await connect(target.webSocketDebuggerUrl));
  return {session, target};
}

module.exports = {
  COMMAND_TIMEOUT_MS,
  CONNECT_TIMEOUT_MS,
  LOAD_TIMEOUT_MS,
  Session,
  connect,
  httpJson,
  listTargets,
  loopback,
  openPageSession,
  pageTarget,
  withPage,
};
