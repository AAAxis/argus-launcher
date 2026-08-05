// Talking to a model, from the main process.
//
// WHY HERE AND NOT IN THE PAGE. The same reason httpRequest is here: a fetch
// from the profile's page would traverse that profile's proxy and carry its
// cookies, so every AI call would leak the workflow's shape to the proxy
// operator and bill an identity's residential IP for an API request that has
// nothing to do with that identity. These go out from the launcher.
//
// WHY THE KEY LIVES IN THIS PROCESS. A step names a provider by id and nothing
// else. The renderer reads ai_providers from Supabase and pushes the resolved
// list in over IPC; the map below is the only copy, it is in memory, and it is
// never written anywhere. So the key cannot reach an automation's steps, its
// vars, its run log or run.json -- which is what makes it safe for the run
// record to be flushed to the cloud and read back by anyone in the org.
//
// TWO ADAPTERS, THIRTEEN PROVIDERS. See src/data/aiProviders.ts. Eleven of them
// speak OpenAI's /chat/completions; Anthropic speaks /v1/messages. Anything
// else that turns up almost certainly publishes an OpenAI-compatible base URL.
const http = require('http');
const https = require('https');

// How long one call may take. Longer than the 15s default step timeout because
// a reasoning model on a long page legitimately takes tens of seconds -- but
// the runner still races every step against its own deadline, so this is a
// backstop against a socket that never answers, not the real budget.
const REQUEST_TIMEOUT_MS = 60000;

// Anthropic pins its wire format to a dated version header. Without it the API
// answers 400 rather than defaulting to anything.
const ANTHROPIC_VERSION = '2023-06-01';

// id -> {id, name, adapter, base_url, model, api_key, is_default}
//
// `adapter` and `base_url` arrive already resolved against the preset
// catalogue; see complete() for why that resolution belongs on the other side.
let providers = new Map();

// Replaces the whole list, including with an empty one. Clearing matters as
// much as filling: a provider deleted in the workspace has to stop working
// here immediately, not at the next restart.
function setProviders(list) {
  providers = new Map();
  for (const entry of Array.isArray(list) ? list : []) {
    if (entry && typeof entry.id === 'string') {
      providers.set(entry.id, entry);
    }
  }
}

// The provider a step named, or the workspace default when it named none.
//
// Throws rather than returning null: every caller is inside a step executor,
// where a thrown error is how a step reports that it cannot run, and a null
// would have to be turned back into this same message by each of them.
function resolve(providerId) {
  if (providerId) {
    const found = providers.get(providerId);
    if (!found) {
      throw new Error(
          'This step names an AI provider that no longer exists. ' +
          'Pick one in Settings → AI providers.');
    }
    return found;
  }
  for (const entry of providers.values()) {
    if (entry.is_default) {
      return entry;
    }
  }
  throw new Error(
      'No AI provider is configured. Add one in Settings → AI providers.');
}

// One JSON round trip. Shared by both adapters so timeouts, transport choice
// and body handling are written once.
function postJson(url, headers, body) {
  return new Promise((resolve, reject) => {
    let target;
    try {
      target = new URL(url);
    } catch {
      reject(new Error(`Not a valid provider URL: ${url}`));
      return;
    }
    const payload = JSON.stringify(body);
    const transport = target.protocol === 'http:' ? http : https;
    const request = transport.request(target, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(payload),
        ...headers,
      },
      timeout: REQUEST_TIMEOUT_MS,
    }, (response) => {
      let text = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        text += chunk;
      });
      response.on('end', () => {
        let parsed = null;
        try {
          parsed = JSON.parse(text);
        } catch {
          // Not JSON. Almost always an HTML error page from a gateway, and the
          // raw text is the only thing we can honestly report.
        }
        if (response.statusCode >= 400) {
          // The provider's own message, when it sent one. A bare "HTTP 401" is
          // the difference between "your key is wrong" and half an hour.
          const detail = parsed?.error?.message || parsed?.message ||
            (text ? text.slice(0, 300) : '');
          reject(new Error(
              `${target.host} answered ${response.statusCode}${detail ? `: ${detail}` : ''}`));
          return;
        }
        if (!parsed) {
          reject(new Error(`${target.host} did not answer with JSON`));
          return;
        }
        resolve(parsed);
      });
    });
    request.on('timeout', () =>
      request.destroy(new Error(`${target.host} did not answer within ${
        Math.round(REQUEST_TIMEOUT_MS / 1000)}s`)));
    request.on('error', reject);
    request.write(payload);
    request.end();
  });
}

// Trailing slashes are the single most common way a hand-typed base URL breaks:
// 'https://host/v1/' + '/chat/completions' is a 404 that reads like a wrong key.
function join(baseUrl, path) {
  return `${String(baseUrl || '').replace(/\/+$/, '')}${path}`;
}

async function completeOpenAi({baseUrl, apiKey, model, system, user, maxTokens, json}) {
  const answer = await postJson(
      join(baseUrl, '/chat/completions'),
      // No Authorization header at all when there is no key, rather than
      // 'Bearer '. LM Studio and Ollama accept anything; a stricter local
      // gateway rejects a malformed one.
      apiKey ? {authorization: `Bearer ${apiKey}`} : {},
      {
        model,
        max_tokens: maxTokens,
        messages: [
          ...(system ? [{role: 'system', content: system}] : []),
          {role: 'user', content: user},
        ],
        // Not every OpenAI-compatible server implements this, and the ones that
        // do not ignore an unknown key rather than failing. The prompt asks for
        // JSON as well, so this is reinforcement and not the mechanism.
        ...(json ? {response_format: {type: 'json_object'}} : {}),
      });
  const text = answer?.choices?.[0]?.message?.content;
  if (typeof text !== 'string') {
    throw new Error('The model answered in a shape this app does not understand');
  }
  return text.trim();
}

async function completeAnthropic({baseUrl, apiKey, model, system, user, maxTokens}) {
  const answer = await postJson(
      join(baseUrl, '/v1/messages'),
      {'x-api-key': apiKey || '', 'anthropic-version': ANTHROPIC_VERSION},
      {
        model,
        // Required by this API, unlike the OpenAI one where it is optional.
        max_tokens: maxTokens,
        ...(system ? {system} : {}),
        messages: [{role: 'user', content: user}],
      });
  // content is a list of blocks; the text ones are what we asked for.
  const text = (answer?.content || [])
      .filter((block) => block?.type === 'text')
      .map((block) => block.text)
      .join('')
      .trim();
  if (!text) {
    throw new Error('The model answered with no text');
  }
  return text;
}

// One completion. `provider` is a resolved record, not an id -- the Test button
// passes an unsaved draft, and steps pass what resolve() handed back.
//
// It carries its OWN `adapter` and `base_url`, already resolved against the
// preset catalogue by the renderer. That catalogue is TypeScript under src/,
// nothing compiles electron/, and a second hand-maintained copy of thirteen
// base URLs over here is exactly the drift this codebase avoids elsewhere --
// the same argument step-schema.json is built on.
async function complete({provider, system, user, maxTokens, json}) {
  const model = String(provider?.model || '').trim();
  if (!model) {
    throw new Error(`AI provider "${provider?.name || 'unnamed'}" has no model set`);
  }
  const endpoint = String(provider.base_url || '').trim();
  if (!endpoint) {
    throw new Error(`AI provider "${provider.name}" has no endpoint set`);
  }
  const args = {
    baseUrl: endpoint,
    apiKey: provider.api_key,
    model,
    system,
    user,
    maxTokens: Math.min(Math.max(Number(maxTokens) || 512, 1), 4096),
    json,
  };
  return provider.adapter === 'anthropic' ? completeAnthropic(args) : completeOpenAi(args);
}

module.exports = {REQUEST_TIMEOUT_MS, complete, resolve, setProviders};
