// The high-level CDP calls the MCP tools expose, for driving a profile the
// launcher has already started.
//
// `POST /v1/profiles/launch-automation` spawns the browser with
// --remote-debugging-port and hands back http://127.0.0.1:<port>. Everything a
// coding agent actually wants to do with an open profile -- navigate, read the
// page, screenshot it -- is CDP on top of that.
//
// The transport moved to ../cdp-core.cjs when the automation runner needed the
// same wire format with a different connection lifetime. Everything here is
// one-shot by design: withPage opens a socket per call and closes it in a
// finally. A pooled socket would save a few milliseconds on loopback and buy a
// whole class of stale-handle bugs when the window is closed and reopened
// between two tool calls. The runner, which drives many steps against one page,
// holds its own session instead.

const {LOAD_TIMEOUT_MS, listTargets, withPage} = require('../cdp-core.cjs');

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
