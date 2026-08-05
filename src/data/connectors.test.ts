// The connector catalogue's pure halves: what a draft must contain before it
// can be saved, how a stored row resolves into the runtime shape the main
// process is handed, and which keys count as secrets. These three are what
// the connector form, the IPC push and the masking all key off, so they are
// tested here rather than through the UI.
import {describe, expect, it} from 'vitest';
import {runtimeConnector, secretKeysFor, validateConnectorConfig} from './connectors';

function connector(overrides: Partial<Parameters<typeof runtimeConnector>[0]> = {}) {
  return {
    id: 'c1',
    name: 'Test',
    category: 'ai',
    kind: 'openai',
    config: {},
    ...overrides,
  };
}

describe('validateConnectorConfig', () => {
  it('accepts a complete telegram config', () => {
    expect(validateConnectorConfig('telegram', {botToken: '123:AA', chatId: '-100'}))
        .toEqual([]);
  });

  it('names every missing required field, as sentences', () => {
    expect(validateConnectorConfig('telegram', {}))
        .toEqual(['Bot token is required', 'Chat ID is required']);
  });

  // Whitespace is not a value: a pasted token with only spaces would pass a
  // truthiness check and fail at send time with a worse message.
  it('treats a blank-space value as missing', () => {
    expect(validateConnectorConfig('slack', {webhookUrl: '   '}))
        .toEqual(['Webhook URL is required']);
  });

  it('requires the port to be numeric for smtp', () => {
    const problems = validateConnectorConfig('smtp', {
      host: 'smtp.example.com',
      port: 'not-a-number',
      from: 'a@example.com',
      to: 'b@example.com',
    });
    expect(problems).toEqual(['Port must be a number']);
  });

  // 'custom' is the one AI kind with no preset endpoint to fall back to, so
  // the endpoint is required there and optional everywhere else. The
  // "(optional)" suffix must not leak into the problem sentence either.
  it('requires an endpoint only for the custom kind', () => {
    expect(validateConnectorConfig('custom', {model: 'x'}))
        .toEqual(['Endpoint is required']);
    expect(validateConnectorConfig('lmstudio', {model: 'x'})).toEqual([]);
  });

  // A kind this build has never heard of validates clean: refusing to keep a
  // row a newer build wrote would break the workspace on version skew.
  it('has no opinion about an unrecognised kind', () => {
    expect(validateConnectorConfig('carrier-pigeon', {})).toEqual([]);
  });
});

describe('runtimeConnector', () => {
  it('resolves an AI connector against its preset', () => {
    const resolved = runtimeConnector(connector({
      config: {model: 'gpt-4.1-mini', api_key: 'sk-test'},
      is_default: true,
    }));
    expect(resolved.adapter).toBe('openai');
    expect(resolved.base_url).toBe('https://api.openai.com/v1');
    expect(resolved.model).toBe('gpt-4.1-mini');
    expect(resolved.api_key).toBe('sk-test');
    expect(resolved.is_default).toBe(true);
  });

  // The row's own endpoint wins over the preset's: someone who typed one meant
  // it -- a self-hosted gateway or regional endpoint is the field's purpose.
  it('prefers the stored base_url over the preset endpoint', () => {
    const resolved = runtimeConnector(connector({
      config: {model: 'x', base_url: 'https://gateway.internal/v1'},
    }));
    expect(resolved.base_url).toBe('https://gateway.internal/v1');
  });

  it('picks the anthropic adapter for the one provider that needs it', () => {
    expect(runtimeConnector(connector({kind: 'anthropic', config: {model: 'claude-sonnet-5'}}))
        .adapter).toBe('anthropic');
  });

  // An unrecognised AI kind still resolves through its own base_url: a row
  // written by a newer build names a real service, and refusing to run it
  // would break the workspace on version skew.
  it('resolves an unknown AI kind through its own endpoint', () => {
    const resolved = runtimeConnector(connector({
      kind: 'future-vendor',
      config: {model: 'm', base_url: 'https://api.future.example/v1'},
    }));
    expect(resolved.adapter).toBe('openai');
    expect(resolved.base_url).toBe('https://api.future.example/v1');
  });

  // Message connectors pass their config through untouched -- there is no
  // preset resolution for them, and no AI fields to invent.
  it('passes a message connector through without AI resolution', () => {
    const resolved = runtimeConnector(connector({
      category: 'message',
      kind: 'telegram',
      config: {botToken: '123:AA', chatId: '-100'},
    }));
    expect(resolved.adapter).toBeUndefined();
    expect(resolved.base_url).toBeUndefined();
    expect(resolved.config).toEqual({botToken: '123:AA', chatId: '-100'});
  });
});

describe('secretKeysFor', () => {
  it('marks exactly the credential fields', () => {
    expect(secretKeysFor('openai')).toEqual(['api_key']);
    expect(secretKeysFor('telegram')).toEqual(['botToken']);
    expect(secretKeysFor('slack')).toEqual(['webhookUrl']);
    expect(secretKeysFor('whatsapp')).toEqual(['accessToken']);
    expect(secretKeysFor('smtp')).toEqual(['password']);
  });

  // The local runtimes authenticate nobody, so there is nothing to mask.
  it('has no secrets for a keyless local runtime', () => {
    expect(secretKeysFor('ollama')).toEqual([]);
  });

  it('has no secrets for an unrecognised kind', () => {
    expect(secretKeysFor('carrier-pigeon')).toEqual([]);
  });
});
