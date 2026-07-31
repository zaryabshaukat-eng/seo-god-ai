import { describe, expect, it } from 'vitest';
import {
  ShopifyApiError,
  ShopifyNetworkError,
  ShopifyRateLimitError,
  ShopifyValidationError,
} from './errors.js';
import { ShopifyGraphQLClient } from './graphql-client.js';
import type { GraphQLClientOptions } from './graphql-client.js';
import { RateThrottler } from './throttler.js';

const SHOP = 'store.myshopify.com';
const ENDPOINT = `https://${SHOP}/admin/api/2026-07/graphql.json`;

function jsonResponse(data: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

function client(options: Partial<GraphQLClientOptions> = {}): ShopifyGraphQLClient {
  return new ShopifyGraphQLClient({
    shopDomain: SHOP,
    accessToken: 'shpat_test',
    apiVersion: '2026-07',
    ...options,
  });
}

describe('ShopifyGraphQLClient', () => {
  it('requires a shop, token and API version', () => {
    expect(() => new ShopifyGraphQLClient({ shopDomain: '', accessToken: 'x', apiVersion: '2026-07' })).toThrow(
      ShopifyValidationError,
    );
    expect(() => new ShopifyGraphQLClient({ shopDomain: SHOP, accessToken: '', apiVersion: '2026-07' })).toThrow(
      ShopifyValidationError,
    );
  });

  it('sends an authenticated POST with the query payload', async () => {
    const captured: { input: string | null; init: RequestInit | null } = { input: null, init: null };
    const fetchImpl: typeof fetch = async (input, init) => {
      captured.input = String(input);
      captured.init = init ?? null;
      return jsonResponse({ data: { ok: true } }, { 'X-Shopify-Shop-Api-Call-Limit': '10/40' });
    };

    const result = await client({ fetchImpl }).request<{ ok: boolean }>({
      query: 'query Ping { ok }',
      variables: { a: 1 },
    });

    expect(captured.input).toBe(ENDPOINT);
    expect(captured.init?.method).toBe('POST');
    expect(captured.init?.headers).toMatchObject({ 'X-Shopify-Access-Token': 'shpat_test' });
    expect(JSON.parse(String(captured.init?.body))).toMatchObject({ query: 'query Ping { ok }', variables: { a: 1 } });
    expect(result.data).toEqual({ ok: true });
  });

  it('returns GraphQL errors without throwing when they are not THROTTLED', async () => {
    const fetchImpl = async () => jsonResponse({ errors: [{ message: 'Field not found' }] });
    const result = await client({ fetchImpl }).request<{ ok: boolean }>({ query: '{ nope }' });
    expect(result.data).toBeUndefined();
    expect(result.errors?.[0]?.message).toBe('Field not found');
  });

  it('retries on 429 and honors Retry-After', async () => {
    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      if (calls === 1) {
        return new Response('{}', { status: 429, headers: { 'Retry-After': '0' } });
      }
      return jsonResponse({ data: { ok: true } });
    };

    const result = await client({ fetchImpl, retryBackoffMs: 1, maxRetries: 3 }).request<{ ok: boolean }>({
      query: '{ ok }',
    });
    expect(calls).toBe(2);
    expect(result.data?.ok).toBe(true);
  });

  it('throws ShopifyRateLimitError when 429 persists', async () => {
    const fetchImpl = async () => new Response('{}', { status: 429, headers: { 'Retry-After': '0' } });
    await expect(
      client({ fetchImpl, retryBackoffMs: 1, maxRetries: 1 }).request({ query: '{ ok }' }),
    ).rejects.toBeInstanceOf(ShopifyRateLimitError);
  });

  it('retries on GraphQL THROTTLED errors', async () => {
    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      if (calls === 1) {
        return jsonResponse({
          errors: [{ message: 'Throttled', extensions: { code: 'THROTTLED' } }],
        });
      }
      return jsonResponse({ data: { ok: true } });
    };

    const result = await client({ fetchImpl, retryBackoffMs: 1, maxRetries: 3 }).request<{ ok: boolean }>({
      query: '{ ok }',
    });
    expect(calls).toBe(2);
    expect(result.data?.ok).toBe(true);
  });

  it('retries then throws ShopifyApiError on persistent 5xx', async () => {
    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      return new Response('boom', { status: 502 });
    };
    await expect(
      client({ fetchImpl, retryBackoffMs: 1, maxRetries: 2 }).request({ query: '{ ok }' }),
    ).rejects.toMatchObject({ status: 502 });
    expect(calls).toBe(3);
  });

  it('does not retry 4xx client errors', async () => {
    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      return new Response('bad query', { status: 400 });
    };
    await expect(
      client({ fetchImpl, retryBackoffMs: 1, maxRetries: 3 }).request({ query: '{ bad' }),
    ).rejects.toBeInstanceOf(ShopifyApiError);
    expect(calls).toBe(1);
  });

  it('throws ShopifyApiError when the response body is not JSON', async () => {
    const fetchImpl = async () => new Response('<html>gateway error</html>', { status: 200 });
    await expect(client({ fetchImpl }).request({ query: '{ ok }' })).rejects.toBeInstanceOf(
      ShopifyApiError,
    );
  });

  it('throws ShopifyNetworkError when the network fails', async () => {
    const fetchImpl = async () => {
      throw new Error('socket hang up');
    };
    await expect(client({ fetchImpl, retryBackoffMs: 1, maxRetries: 1 }).request({ query: '{ ok }' })).rejects.toBeInstanceOf(
      ShopifyNetworkError,
    );
  });

  it('throttles when the store bucket is exhausted', async () => {
    const throttler = new RateThrottler({ threshold: 0.85, bucketResetMs: 10 });
    throttler.update('40/40');
    const fetchImpl = async () =>
      jsonResponse({ data: {} }, { 'X-Shopify-Shop-Api-Call-Limit': '40/40' });

    const started = Date.now();
    await client({ fetchImpl, throttler }).request({ query: '{ ok }' });
    expect(Date.now() - started).toBeGreaterThanOrEqual(10);
  });
});
