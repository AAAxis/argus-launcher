// The model providers an AI step can be pointed at.
//
// A static catalogue, like src/data/integrations.ts, and for the same reason:
// what these are does not change per workspace, only which ones a workspace has
// configured. A row in ai_providers names one of these by `kind`.
//
// THE IMPORTANT THING ABOUT THIS FILE is `adapter`. There are thirteen entries
// and exactly two wire protocols. Eleven of these speak OpenAI's
// POST {base}/chat/completions with `Authorization: Bearer`, because every one
// of them shipped an OpenAI-compatible endpoint rather than ask the ecosystem
// to write a thirteenth client -- and Google's is a compatibility shim it
// publishes for the same reason. Anthropic is the one that is genuinely
// different: POST /v1/messages, `x-api-key`, an `anthropic-version` header and
// its own response shape.
//
// So adding a provider is almost always one entry here and nothing else. If you
// find yourself adding a third adapter, check first whether the service
// publishes an OpenAI-compatible base URL; most do.

export type AiAdapter = 'openai' | 'anthropic';

export type AiProviderPreset = {
  kind: string;
  label: string;
  adapter: AiAdapter;
  // Where the preset points. Empty for 'custom', which requires the user to
  // supply one.
  baseUrl: string;
  // Whether a key is required. The local runtimes authenticate nobody, and
  // demanding one would make the easiest provider to try the hardest to set up.
  needsKey: boolean;
  // Prefilled in the model box. Not a validated list: these services rename and
  // retire models faster than this app ships, so the field stays free text and
  // this is only a starting point.
  suggestedModel: string;
  // Where to get a key, opened in the user's own browser. Omitted for the local
  // runtimes, which have nowhere to send anyone.
  keyUrl?: string;
};

export const AI_PROVIDER_PRESETS: AiProviderPreset[] = [
  {
    kind: 'openai',
    label: 'OpenAI',
    adapter: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    needsKey: true,
    suggestedModel: 'gpt-4.1-mini',
    keyUrl: 'https://platform.openai.com/api-keys',
  },
  {
    kind: 'anthropic',
    label: 'Anthropic',
    adapter: 'anthropic',
    baseUrl: 'https://api.anthropic.com',
    needsKey: true,
    suggestedModel: 'claude-sonnet-5',
    keyUrl: 'https://console.anthropic.com/settings/keys',
  },
  {
    kind: 'deepseek',
    label: 'DeepSeek',
    adapter: 'openai',
    baseUrl: 'https://api.deepseek.com/v1',
    needsKey: true,
    suggestedModel: 'deepseek-chat',
    keyUrl: 'https://platform.deepseek.com/api_keys',
  },
  {
    kind: 'google',
    label: 'Google Gemini',
    adapter: 'openai',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    needsKey: true,
    suggestedModel: 'gemini-2.5-flash',
    keyUrl: 'https://aistudio.google.com/app/apikey',
  },
  {
    kind: 'mistral',
    label: 'Mistral',
    adapter: 'openai',
    baseUrl: 'https://api.mistral.ai/v1',
    needsKey: true,
    suggestedModel: 'mistral-small-latest',
    keyUrl: 'https://console.mistral.ai/api-keys',
  },
  {
    kind: 'groq',
    label: 'Groq',
    adapter: 'openai',
    baseUrl: 'https://api.groq.com/openai/v1',
    needsKey: true,
    suggestedModel: 'llama-3.3-70b-versatile',
    keyUrl: 'https://console.groq.com/keys',
  },
  {
    kind: 'xai',
    label: 'xAI Grok',
    adapter: 'openai',
    baseUrl: 'https://api.x.ai/v1',
    needsKey: true,
    suggestedModel: 'grok-4',
    keyUrl: 'https://console.x.ai',
  },
  {
    kind: 'openrouter',
    label: 'OpenRouter',
    adapter: 'openai',
    baseUrl: 'https://openrouter.ai/api/v1',
    needsKey: true,
    suggestedModel: 'openai/gpt-4.1-mini',
    keyUrl: 'https://openrouter.ai/keys',
  },
  {
    kind: 'together',
    label: 'Together AI',
    adapter: 'openai',
    baseUrl: 'https://api.together.xyz/v1',
    needsKey: true,
    suggestedModel: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
    keyUrl: 'https://api.together.ai/settings/api-keys',
  },
  {
    kind: 'huggingface',
    label: 'Hugging Face',
    adapter: 'openai',
    baseUrl: 'https://router.huggingface.co/v1',
    needsKey: true,
    suggestedModel: 'meta-llama/Llama-3.3-70B-Instruct',
    keyUrl: 'https://huggingface.co/settings/tokens',
  },
  {
    kind: 'lmstudio',
    label: 'LM Studio (local)',
    adapter: 'openai',
    baseUrl: 'http://127.0.0.1:1234/v1',
    needsKey: false,
    suggestedModel: 'local-model',
  },
  {
    kind: 'ollama',
    label: 'Ollama (local)',
    adapter: 'openai',
    baseUrl: 'http://127.0.0.1:11434/v1',
    needsKey: false,
    suggestedModel: 'llama3.1',
  },
  {
    kind: 'custom',
    label: 'Other (OpenAI-compatible)',
    adapter: 'openai',
    baseUrl: '',
    needsKey: false,
    suggestedModel: '',
  },
];

// The preset a stored row names, or null when this build does not recognise it.
//
// Null rather than a fallback to 'custom': a row written by a newer build names
// a real service with a real endpoint, and quietly treating it as "other" would
// send its requests to whatever base_url happened to be stored -- or to none.
// The settings list says it does not recognise the kind instead.
export function presetFor(kind: string): AiProviderPreset | null {
  return AI_PROVIDER_PRESETS.find((preset) => preset.kind === kind) || null;
}

// What the main process is handed: a provider with its preset already applied.
//
// The resolution happens on this side because this is the side that has the
// catalogue. electron/ compiles nothing from src/, so the alternative is a
// second copy of thirteen base URLs and their adapters over there, kept in step
// by hand -- the drift step-schema.json exists to avoid.
//
// An unrecognised `kind` still resolves, as long as the row carries its own
// base_url. That is the honest reading: a row written by a newer build names a
// real service, and refusing to run it because this build has not heard of the
// preset would break a workspace on the strength of a version skew.
export type RuntimeAiProvider = {
  id: string;
  name: string;
  adapter: AiAdapter;
  base_url: string;
  model: string;
  api_key: string | null;
  is_default: boolean;
};

export function runtimeProvider(provider: {
  id: string;
  name: string;
  kind: string;
  base_url?: string | null;
  model: string;
  api_key?: string | null;
  is_default?: boolean;
}): RuntimeAiProvider {
  const preset = presetFor(provider.kind);
  return {
    id: provider.id,
    name: provider.name,
    adapter: preset?.adapter || 'openai',
    // The row's own endpoint wins. It is only set when the user typed one, and
    // someone who typed one meant it -- a self-hosted gateway or a regional
    // endpoint is exactly this field's purpose.
    base_url: provider.base_url?.trim() || preset?.baseUrl || '',
    model: provider.model,
    api_key: provider.api_key ?? null,
    is_default: Boolean(provider.is_default),
  };
}
