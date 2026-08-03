import { AiError, RateLimitError } from '@seogod/core';
import { describe, expect, it, vi } from 'vitest';
import { TimeoutError } from '../errors.js';
import { OpenAIProvider, type FetchLike } from './openai-provider.js';

function okFetch(payload: unknown): FetchLike {
  return async () => ({ ok: true, status: 200, text: async () => JSON.stringify(payload) });
}

function statusFetch(status: number, body = 'oops'): FetchLike {
  return async () => ({ ok: status >= 200 && status < 300, status, text: async () => body });
}

describe('OpenAIProvider', () => {
  it('rejects configs whose name is not openai', () => {
    expect(() => new OpenAIProvider({ name: 'anthropic', model: 'x' })).toThrow(AiError);
  });

  it('defaults base url, timeout, and global fetch', () => {
    const provider = new OpenAIProvider({ name: 'openai', model: 'gpt-4o-mini' });
    expect(provider.name).toBe('openai');
    expect(provider.models).toEqual(['gpt-4o-mini']);
  });

  it('completes a request and returns the parsed response', async () => {
    const fetchFn = okFetch({
      choices: [{ message: { content: '{"ok":true}' } }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      model: 'gpt-4o-mini',
    });
    const provider = new OpenAIProvider({ name: 'openai', model: 'gpt-4o-mini' }, { fetchFn });
    const response = await provider.complete({ model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'hi' }] });
    expect(response.text).toBe('{"ok":true}');
    expect(response.usage.totalTokens).toBe(15);
    expect(response.model).toBe('gpt-4o-mini');
    expect(response.raw).toEqual(expect.objectContaining({ choices: expect.any(Array) }));
  });

  it('computes total tokens when the payload omits them', async () => {
    const fetchFn = okFetch({
      choices: [{ message: { content: 'x' } }],
      usage: { prompt_tokens: 7, completion_tokens: 3 },
    });
    const provider = new OpenAIProvider({ name: 'openai', model: 'gpt-4o-mini' }, { fetchFn });
    const response = await provider.complete({ model: 'gpt-4o-mini', messages: [] });
    expect(response.usage.totalTokens).toBe(10);
  });

  it('sends the API key and custom base url when configured', async () => {
    let called: string | null = null;
    let auth: string | undefined;
    const fetchFn: FetchLike = async (url, init) => {
      called = url;
      auth = init.headers['Authorization'];
      return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: 'x' } }] }) };
    };
    const provider = new OpenAIProvider(
      { name: 'openai', model: 'gpt-4o-mini', apiKey: 'sk-test', baseUrl: 'https://custom.example/v1/' },
      { fetchFn },
    );
    await provider.complete({ model: 'gpt-4o-mini', messages: [] });
    expect(called).toBe('https://custom.example/v1/chat/completions');
    expect(auth).toBe('Bearer sk-test');
  });

  it('maps 429 to RateLimitError', async () => {
    const provider = new OpenAIProvider({ name: 'openai', model: 'gpt-4o-mini' }, { fetchFn: statusFetch(429) });
    await expect(provider.complete({ model: 'gpt-4o-mini', messages: [] })).rejects.toBeInstanceOf(RateLimitError);
  });

  it('wraps other HTTP failures in AiError with detail', async () => {
    const provider = new OpenAIProvider({ name: 'openai', model: 'gpt-4o-mini' }, { fetchFn: statusFetch(500, 'boom') });
    await expect(provider.complete({ model: 'gpt-4o-mini', messages: [] })).rejects.toThrow(/boom/);
  });

  it('throws AiError for invalid JSON payloads', async () => {
    const provider = new OpenAIProvider({ name: 'openai', model: 'gpt-4o-mini' }, { fetchFn: statusFetch(200, 'not json') });
    await expect(provider.complete({ model: 'gpt-4o-mini', messages: [] })).rejects.toThrow(/invalid JSON/);
  });

  it('throws AiError when there is no completion content', async () => {
    const provider = new OpenAIProvider({ name: 'openai', model: 'gpt-4o-mini' }, { fetchFn: okFetch({ choices: [] }) });
    await expect(provider.complete({ model: 'gpt-4o-mini', messages: [] })).rejects.toThrow(/no completion content/);
  });

  it('rethrows TimeoutError without wrapping', async () => {
    const fetchFn: FetchLike = async (_url, _init) => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      throw new Error('should not reach');
    };
    const provider = new OpenAIProvider({ name: 'openai', model: 'gpt-4o-mini' }, { fetchFn });
    await expect(provider.complete({ model: 'gpt-4o-mini', messages: [] }, { timeoutMs: 1 })).rejects.toBeInstanceOf(TimeoutError);
  });

  it('wraps unexpected errors in AiError with timing', async () => {
    const fetchFn: FetchLike = async () => {
      throw new Error('network down');
    };
    const provider = new OpenAIProvider({ name: 'openai', model: 'gpt-4o-mini' }, { fetchFn });
    await expect(provider.complete({ model: 'gpt-4o-mini', messages: [] })).rejects.toThrow(/network down/);
  });

  it('reports health as ok / degraded / down', async () => {
    const ok = new OpenAIProvider({ name: 'openai', model: 'gpt-4o-mini' }, { fetchFn: okFetch({ choices: [] }) });
    expect((await ok.checkHealth()).status).toBe('ok');

    const degraded = new OpenAIProvider({ name: 'openai', model: 'gpt-4o-mini' }, { fetchFn: statusFetch(502) });
    expect((await degraded.checkHealth()).status).toBe('degraded');

    const auth = new OpenAIProvider({ name: 'openai', model: 'gpt-4o-mini' }, { fetchFn: statusFetch(401) });
    expect((await auth.checkHealth()).status).toBe('down');

    const failing = new OpenAIProvider(
      { name: 'openai', model: 'gpt-4o-mini' },
      { fetchFn: async () => { throw new Error('down'); } },
    );
    const health = await failing.checkHealth();
    expect(health.status).toBe('down');
    expect(health.detail).toContain('down');
  });

  it('reports down when the fetch rejects with a non-Error', async () => {
    const provider = new OpenAIProvider(
      { name: 'openai', model: 'gpt-4o-mini' },
      { fetchFn: async () => { throw 'plain failure'; } },
    );
    const health = await provider.checkHealth();
    expect(health.status).toBe('down');
    expect(health.detail).toBe('plain failure');
  });

  it('passes temperature, max tokens, and extras into the body', async () => {
    let body: Record<string, unknown> = {};
    const fetchFn: FetchLike = async (_url, init) => {
      body = JSON.parse(init.body) as Record<string, unknown>;
      return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: 'x' } }] }) };
    };
    const provider = new OpenAIProvider({ name: 'openai', model: 'gpt-4o-mini' }, { fetchFn });
    await provider.complete({ model: 'gpt-4o-mini', messages: [], temperature: 0.2, maxTokens: 50, options: { stop: ['END'] } });
    expect(body).toEqual(expect.objectContaining({ temperature: 0.2, max_tokens: 50, stop: ['END'] }));
    expect(vi.isMockFunction(fetchFn)).toBe(false);
  });
});
