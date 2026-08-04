// One executor per step type, plus the validator.
//
// Executors receive a context and the already-interpolated step, and return
// either nothing or {vars} to merge. They do NOT implement their own timeouts:
// runner.cjs applies one with Promise.race around every call, so no executor
// can forget one. They also do not catch their own errors -- throwing is how a
// step reports failure, and the runner's onError policy decides what that means.

const https = require('node:https');
const http = require('node:http');
const {LOAD_TIMEOUT_MS} = require('../cdp-core.cjs');

const POLL_INTERVAL_MS = 100;

// ── helpers ──────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Runs an expression in the page and returns its value, turning a thrown
// exception into a thrown Error rather than a silent undefined.
async function evaluateValue(cdp, expression, {awaitPromise = false} = {}) {
  const result = await cdp.send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise,
  });
  if (result.exceptionDetails) {
    throw new Error(
        result.exceptionDetails.exception?.description ||
        result.exceptionDetails.text ||
        'The script threw');
  }
  return result.result?.value;
}

// Resolves a selector to its centre point in viewport coordinates, scrolling it
// into view first. Returns null when it does not match.
async function boxOf(cdp, selector, nth) {
  const expression = `(() => {
    const all = document.querySelectorAll(${JSON.stringify(selector)});
    const el = all[${Number(nth) || 0}];
    if (!el) return null;
    el.scrollIntoView({block: 'center', inline: 'center'});
    const r = el.getBoundingClientRect();
    if (!r.width && !r.height) return null;
    return {x: r.left + r.width / 2, y: r.top + r.height / 2};
  })()`;
  return evaluateValue(cdp, expression);
}

async function focusSelector(cdp, selector, clear) {
  const expression = `(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return false;
    el.focus();
    if (${Boolean(clear)} && 'value' in el) {
      el.value = '';
      el.dispatchEvent(new Event('input', {bubbles: true}));
    }
    return true;
  })()`;
  const ok = await evaluateValue(cdp, expression);
  if (!ok) {
    throw new Error(`No element matches ${selector}`);
  }
}

// Polls `expression` until it returns true. Used by waitFor, which cannot lean
// on a single CDP event for selector and text conditions.
async function pollUntil(cdp, expression, deadline, describe) {
  for (;;) {
    if (await evaluateValue(cdp, expression)) {
      return;
    }
    if (Date.now() >= deadline) {
      throw new Error(`Timed out waiting for ${describe}`);
    }
    await sleep(POLL_INTERVAL_MS);
  }
}

// ── executors ────────────────────────────────────────────────────────────────

const EXECUTORS = {
  async goto({cdp, step, log}) {
    await cdp.send('Page.enable');
    // Subscribe before navigating: a cached page can fire its load event before
    // Page.navigate's own response comes back.
    const event = step.waitUntil === 'domcontentloaded' ?
      'Page.domContentEventFired' :
      'Page.frameStoppedLoading';
    const settled = cdp.once(event, LOAD_TIMEOUT_MS);
    const result = await cdp.send('Page.navigate', {url: step.url});
    if (result.errorText) {
      throw new Error(`${step.url} failed to load: ${result.errorText}`);
    }
    try {
      await settled;
    } catch {
      // A page that never stops loading is still a page the next step can use.
      log('warn', `${step.url} did not finish loading; continuing`);
    }
  },

  async waitFor({cdp, step, deadline}) {
    if (step.for === 'selector') {
      return pollUntil(cdp,
          `!!document.querySelector(${JSON.stringify(step.selector)})`,
          deadline, step.selector);
    }
    if (step.for === 'selectorGone') {
      return pollUntil(cdp,
          `!document.querySelector(${JSON.stringify(step.selector)})`,
          deadline, `${step.selector} to disappear`);
    }
    if (step.for === 'url') {
      return pollUntil(cdp,
          `location.href.includes(${JSON.stringify(step.url)})`,
          deadline, `the URL to contain ${step.url}`);
    }
    return pollUntil(cdp,
        `(document.body?.innerText || '').includes(${JSON.stringify(step.text)})`,
        deadline, `the text ${JSON.stringify(step.text)}`);
  },

  async click({cdp, step}) {
    const point = await boxOf(cdp, step.selector, step.nth);
    if (!point) {
      throw new Error(`No visible element matches ${step.selector}`);
    }
    // Real mouse events rather than el.click(): sites that check isTrusted
    // ignore a synthetic click, and this is an anti-detect product.
    const base = {x: point.x, y: point.y, button: 'left', clickCount: 1};
    await cdp.send('Input.dispatchMouseEvent', {...base, type: 'mousePressed'});
    await cdp.send('Input.dispatchMouseEvent', {...base, type: 'mouseReleased'});
  },

  async type({cdp, step}) {
    await focusSelector(cdp, step.selector, step.clear !== false);
    const text = String(step.text ?? '');
    if (step.delayMs && step.delayMs > 0) {
      // Per-character key events. Slower, but it is what a site watching for
      // paste-shaped input is looking at.
      for (const char of text) {
        await cdp.send('Input.dispatchKeyEvent', {type: 'keyDown', text: char});
        await cdp.send('Input.dispatchKeyEvent', {type: 'keyUp'});
        await sleep(step.delayMs);
      }
    } else {
      await cdp.send('Input.insertText', {text});
    }
    if (step.pressEnter) {
      const enter = {windowsVirtualKeyCode: 13, key: 'Enter', code: 'Enter', text: '\r'};
      await cdp.send('Input.dispatchKeyEvent', {...enter, type: 'keyDown'});
      await cdp.send('Input.dispatchKeyEvent', {...enter, type: 'keyUp'});
    }
  },

  async scroll({cdp, step}) {
    if (step.to === 'selector') {
      const ok = await evaluateValue(cdp, `(() => {
        const el = document.querySelector(${JSON.stringify(step.selector)});
        if (!el) return false;
        el.scrollIntoView({block: 'center'});
        return true;
      })()`);
      if (!ok) {
        throw new Error(`No element matches ${step.selector}`);
      }
      return;
    }
    const target = step.to === 'top' ? '0' : 'document.body.scrollHeight';
    await evaluateValue(cdp, `window.scrollTo(0, ${target})`);
  },

  async extract({cdp, step}) {
    const what = step.what || 'text';
    const reader = {
      text: 'el.innerText',
      html: 'el.innerHTML',
      value: 'el.value',
      attr: `el.getAttribute(${JSON.stringify(step.attr || '')})`,
    }[what];
    const expression = step.all ?
      `Array.from(document.querySelectorAll(${JSON.stringify(step.selector)}))
         .map((el) => ${reader} ?? null)` :
      `(() => {
         const el = document.querySelector(${JSON.stringify(step.selector)});
         if (!el) return null;
         return ${reader} ?? null;
       })()`;
    const value = await evaluateValue(cdp, expression);
    // An empty array is a legitimate answer; a null single match is not -- it
    // means the selector found nothing, and storing null would let the next
    // step run on a value that was never really there.
    if (!step.all && value === null) {
      throw new Error(`No element matches ${step.selector}`);
    }
    return {vars: {[step.into]: value}};
  },

  async evaluate({cdp, step}) {
    // The script is NEVER interpolated -- see interpolate.cjs. Values arrive as
    // a real argument, JSON-encoded, so nothing is spliced into source.
    const args = JSON.stringify(step.args || {});
    const value = await evaluateValue(
        cdp,
        `(function(vars){ ${step.script} })(${args})`,
        {awaitPromise: true});
    return step.into ? {vars: {[step.into]: value}} : undefined;
  },

  async screenshot({cdp, step, saveScreenshot}) {
    await cdp.send('Page.enable');
    const params = {format: 'png', captureBeyondViewport: Boolean(step.fullPage)};
    if (step.selector) {
      const box = await evaluateValue(cdp, `(() => {
        const el = document.querySelector(${JSON.stringify(step.selector)});
        if (!el) return null;
        el.scrollIntoView({block: 'center'});
        const r = el.getBoundingClientRect();
        return {x: r.left, y: r.top, width: r.width, height: r.height};
      })()`);
      if (!box) {
        throw new Error(`No element matches ${step.selector}`);
      }
      params.clip = {...box, scale: 1};
    }
    const result = await cdp.send('Page.captureScreenshot', params);
    if (!result.data) {
      throw new Error('The browser returned an empty screenshot');
    }
    return {screenshot: await saveScreenshot(result.data)};
  },

  async wait({step}) {
    if (step.minMs !== undefined && step.maxMs !== undefined) {
      const min = Math.min(step.minMs, step.maxMs);
      const max = Math.max(step.minMs, step.maxMs);
      return sleep(min + Math.random() * (max - min));
    }
    return sleep(Math.max(0, Number(step.ms) || 0));
  },

  async setVar({step}) {
    return {vars: {[step.name]: step.value}};
  },

  // Sent from the launcher, not the page. A fetch from the page would traverse
  // the profile's proxy and carry its cookies, which is a surprising and leaky
  // default for "post my results to a webhook".
  async httpRequest({step}) {
    const value = await new Promise((resolve, reject) => {
      let url;
      try {
        url = new URL(step.url);
      } catch {
        reject(new Error(`Not a valid URL: ${step.url}`));
        return;
      }
      const transport = url.protocol === 'http:' ? http : https;
      const request = transport.request(url, {
        method: step.method || 'GET',
        headers: step.headers || {},
        timeout: 30000,
      }, (response) => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => {
          body += chunk;
        });
        response.on('end', () => {
          let parsed = body;
          try {
            parsed = JSON.parse(body);
          } catch {
            // Not JSON; the raw text is the answer.
          }
          resolve({status: response.statusCode, body: parsed});
        });
      });
      request.on('timeout', () => request.destroy(new Error(`${step.url} timed out`)));
      request.on('error', reject);
      if (step.method === 'POST' && step.body) {
        request.write(step.body);
      }
      request.end();
    });
    return step.into ? {vars: {[step.into]: value}} : undefined;
  },
};

// ── conditions ───────────────────────────────────────────────────────────────

async function evaluateCondition(cdp, condition) {
  const left = condition.left;
  const right = condition.right;
  switch (condition.op) {
    case 'exists':
      return left !== undefined && left !== null && String(left) !== '';
    case 'selectorExists':
      return Boolean(await evaluateValue(
          cdp, `!!document.querySelector(${JSON.stringify(String(left))})`));
    case 'equals':
      return String(left) === String(right);
    case 'notEquals':
      return String(left) !== String(right);
    case 'contains':
      return String(left).includes(String(right));
    default:
      throw new Error(`Unknown condition ${condition.op}`);
  }
}

// ── validation ───────────────────────────────────────────────────────────────

const MAX_DEPTH = 3;
const MAX_RETRIES = 5;

function fieldVisible(field, step) {
  if (!field.showWhen) {
    return true;
  }
  return Object.entries(field.showWhen).every(([key, expected]) => {
    const actual = step[key];
    return Array.isArray(expected) ?
      expected.includes(String(actual)) :
      String(actual) === expected;
  });
}

// Returns a list of human-readable problems. Empty means valid.
//
// The messages are addressed by path ("steps[2].selector is required") because
// they are what an agent authoring a workflow over MCP gets back -- the
// validator is its feedback loop, so a vague message costs a round trip.
function validateSteps(steps, schema, path = 'steps', depth = 0) {
  const problems = [];
  if (!Array.isArray(steps)) {
    return [`${path} must be a list`];
  }
  if (depth > MAX_DEPTH) {
    return [`${path} is nested deeper than ${MAX_DEPTH} levels`];
  }
  steps.forEach((step, index) => {
    const at = `${path}[${index}]`;
    if (!step || typeof step !== 'object') {
      problems.push(`${at} must be an object`);
      return;
    }
    const spec = schema[step.type];
    if (!spec) {
      problems.push(`${at}.type "${step.type}" is not a known step type`);
      return;
    }
    if (!step.id) {
      problems.push(`${at}.id is required`);
    }
    if (step.onError && !['stop', 'continue', 'retry'].includes(step.onError)) {
      problems.push(`${at}.onError must be stop, continue or retry`);
    }
    if (step.retries !== undefined && (step.retries < 0 || step.retries > MAX_RETRIES)) {
      problems.push(`${at}.retries must be between 0 and ${MAX_RETRIES}`);
    }
    for (const field of spec.fields) {
      const value = step[field.key];
      if (field.kind === 'steps') {
        if (value !== undefined) {
          problems.push(...validateSteps(value, schema, `${at}.${field.key}`, depth + 1));
        }
        continue;
      }
      // A hidden field is never required -- otherwise `attr` would block every
      // extract that is not reading an attribute.
      if (!fieldVisible(field, step)) {
        continue;
      }
      if (field.required && (value === undefined || value === null || value === '')) {
        problems.push(`${at}.${field.key} is required`);
        continue;
      }
      if (value === undefined || value === null) {
        continue;
      }
      if (field.pattern && !new RegExp(field.pattern).test(String(value))) {
        problems.push(`${at}.${field.key} must match ${field.pattern}`);
      }
      if (field.options && !field.options.includes(String(value))) {
        problems.push(
            `${at}.${field.key} must be one of ${field.options.join(', ')}`);
      }
    }
    if (step.type === 'if') {
      if (!step.condition || !step.condition.op) {
        problems.push(`${at}.condition is required`);
      }
      problems.push(...validateSteps(step.then || [], schema, `${at}.then`, depth + 1));
      if (step.else) {
        problems.push(...validateSteps(step.else, schema, `${at}.else`, depth + 1));
      }
    }
    if (step.type === 'loop') {
      if (step.mode === 'times' && !(step.times > 0)) {
        problems.push(`${at}.times must be a positive number`);
      }
      if (step.mode === 'forEach' && !step.items) {
        problems.push(`${at}.items is required for a forEach loop`);
      }
      problems.push(...validateSteps(step.body || [], schema, `${at}.body`, depth + 1));
    }
    if (step.type === 'wait' &&
        step.ms === undefined && (step.minMs === undefined || step.maxMs === undefined)) {
      problems.push(`${at} needs either ms, or both minMs and maxMs`);
    }
  });
  return problems;
}

module.exports = {EXECUTORS, evaluateCondition, sleep, validateSteps};
