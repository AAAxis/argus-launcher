// A minimal Chrome DevTools Protocol client, for driving a profile the
// launcher has already started.
//
// `POST /v1/profiles/launch-automation` spawns the browser with
// --remote-debugging-port and hands back http://127.0.0.1:<port>. Everything a
// coding agent actually wants to do with an open profile -- navigate, read the
// page, screenshot it -- is CDP on top of that.
//
// `ws` is the launcher's own dependency and resolves from *inside* app.asar.
// It must NOT be unpacked: a script at app.asar.unpacked/... cannot see
// app.asar/node_modules, because module resolution walks up the literal path.
// Verified both ways -- the unpacked form fails with "Cannot find module 'ws'".
//
// Connections are one-shot: opened per call, closed in a finally. A pooled
// socket saves a few milliseconds on loopback and buys a whole class of
// stale-handle bugs when the window is closed and reopened between two tool
// calls. Not worth it.

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

// The page target, not the browser target: Page.* and Runtime.* only exist on
// a page. Attaching to the page endpoint directly also avoids every bit of
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

// Wraps one socket for the life of a single tool call.
class Session {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
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
    this.waiters = this.waiters.filter((waiter) => {
      if (waiter.method !== message.method) {
        return true;
      }
      clearTimeout(waiter.timer);
      waiter.resolve(message.params || {});
      return false;
    });
  }

  // A dead socket must reject everything outstanding, or a tool call hangs to
  // its own timeout with no explanation of what actually happened.
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
      // Already gone.
    }
  }
}

async function withPage(cdpUrl, run) {
  const target = await pageTarget(cdpUrl);
  const session = new Session(await connect(target.webSocketDebuggerUrl));
  try {
    return await run(session, target);
  } finally {
    session.close();
  }
}

async function navigate(cdpUrl, url) {
  return withPage(cdpUrl, async (cdp) => {
    await cdp.send('Page.enable');
    // Subscribe before navigating: a cached page can fire load before
    // Page.navigate's own response comes back.
    const settled = cdp.once('Page.frameStoppedLoading', LOAD_TIMEOUT_MS);
    const result = await cdp.send('Page.navigate', {url});
    if (result.errorText) {
      throw new Error(`${url} failed to load: ${result.errorText}`);
    }
    let loaded = true;
    try {
      await settled;
    } catch {
      // A page that never stops loading is still a page an agent can read.
      // Report it rather than failing a call that mostly worked.
      loaded = false;
    }
    const final = await cdp.send('Runtime.evaluate', {
      expression: '({url: location.href, title: document.title})',
      returnByValue: true,
    });
    return {loaded, ...(final.result?.value || {url, title: null})};
  });
}

async function readPage(cdpUrl, selector, maxChars) {
  return withPage(cdpUrl, async (cdp) => {
    const target = selector ? JSON.stringify(selector) : 'null';
    const result = await cdp.send('Runtime.evaluate', {
      expression: `(() => {
        const sel = ${target};
        const el = (sel && document.querySelector(sel)) || document.body;
        if (!el) return {url: location.href, title: document.title, text: ''};
        return {
          url: location.href,
          title: document.title,
          text: (el.innerText || '').replace(/\\n{3,}/g, '\\n\\n').slice(0, ${maxChars}),
        };
      })()`,
      returnByValue: true,
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.text || 'Could not read the page');
    }
    return result.result?.value || {url: null, title: null, text: ''};
  });
}

async function evaluate(cdpUrl, expression) {
  return withPage(cdpUrl, async (cdp) => {
    const result = await cdp.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description ||
        result.exceptionDetails.text || 'The expression threw');
    }
    return result.result?.value;
  });
}

// JPEG at q70 by default, not PNG: a full-page PNG screenshot can run to
// megabytes, and every one of those bytes lands in the agent's context.
async function screenshot(cdpUrl, {fullPage = false, png = false} = {}) {
  return withPage(cdpUrl, async (cdp, target) => {
    await cdp.send('Page.enable');
    const params = png ?
      {format: 'png'} :
      {format: 'jpeg', quality: 70};
    const result = await cdp.send('Page.captureScreenshot', {
      ...params,
      captureBeyondViewport: Boolean(fullPage),
    });
    if (!result.data) {
      throw new Error('The browser returned an empty screenshot');
    }
    return {
      data: result.data,
      mimeType: png ? 'image/png' : 'image/jpeg',
      url: target.url || null,
      title: target.title || null,
    };
  });
}

async function tabs(cdpUrl) {
  return (await listTargets(cdpUrl))
      .filter((target) => target.type === 'page')
      .map((target) => ({id: target.id, title: target.title, url: target.url}));
}

module.exports = {evaluate, navigate, readPage, screenshot, tabs};
