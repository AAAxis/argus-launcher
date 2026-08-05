// Talking to a model, from the main process.
//
// The connector registry -- the in-memory map of credentials, resolve(), and
// the shared HTTP transport -- lives in ./connectors.cjs; this file is only
// the completion protocol. The split follows the data: the registry is
// category-neutral (aiPrompt and notify both resolve through it), while
// everything below is specific to asking a model a question.
//
// WHY THESE CALLS LEAVE FROM HERE and why the key never reaches a step, a
// var, the run log or run.json: see the header of connectors.cjs.
//
// TWO ADAPTERS, THIRTEEN PROVIDERS. See src/data/connectors.ts. Eleven of
// them speak OpenAI's /chat/completions; Anthropic speaks /v1/messages.
// Anything else that turns up almost certainly publishes an OpenAI-compatible
// base URL -- check before writing a third adapter.
const {REQUEST_TIMEOUT_MS, getJson, join, postJson} = require('./connectors.cjs');

// Anthropic pins its wire format to a dated version header. Without it the API
// answers 400 rather than defaulting to anything.
const ANTHROPIC_VERSION = '2023-06-01';

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

// One completion. `provider` is a resolved AI connector, not an id -- the Test
// button passes an unsaved draft, and steps pass what connectors.resolve()
// handed back.
//
// It carries its OWN `adapter` and `base_url`, already resolved against the
// preset catalogue by the renderer. That catalogue is TypeScript under src/,
// nothing compiles electron/, and a second hand-maintained copy of thirteen
// base URLs over here is exactly the drift this codebase avoids elsewhere --
// the same argument step-schema.json is built on.
async function complete({provider, system, user, maxTokens, json}) {
  const model = String(provider?.model || '').trim();
  if (!model) {
    throw new Error(`AI connector "${provider?.name || 'unnamed'}" has no model set`);
  }
  const endpoint = String(provider.base_url || '').trim();
  if (!endpoint) {
    throw new Error(`AI connector "${provider.name}" has no endpoint set`);
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

// What the endpoint actually serves, so the model box can be a real choice
// instead of a string typed from memory. Both wire formats publish a listing
// -- GET /models on everything OpenAI-compatible, GET /v1/models on Anthropic
// -- and both answer {data: [{id}]}. The key proves itself here too: a wrong
// one fails this call with the provider's own 401 sentence.
//
// Order is preserved as the provider sent it (most put the current models
// first) and nothing is filtered: guessing which ids are "chat" models breaks
// differently on every vendor, and a picker that hides a real id is worse
// than one that shows an embedding model.
async function listModels({provider}) {
  const endpoint = String(provider?.base_url || '').trim();
  if (!endpoint) {
    throw new Error(`AI connector "${provider?.name || 'unnamed'}" has no endpoint set`);
  }
  const anthropic = provider.adapter === 'anthropic';
  const answer = await getJson(
      join(endpoint, anthropic ? '/v1/models?limit=1000' : '/models'),
      anthropic ?
        {'x-api-key': provider.api_key || '', 'anthropic-version': ANTHROPIC_VERSION} :
        (provider.api_key ? {authorization: `Bearer ${provider.api_key}`} : {}));
  const models = (Array.isArray(answer?.data) ? answer.data : [])
      .map((entry) => (typeof entry === 'string' ? entry : entry?.id))
      .filter((id) => typeof id === 'string' && id.length > 0);
  if (models.length === 0) {
    throw new Error('The endpoint answered, but with no models this app recognises');
  }
  return [...new Set(models)];
}

module.exports = {REQUEST_TIMEOUT_MS, complete, listModels};
