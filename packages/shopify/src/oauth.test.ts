import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ShopifyAuthError, ShopifyValidationError } from './errors.js';
import {
  buildAuthorizationUrl,
  exchangeAccessToken,
  isValidShopDomain,
  validateHmac,
} from './oauth.js';

describe('isValidShopDomain', () => {
  it('accepts valid Shopify shop subdomains', () => {
    expect(isValidShopDomain('my-store.myshopify.com')).toBe(true);
    expect(isValidShopDomain('abc.myshopify.com')).toBe(true);
  });

  it('rejects invalid shop domains', () => {
    expect(isValidShopDomain('')).toBe(false);
    expect(isValidShopDomain('https://evil.com')).toBe(false);
    expect(isValidShopDomain('my-store.myshopify.com.evil.com')).toBe(false);
    expect(isValidShopDomain('ab.myshopify.com')).toBe(false);
    expect(isValidShopDomain('my_store.myshopify.com')).toBe(false);
    expect(isValidShopDomain('myshopify.com')).toBe(false);
  });
});

describe('buildAuthorizationUrl', () => {
  const options = {
    clientId: 'client-id',
    scopes: ['read_products', 'write_content'],
    redirectUri: 'https://app.example.com/callback',
    shopDomain: 'store.myshopify.com',
    state: 'csrf-state',
  };

  it('builds a valid authorize URL', () => {
    const url = new URL(buildAuthorizationUrl(options));
    expect(`${url.origin}${url.pathname}`).toBe(
      'https://store.myshopify.com/admin/oauth/authorize',
    );
    expect(url.searchParams.get('client_id')).toBe('client-id');
    expect(url.searchParams.get('scope')).toBe('read_products,write_content');
    expect(url.searchParams.get('redirect_uri')).toBe('https://app.example.com/callback');
    expect(url.searchParams.get('state')).toBe('csrf-state');
    expect(url.searchParams.get('grant_options[]')).toBeNull();
  });

  it('adds grant_options[] for online tokens', () => {
    const url = new URL(buildAuthorizationUrl({ ...options, isOnline: true }));
    expect(url.searchParams.get('grant_options[]')).toBe('per-user');
  });

  it('rejects a spoofed shop domain', () => {
    expect(() =>
      buildAuthorizationUrl({ ...options, shopDomain: 'store.myshopify.com.evil.com' }),
    ).toThrow(ShopifyValidationError);
  });
});

describe('validateHmac', () => {
  const secret = 'hush-secret';

  function sign(params: URLSearchParams): string {
    const message = [...params.entries()]
      .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
      .sort()
      .join('&');
    return createHmac('sha256', secret).update(message).digest('hex');
  }

  it('accepts a correct HMAC', () => {
    const params = new URLSearchParams({
      shop: 'store.myshopify.com',
      code: 'abc',
      timestamp: '1720000000',
    });
    params.set('hmac', sign(params));
    expect(validateHmac(params, secret)).toBe(true);
  });

  it('rejects a tampered query', () => {
    const params = new URLSearchParams({
      shop: 'store.myshopify.com',
      code: 'abc',
      timestamp: '1720000000',
    });
    params.set('hmac', sign(params));
    params.set('code', 'tampered');
    expect(validateHmac(params, secret)).toBe(false);
  });

  it('rejects a wrong secret', () => {
    const params = new URLSearchParams({
      shop: 'store.myshopify.com',
      code: 'abc',
      timestamp: '1720000000',
    });
    params.set('hmac', sign(params));
    expect(validateHmac(params, 'other-secret')).toBe(false);
  });

  it('rejects a missing HMAC', () => {
    const params = new URLSearchParams({ shop: 'store.myshopify.com', code: 'abc' });
    expect(validateHmac(params, secret)).toBe(false);
  });
});

describe('exchangeAccessToken', () => {
  const options = {
    shopDomain: 'store.myshopify.com',
    code: 'temp-code',
    clientId: 'client-id',
    clientSecret: 'client-secret',
  };

  it('posts the expected body and parses the token', async () => {
    const fetchImpl: typeof fetch = async (input, init) => {
      expect(String(input)).toBe('https://store.myshopify.com/admin/oauth/access_token');
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      expect(body).toMatchObject({
        client_id: 'client-id',
        client_secret: 'client-secret',
        code: 'temp-code',
      });
      return new Response(JSON.stringify({ access_token: 'shpat_final', scope: 'read_products' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    const result = await exchangeAccessToken(options, fetchImpl);
    expect(result.accessToken).toBe('shpat_final');
    expect(result.scope).toBe('read_products');
    expect(result.expiresIn).toBeUndefined();
  });

  it('surfaces expiry for online tokens', async () => {
    const fetchImpl = async (): Promise<Response> =>
      new Response(
        JSON.stringify({ access_token: 'shpat_online', scope: 'read_products', expires_in: 86400 }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    const result = await exchangeAccessToken(options, fetchImpl);
    expect(result.expiresIn).toBe(86400);
  });

  it('throws ShopifyAuthError when Shopify rejects the exchange', async () => {
    const fetchImpl = async (): Promise<Response> =>
      new Response('{"error":"invalid_grant"}', { status: 400 });
    await expect(exchangeAccessToken(options, fetchImpl)).rejects.toBeInstanceOf(ShopifyAuthError);
  });

  it('throws when the response has no access token', async () => {
    const fetchImpl = async (): Promise<Response> =>
      new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
    await expect(exchangeAccessToken(options, fetchImpl)).rejects.toBeInstanceOf(ShopifyAuthError);
  });
});
