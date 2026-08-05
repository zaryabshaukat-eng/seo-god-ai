import { describe, expect, it } from 'vitest';
import { MetricsRegistry } from '@seogod/monitoring';
import {
  GoogleApiError,
  GoogleAuthError,
  GoogleNetworkError,
  GoogleRateLimitError,
  GoogleValidationError,
} from './errors.js';
import { GoogleHttpClient, type GoogleHttpClientOptions } from './http-client.js';
import { GoogleMetrics } from './metrics.js';

function jsonResponse(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

type TestFetch = (input: Parameters<typeof fetch>[0], init?: RequestInit) => Promise<Response>;

function client(fetchImpl: TestFetch, options: Partial<GoogleHttpClientOptions> = {}): GoogleHttpClient {
  return new GoogleHttpClient({
    baseUrl: 'https://www.googleapis.com/webmasters/v3',
    fetchImpl: fetchImpl as typeof fetch,
    ...options,
  });
}

describe('GoogleHttpClient', () => {
  it('requires a baseUrl', () => {
    expect(() => new GoogleHttpClient({ baseUrl: '' })).toThrow(GoogleValidationError);
  });

  it('sends an authenticated GET with merged query params', async () => {
    let url = '';
    const captured: { init: RequestInit | null } = { init: null };
    const fetchImpl: TestFetch = async (input, requestInit) => {
      url = String(input);
      captured.init = requestInit ?? null;
      return jsonResponse({ ok: true });
    };

    const value = await client(fetchImpl).get('/sites', {
      accessToken: 'at-1',
      query: { a: '1', category: ['x', 'y'] },
    });

    expect(value).toEqual({ ok: true });
    expect(url).toBe('https://www.googleapis.com/webmasters/v3/sites?a=1&category=x&category=y');
    expect(captured.init?.method).toBe('GET');
    expect((captured.init?.headers as Record<string, string>).Authorization).toBe('Bearer at-1');
  });

  it('appends an api key and a JSON body for POST', async () => {
    let url = '';
    const captured: { init: RequestInit | null } = { init: null };
    const fetchImpl: TestFetch = async (input, requestInit) => {
      url = String(input);
      captured.init = requestInit ?? null;
      return jsonResponse({ value: 42 });
    };

    const value = await client(fetchImpl).post('/runPagespeed', {
      apiKey: 'key-1',
      json: { url: 'https://example.com' },
    });

    expect(value).toEqual({ value: 42 });
    expect(url).toBe('https://www.googleapis.com/webmasters/v3/runPagespeed?key=key-1');
    expect(captured.init?.method).toBe('POST');
    expect(JSON.parse(String(captured.init?.body))).toEqual({ url: 'https://example.com' });
  });

  it('supports PUT and normalizes a trailing-slash base URL', async () => {
    const fetchImpl = async () => new Response(null, { status: 204 });
    const http = new GoogleHttpClient({ baseUrl: 'https://www.googleapis.com/webmasters/v3/', fetchImpl });
    await expect(http.put('/sitemaps', {})).resolves.toBeNull();
  });

  it('retries on 429 honoring Retry-After', async () => {
    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      if (calls === 1) {
        return new Response('{}', { status: 429, headers: { 'Retry-After': '0' } });
      }
      return jsonResponse({ ok: true });
    };

    const value = await client(fetchImpl, { maxRetries: 3, retryBackoffMs: 1 }).get('/sites');
    expect(calls).toBe(2);
    expect(value).toEqual({ ok: true });
  });

  it('retries a 429 with no Retry-After header using backoff', async () => {
    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      return calls === 1 ? new Response('{}', { status: 429 }) : jsonResponse({ ok: true });
    };

    const value = await client(fetchImpl, { maxRetries: 2, retryBackoffMs: 1 }).get('/sites');
    expect(calls).toBe(2);
    expect(value).toEqual({ ok: true });
  });

  it('ignores an invalid Retry-After header', async () => {
    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      return calls === 1
        ? new Response('{}', { status: 429, headers: { 'Retry-After': 'abc' } })
        : jsonResponse({ ok: true });
    };

    const value = await client(fetchImpl, { maxRetries: 1, retryBackoffMs: 1 }).get('/sites');
    expect(calls).toBe(2);
    expect(value).toEqual({ ok: true });
  });

  it('defaults fetchImpl to the global fetch when not provided', () => {
    expect(() => new GoogleHttpClient({ baseUrl: 'https://api.example.com' })).not.toThrow();
  });

  it('throws GoogleRateLimitError when 429 persists', async () => {
    const fetchImpl = async () =>
      new Response('{}', { status: 429, headers: { 'Retry-After': '0' } });
    await expect(
      client(fetchImpl, { maxRetries: 1, retryBackoffMs: 1 }).get('/sites'),
    ).rejects.toBeInstanceOf(GoogleRateLimitError);
  });

  it('retries transient 5xx responses', async () => {
    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      return calls === 1 ? jsonResponse({}, 503) : jsonResponse({ ok: true });
    };
    const value = await client(fetchImpl, { maxRetries: 3, retryBackoffMs: 1 }).get('/sites');
    expect(calls).toBe(2);
    expect(value).toEqual({ ok: true });
  });

  it('throws a retryable GoogleApiError when 5xx persists', async () => {
    const fetchImpl = async () => jsonResponse({}, 500);
    const error = await client(fetchImpl, { maxRetries: 1, retryBackoffMs: 1 })
      .get('/sites')
      .catch((err: unknown) => err);
    expect(error).toBeInstanceOf(GoogleApiError);
    expect((error as GoogleApiError).retryable).toBe(true);
    expect((error as GoogleApiError).status).toBe(500);
  });

  it('throws GoogleAuthError on 401', async () => {
    const fetchImpl = async () => jsonResponse({ error: 'auth' }, 401);
    await expect(client(fetchImpl).get('/sites')).rejects.toBeInstanceOf(GoogleAuthError);
  });

  it('throws a non-retryable GoogleApiError on 403', async () => {
    const fetchImpl = async () => jsonResponse({ error: 'denied' }, 403);
    const error = await client(fetchImpl).get('/sites').catch((err: unknown) => err);
    expect(error).toBeInstanceOf(GoogleApiError);
    expect((error as GoogleApiError).retryable).toBe(false);
  });

  it('throws GoogleApiError when the response is not valid JSON', async () => {
    const fetchImpl = async () => new Response('not-json', { status: 200 });
    await expect(client(fetchImpl).get('/sites')).rejects.toBeInstanceOf(GoogleApiError);
  });

  it('throws GoogleNetworkError when fetch rejects', async () => {
    const fetchImpl = async () => {
      throw new TypeError('network down');
    };
    const error = await client(fetchImpl).get('/sites').catch((err: unknown) => err);
    expect(error).toBeInstanceOf(GoogleNetworkError);
    expect((error as GoogleNetworkError).retryable).toBe(true);
  });

  it('maps a request abort into a retryable timeout error', async () => {
    const fetchImpl = async (_input: unknown, init: RequestInit | undefined) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('Aborted', 'AbortError'));
        });
      });
    const error = await client(fetchImpl, { maxRetries: 0, timeoutMs: 10 })
      .get('/slow')
      .catch((err: unknown) => err);
    expect(error).toBeInstanceOf(GoogleApiError);
    expect((error as GoogleApiError).retryable).toBe(true);
  });

  it('increments request and failure counters', async () => {
    const registry = new MetricsRegistry();
    const metrics = new GoogleMetrics(registry);
    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      return calls === 1 ? jsonResponse({}, 500) : jsonResponse({ ok: true });
    };

    await client(fetchImpl, { maxRetries: 3, retryBackoffMs: 1, metrics }).get('/sites');
    await client(async () => jsonResponse({}, 500), { maxRetries: 0, metrics })
      .get('/boom')
      .catch(() => {});

    const snapshot = registry.snapshot();
    expect(snapshot.counters.google_api_requests).toBe(1);
    expect(snapshot.counters.google_api_request_failures).toBe(2);
  });
});
