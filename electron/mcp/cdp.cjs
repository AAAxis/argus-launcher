// A minimal Chrome DevTools Protocol client, for driving a profile the
// launcher has already started.
//
// `POST /v1/profiles/launch-automation` spawns the browser with
// --remote-debugging-port and hands back http://127.0.0.1:<port>. Everything a
// coding agent actually wants to do with a profile once it is open -- navigate,
// read the page, take a screenshot -- is CDP on top of that.
//
// `ws` is the launcher's own dependency and resolves from inside app.asar.
// It must not be unpacked: a script at app.asar.unpacked/... cannot see
// app.asar/node_modules, because module resolution walks up the literal path.
// (Verified both ways; the unpacked form fails with "Cannot find module 'ws'".)

const WebSocket = require('ws');

const CONNECT_TIMEOUT_MS = 10000;
const COMMAND_TIMEOUT_MS = 30000;
// Long enough for a slow page behind a residential proxy, short enough that a
// navigation to somewhere that never finishes loading still returns.
const LOAD_TIMEOUT_MS = 45000;

function httpJson(url) {
  return new Promise((resolve, reject) => {
    const request = require('node:http').get(url, {timeout: CONNECT_TIMEOUT_MS}, (response) => {
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
    request.on('timeout', () => {
      request.destroy(new Error(`Timed out reading ${url}`));
    });
    request.on('error', reject);
  });
}

// One live connection per profile. Held open across tool calls so a sequence
// like launch → navigate → read does not pay a fresh WebSocket handshake each
// time, and dropped on close so a stale socket can never outlive its browser.
const connections = new Map();

class CdpSession {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    // Listeners waiting on a specific event, e.g. Page.loadEventFired.
    this.waiters = [];
    socket.on('message', (raw) => this.receive(raw));
    socket.on('close', () => this.fail(new Error('The browser closed the debugging connection')));
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
    // An event. Resolve anyone waiting for this exact method.
    this.waiters = this.waiters.filter((waiter) => {
      if (waiter.method !== message.method) {
        return true;
      }
      clearTimeout(waiter.timer);
      waiter.resolve(message.params || {});
      return false;
    });
  }

  // A dead socket has to reject everything outstanding, or a tool call hangs
  // until its own timeout with no explanation of what actually happened.
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

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out after ${COMMAND_TIMEOUT_MS}ms`));
      }, COMMAND_TIMEOUT_MS);
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

  once(method, timeoutMs) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter((waiter) => waiter.timer !== timer);
        reject(new Error(`Timed out waiting for ${method}`));
      }, timeoutMs);
      this.waiters.push({method, resolve, reject, timer});
    });
  }

  close() {
    try {
      this.socket.close();
    } catch {
      // Already gone -- nothing to do.
    }
  }
}

// The page target, not the browser target: commands like Page.navigate and
// Runtime.evaluate only exist on a page.
async function pageWebSocketUrl(cdpUrl) {
  const targets = await httpJson(`${cdpUrl.replace(/\/$/, '')}/json/list`);
  const page = (Array.isArray(targets) ? targets : [])
      .find((target) => target.type === 'page' && target.webSocketDebuggerUrl);
  if (!page) {
    throw new Error('That profile has no open page to drive');
  }
  return page.webSocketDebuggerUrl;
}

function connectSocket(wsUrl) {
  return new Promise((resolve, reject) => {
    // The browser is launched with --remote-allow-origins=*, but the header
    // still has to be present for Chromium to accept a non-browser client.
    const socket = new WebSocket(wsUrl, {
      origin: 'http://127.0.0.1',
      maxPayload: 64 * 1024 * 1024,
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

// Reconnects rather than caching forever: the window may have been closed and
// reopened between two tool calls, and a socket that looks open but points at a
// dead target fails in a much more confusing way than a fresh connect.
async function session(profileId, cdpUrl) {
  const existing = connections.get(profileId);
  if (existing && existing.socket.readyState === WebSocket.OPEN) {
    return existing;
  }
  if (existing) {
    existing.close();
    connections.delete(profileId);
  }
  const socket = await connectSocket(await pageWebSocketUrl(cdpUrl));
  const created = new CdpSession(socket);
  connections.set(profileId, created);
  return created;
}

function release(profileId) {
  const existing = connections.get(profileId);
  if (existing) {
    existing.close();
    connections.delete(profileId);
  }
}

async function navigate(profileId, cdpUrl, url) {
  const cdp = await session(profileId, cdpUrl);
  await cdp.send('Page.enable');
  // Subscribe before navigating: the load event for a cached page can arrive
  // before Page.navigate's own response does.
  const loaded = cdp.once('Page.loadEventFired', LOAD_TIMEOUT_MS);
  const result = await cdp.send('Page.navigate', {url});
  if (result.errorText) {
    throw new Error(`${url} failed to load: ${result.errorText}`);
  }
  try {
    await loaded;
  } catch {
    // A page that never fires load is still a page an agent can read. Report
    // the navigation as done rather than failing a call that mostly worked.
    return {url, loaded: false};
  }
  return {url, loaded: true};
}

async function readPage(profileId, cdpUrl, maxChars) {
  const cdp = await session(profileId, cdpUrl);
  const result = await cdp.send('Runtime.evaluate', {
    expression: `(() => ({
      url: location.href,
      title: document.title,
      text: (document.body && document.body.innerText || '').slice(0, ${maxChars}),
    }))()`,
    returnByValue: true,
    awaitPromise: false,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text || 'Could not read the page');
  }
  return result.result?.value || {url: null, title: null, text: ''};
}

async function screenshot(profileId, cdpUrl, fullPage) {
  const cdp = await session(profileId, cdpUrl);
  await cdp.send('Page.enable');
  const result = await cdp.send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: Boolean(fullPage),
  });
  if (!result.data) {
    throw new Error('The browser returned an empty screenshot');
  }
  return result.data;
}

module.exports = {navigate, readPage, release, screenshot};
