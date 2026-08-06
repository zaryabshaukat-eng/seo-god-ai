import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_TIMEOUT_MS, createApiClient } from './client.js';
import { WebAuthError, WebError, WebNetworkError, WebNotFoundError, WebValidationError } from '../errors.js';

interface CapturedRequest {
  url: string;
  init?: RequestInit;
}

function makeFetcher(queue: Array<{ body?: unknown; status?: number; raw?: string }>) {
  const requests: CapturedRequest[] = [];
  const fetchImpl = async (url: Request | URL | string, init?: RequestInit): Promise<Response> => {
    requests.push({ url: String(url), init });
    const entry = queue.shift() ?? {};
    const status = entry.status ?? 200;
    const noBody = status === 204;
    if (entry.raw !== undefined) {
      return new Response(noBody ? null : entry.raw, { status });
    }
    return new Response(noBody ? null : JSON.stringify(entry.body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  return { fetchImpl, requests };
}

describe('createApiClient', () => {
  it('sends the request with method, path, JSON body and content headers', async () => {
    const { fetchImpl, requests } = makeFetcher([{ body: { ok: true } }]);
    const api = createApiClient({ baseUrl: 'https://api.example.com', fetchImpl });
    const result = await api.post('/v1/crawls', { storeId: 's1' });
    expect(result).toEqual({ ok: true });
    expect(requests[0]?.url).toBe('https://api.example.com/v1/crawls');
    expect(requests[0]?.init?.method).toBe('POST');
    expect(requests[0]?.init?.headers).toMatchObject({ 'Content-Type': 'application/json', Accept: 'application/json' });
    expect(JSON.parse(String(requests[0]?.init?.body))).toEqual({ storeId: 's1' });
  });

  it('adds the bearer token from the token provider', async () => {
    const { fetchImpl, requests } = makeFetcher([{ body: {} }]);
    const api = createApiClient({ baseUrl: 'http://x', fetchImpl, getToken: () => 'tok-123' });
    await api.get('/v1/auth/me');
    expect(requests[0]?.init?.headers).toMatchObject({ Authorization: 'Bearer tok-123' });
  });

  it('merges default headers', async () => {
    const { fetchImpl, requests } = makeFetcher([{ body: {} }]);
    const api = createApiClient({ baseUrl: 'http://x', fetchImpl, defaultHeaders: { 'X-Client': 'web' } });
    await api.get('/ping');
    expect(requests[0]?.init?.headers).toMatchObject({ 'X-Client': 'web' });
  });

  it('returns undefined for 204 responses', async () => {
    const { fetchImpl } = makeFetcher([{ status: 204, raw: '' }]);
    const api = createApiClient({ baseUrl: 'http://x', fetchImpl });
    await expect(api.del('/v1/keys/1')).resolves.toBeUndefined();
  });

  it('returns undefined for empty bodies', async () => {
    const { fetchImpl } = makeFetcher([{ status: 200, raw: '' }]);
    const api = createApiClient({ baseUrl: 'http://x', fetchImpl });
    await expect(api.get('/empty')).resolves.toBeUndefined();
  });

  it('returns raw text when json is disabled', async () => {
    const { fetchImpl } = makeFetcher([{ raw: 'plain text' }]);
    const api = createApiClient({ baseUrl: 'http://x', fetchImpl });
    await expect(api.get('/raw', { json: false })).resolves.toBe('plain text');
  });

  it('maps a 401 to WebAuthError and notifies onAuthError', async () => {
    const { fetchImpl } = makeFetcher([{ status: 401, body: { message: 'expired' } }]);
    const onAuthError = vi.fn();
    const api = createApiClient({ baseUrl: 'http://x', fetchImpl, onAuthError });
    await expect(api.get('/protected')).rejects.toBeInstanceOf(WebAuthError);
    expect(onAuthError).toHaveBeenCalledOnce();
  });

  it('maps 404 and 422 statuses to specific errors', async () => {
    const { fetchImpl } = makeFetcher([{ status: 404, body: {} }, { status: 422, body: { message: 'bad' } }]);
    const api = createApiClient({ baseUrl: 'http://x', fetchImpl });
    await expect(api.get('/missing')).rejects.toBeInstanceOf(WebNotFoundError);
    await expect(api.post('/create', {})).rejects.toBeInstanceOf(WebValidationError);
  });

  it('handles non-JSON error bodies', async () => {
    const { fetchImpl } = makeFetcher([{ status: 500, raw: '<html>oops</html>' }]);
    const api = createApiClient({ baseUrl: 'http://x', fetchImpl });
    const error = await api.get('/boom').catch((err: unknown) => err);
    expect(error).toBeInstanceOf(WebError);
    expect((error as Error).message).toContain('Request failed with status 500.');
  });

  it('throws a network error when the transport fails', async () => {
    const fetchImpl = async () => {
      throw new Error('ECONNREFUSED');
    };
    const api = createApiClient({ baseUrl: 'http://x', fetchImpl });
    await expect(api.get('/down')).rejects.toBeInstanceOf(WebNetworkError);
  });

  it('times out when the response takes too long', async () => {
    vi.useFakeTimers();
    try {
      const fetchImpl = (_url: Request | URL | string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('Aborted')));
        });
      const api = createApiClient({ baseUrl: 'http://x', fetchImpl, timeoutMs: 50 });
      const assertion = api.get('/slow').then(
        () => undefined,
        (err: unknown) => err,
      );
      await vi.advanceTimersByTimeAsync(50);
      const error = await assertion;
      expect(error).toBeInstanceOf(WebNetworkError);
      expect((error as Error).message).toContain('timed out');
    } finally {
      vi.useRealTimers();
    }
  });

  it('respects an external abort signal', async () => {
    const { fetchImpl } = makeFetcher([{ body: {} }]);
    const api = createApiClient({ baseUrl: 'http://x', fetchImpl });
    const controller = new AbortController();
    const result = await api.get('/ok', { signal: controller.signal });
    expect(result).toEqual({});
  });

  it('throws a network error on invalid JSON responses', async () => {
    const { fetchImpl } = makeFetcher([{ raw: 'not-json', status: 200 }]);
    const api = createApiClient({ baseUrl: 'http://x', fetchImpl });
    const error = await api.get('/bad-json').catch((err: unknown) => err);
    expect(error).toBeInstanceOf(WebNetworkError);
  });

  it('uses the global fetch when no fetchImpl is provided', async () => {
    const previous = globalThis.fetch;
    const original = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    globalThis.fetch = original as typeof fetch;
    try {
      const api = createApiClient({ baseUrl: 'http://x' });
      await expect(api.get('/ping')).resolves.toEqual({ ok: true });
      expect(original).toHaveBeenCalledOnce();
    } finally {
      globalThis.fetch = previous;
    }
  });

  it('maps a non-JSON empty error body to WebError', async () => {
    const fetchImpl = async () => new Response(null, { status: 500 });
    const api = createApiClient({ baseUrl: 'http://x', fetchImpl });
    const error = await api.get('/boom').catch((err: unknown) => err);
    expect(error).toBeInstanceOf(WebError);
    expect((error as Error).message).toContain('500');
  });

  it('exposes a default timeout constant', () => {
    expect(DEFAULT_TIMEOUT_MS).toBeGreaterThan(0);
  });

  it('supports PUT and PATCH requests', async () => {
    const { fetchImpl, requests } = makeFetcher([{ body: {} }, { body: {} }]);
    const api = createApiClient({ baseUrl: 'http://x', fetchImpl });
    await api.put('/v1/crawls/1', { name: 'x' });
    await api.patch('/v1/crawls/1', { name: 'y' });
    expect(requests[0]?.init?.method).toBe('PUT');
    expect(JSON.parse(String(requests[0]?.init?.body))).toEqual({ name: 'x' });
    expect(requests[1]?.init?.method).toBe('PATCH');
    expect(JSON.parse(String(requests[1]?.init?.body))).toEqual({ name: 'y' });
  });
});
