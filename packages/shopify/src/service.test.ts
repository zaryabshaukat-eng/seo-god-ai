import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  ShopifyHmacError,
  ShopifyInvalidStateError,
  ShopifyTokenError,
  ShopifyValidationError,
} from './errors.js';
import { ShopifyService } from './service.js';
import type { ShopifyServiceOptions } from './service.js';
import { MemoryTokenStorage } from './token-storage.js';

const SHOP = 'store.myshopify.com';

const PRODUCT_NODE = {
  id: 'gid://shopify/Product/1',
  title: 'Product 1',
  handle: 'product-1',
  status: 'ACTIVE',
  tags: ['seo'],
  vendor: 'Vendor',
  productType: 'Type',
  descriptionHtml: '<p>Description</p>',
  updatedAt: '2026-01-01T00:00:00Z',
  seo: { title: 'SEO Title', description: 'SEO Description' },
};

function makeService(options: Partial<ShopifyServiceOptions> = {}): ShopifyService {
  return new ShopifyService({
    clientId: 'client-id',
    clientSecret: 'client-secret',
    tokenStorage: new MemoryTokenStorage(),
    fetchImpl: async () => new Response('{}', { status: 500 }),
    ...options,
  });
}

async function storeToken(accessToken = 'shpat_test'): Promise<MemoryTokenStorage> {
  const tokenStorage = new MemoryTokenStorage();
  await tokenStorage.save({
    shopDomain: SHOP,
    accessToken,
    scopes: ['read_products'],
    installedAt: '2026-01-01T00:00:00Z',
  });
  return tokenStorage;
}

function buildCallbackQuery(secret: string, overrides: Record<string, string> = {}): URLSearchParams {
  const params = new URLSearchParams({
    shop: SHOP,
    code: 'oauth-code-123',
    state: 'state-123',
    timestamp: '1720000000',
    ...overrides,
  });
  const message = [...params.entries()]
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .sort()
    .join('&');
  params.set('hmac', createHmac('sha256', secret).update(message).digest('hex'));
  return params;
}

function jsonResponse(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('ShopifyService OAuth', () => {
  it('builds an authorization URL using the configured redirect URI and default scopes', () => {
    const service = makeService({ redirectUri: 'https://app.example.com/callback' });
    const url = service.buildAuthorizationUrl({ shopDomain: SHOP, state: 'csrf-1' });

    expect(url).toContain('https://store.myshopify.com/admin/oauth/authorize');
    expect(url).toContain(`redirect_uri=${encodeURIComponent('https://app.example.com/callback')}`);
    expect(url).toContain('state=csrf-1');
    expect(url).toContain('read_products');
    expect(url).toContain('write_themes');
  });

  it('throws when no redirect URI is configured', () => {
    const service = makeService();
    expect(() => service.buildAuthorizationUrl({ shopDomain: SHOP, state: 'csrf-1' })).toThrow(
      ShopifyValidationError,
    );
  });

  it('completes the OAuth callback, validates HMAC and persists the token', async () => {
    const fetchImpl = async () =>
      jsonResponse({ access_token: 'shpat_final', scope: 'read_products,write_products' });
    const service = makeService({ fetchImpl });

    const token = await service.handleOAuthCallback({
      query: buildCallbackQuery('client-secret'),
      expectedState: 'state-123',
    });

    expect(token.accessToken).toBe('shpat_final');
    expect(token.scopes).toEqual(['read_products', 'write_products']);
    const stored = await service.getStoredToken(SHOP);
    expect(stored?.accessToken).toBe('shpat_final');
  });

  it('rejects a callback with a bad HMAC', async () => {
    const service = makeService();
    await expect(
      service.handleOAuthCallback({ query: buildCallbackQuery('wrong-secret') }),
    ).rejects.toBeInstanceOf(ShopifyHmacError);
  });

  it('rejects a callback with a mismatched state', async () => {
    const service = makeService();
    await expect(
      service.handleOAuthCallback({ query: buildCallbackQuery('client-secret'), expectedState: 'other' }),
    ).rejects.toBeInstanceOf(ShopifyInvalidStateError);
  });

  it('rejects a callback for a spoofed shop domain', async () => {
    const service = makeService();
    await expect(
      service.handleOAuthCallback({ query: buildCallbackQuery('client-secret', { shop: 'evil.com' }) }),
    ).rejects.toBeInstanceOf(ShopifyValidationError);
  });

  it('disconnects a shop by removing its stored token', async () => {
    const tokenStorage = await storeToken();
    const service = makeService({ tokenStorage });
    await service.disconnect(SHOP);
    expect(await service.getStoredToken(SHOP)).toBeNull();
  });
});

describe('ShopifyService reads', () => {
  it('returns typed products from the GraphQL response', async () => {
    const fetchImpl = async () =>
      jsonResponse({
        data: {
          products: {
            pageInfo: { hasNextPage: false, endCursor: null },
            edges: [{ cursor: 'c1', node: PRODUCT_NODE }],
          },
        },
      });
    const service = makeService({ fetchImpl, tokenStorage: await storeToken() });

    const result = await service.getProducts(SHOP);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.title).toBe('Product 1');
    expect(result.items[0]?.id).toBe('gid://shopify/Product/1');
    expect(result.items[0]?.seo?.title).toBe('SEO Title');
  });

  it('requests the first page with a null cursor', async () => {
    let seenBody: string | null = null;
    const fetchImpl: typeof fetch = async (_input, init) => {
      seenBody = String(init?.body);
      return jsonResponse({
        data: { pages: { pageInfo: { hasNextPage: false, endCursor: null }, edges: [] } },
      });
    };
    const service = makeService({ fetchImpl, tokenStorage: await storeToken() });

    await service.getPages(SHOP, { first: 25 });
    const parsed = JSON.parse(seenBody ?? '{}') as Record<string, unknown>;
    expect((parsed.variables as Record<string, unknown>)).toMatchObject({ first: 25, after: null });
  });

  it('lists themes without pagination', async () => {
    const fetchImpl = async () =>
      jsonResponse({
        data: {
          themes: [{ id: 'gid://shopify/Theme/1', name: 'Dawn', role: 'main', updatedAt: '2026-01-01T00:00:00Z' }],
        },
      });
    const service = makeService({ fetchImpl, tokenStorage: await storeToken() });

    const themes = await service.getThemes(SHOP);
    expect(themes[0]?.name).toBe('Dawn');
    expect(themes[0]?.role).toBe('main');
  });

  it('throws ShopifyTokenError when the shop has no stored token', async () => {
    const service = makeService();
    await expect(service.getProducts(SHOP)).rejects.toBeInstanceOf(ShopifyTokenError);
  });

  it('throws ShopifyApiError-style ShopifyError on GraphQL errors', async () => {
    const fetchImpl = async () => jsonResponse({ errors: [{ message: 'You did something wrong' }] });
    const service = makeService({ fetchImpl, tokenStorage: await storeToken() });
    await expect(service.getProducts(SHOP)).rejects.toThrow(/You did something wrong/);
  });
});

describe('ShopifyService writes', () => {
  it('updates a product and returns the updated record', async () => {
    let seenBody: string | null = null;
    const fetchImpl: typeof fetch = async (_input, init) => {
      seenBody = String(init?.body);
      return jsonResponse({
        data: { productUpdate: { product: { ...PRODUCT_NODE, title: 'New Title' }, userErrors: [] } },
      });
    };
    const service = makeService({ fetchImpl, tokenStorage: await storeToken() });

    const updated = await service.updateProduct(SHOP, {
      id: 'gid://shopify/Product/1',
      title: 'New Title',
    });

    expect(seenBody).toContain('productUpdate');
    expect(seenBody).toContain('"title":"New Title"');
    expect(updated.title).toBe('New Title');
  });

  it('rejects product updates with user errors', async () => {
    const fetchImpl = async () =>
      jsonResponse({
        data: {
          productUpdate: {
            product: null,
            userErrors: [{ field: ['title'], message: 'Title is not unique' }],
          },
        },
      });
    const service = makeService({ fetchImpl, tokenStorage: await storeToken() });

    await expect(
      service.updateProduct(SHOP, { id: 'gid://shopify/Product/1', title: 'Duplicate' }),
    ).rejects.toThrow(/Title is not unique/);
  });

  it('upserts theme files', async () => {
    let seenBody: string | null = null;
    const fetchImpl: typeof fetch = async (_input, init) => {
      seenBody = String(init?.body);
      return jsonResponse({
        data: {
          themeFilesUpsert: {
            upsertedThemeFiles: [{ filename: 'templates/product.json' }],
            userErrors: [],
          },
        },
      });
    };
    const service = makeService({ fetchImpl, tokenStorage: await storeToken() });

    const filenames = await service.updateTheme(SHOP, 'gid://shopify/Theme/1', [
      { filename: 'templates/product.json', body: '{"sections":{}}' },
    ]);

    expect(seenBody).toContain('themeFilesUpsert');
    expect(filenames).toEqual(['templates/product.json']);
  });

  it('uploads an image from a URL', async () => {
    let seenBody: string | null = null;
    const fetchImpl: typeof fetch = async (_input, init) => {
      seenBody = String(init?.body);
      return jsonResponse({
        data: {
          fileCreate: {
            files: [
              { id: 'gid://shopify/File/1', alt: 'Alt text', image: { url: 'https://cdn.shopify.com/x.jpg' } },
            ],
            userErrors: [],
          },
        },
      });
    };
    const service = makeService({ fetchImpl, tokenStorage: await storeToken() });

    const image = await service.uploadImage(SHOP, {
      url: 'https://example.com/x.jpg',
      alt: 'Alt text',
      filename: 'x.jpg',
    });

    expect(seenBody).toContain('fileCreate');
    expect(JSON.parse(seenBody ?? '{}')).toMatchObject({
      variables: {
        files: [{ originalSource: 'https://example.com/x.jpg', alt: 'Alt text', filename: 'x.jpg', contentType: 'IMAGE' }],
      },
    });
    expect(image).toEqual({
      id: 'gid://shopify/File/1',
      alt: 'Alt text',
      url: 'https://cdn.shopify.com/x.jpg',
    });
  });

  it('requires an image URL', async () => {
    const service = makeService({ tokenStorage: await storeToken() });
    await expect(service.uploadImage(SHOP, { url: '' })).rejects.toBeInstanceOf(
      ShopifyValidationError,
    );
  });
});
