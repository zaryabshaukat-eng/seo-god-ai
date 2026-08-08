/**
 * Tests for OpenAPI document generation and the SDK generator: schema shape,
 * operation id derivation, path parameter templating and the discovery
 * endpoints served over HTTP.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { Router } from './router.js';
import { buildOpenApi, operationIdOf, type OpenApiDocument } from './openapi.js';
import { generateSdkSource, type ApiRequestError } from './sdk.js';
import { boot, api, register, stopQuietly, type Harness } from '../test/harness.js';

function sampleRouter(): Router {
  const router = new Router();
  router.on('GET', '/api/v1/crawls', async () => {});
  router.on('POST', '/api/v1/crawls', async () => {});
  router.on('GET', '/api/v1/crawls/:id', async () => {});
  router.on('POST', '/api/v1/crawls/:id/cancel', async () => {});
  router.on('PATCH', '/api/v1/seo/recommendations/:id', async () => {});
  router.on('PATCH', '/api/v1/settings/profile', async () => {});
  router.on('DELETE', '/api/v1/admin/webhooks/:id', async () => {});
  return router;
}

describe('buildOpenApi', () => {
  it('renders a valid 3.0.3 document with templated paths', () => {
    const document = buildOpenApi(sampleRouter(), { version: '1.2.3', baseUrl: 'https://api.example.test/v1' });
    expect(document.openapi).toBe('3.0.3');
    expect(document.info.version).toBe('1.2.3');
    expect(document.servers).toEqual([{ url: 'https://api.example.test/v1' }]);
    expect(document.components.securitySchemes.bearerAuth).toMatchObject({ type: 'http', scheme: 'bearer' });

    expect(document.paths['/api/v1/crawls/{id}']).toBeDefined();
    const cancel = document.paths['/api/v1/crawls/{id}/cancel']?.['post'] as Record<string, unknown>;
    expect(cancel).toBeDefined();
    expect((cancel['operationId'] as string).length).toBeGreaterThan(0);
    expect((cancel['parameters'] as unknown[]).some((p) => (p as { in: string }).in === 'path')).toBe(true);
    expect((cancel['security'] as unknown[])).toEqual([{ bearerAuth: [] }]);

    const webhookDelete = document.paths['/api/v1/admin/webhooks/{id}']?.['delete'] as Record<string, unknown>;
    expect((webhookDelete['responses'] as Record<string, unknown>)['204']).toBeDefined();

    const recommendationsPatch = document.paths['/api/v1/seo/recommendations/{id}']?.['patch'] as Record<string, unknown>;
    expect(recommendationsPatch['parameters']).toHaveLength(1);

    const profilePatch = document.paths['/api/v1/settings/profile']?.['patch'] as Record<string, unknown>;
    expect(profilePatch['requestBody']).toBeDefined();
  });

  it('marks anonymous operations with empty security and provides error responses', () => {
    const router = new Router();
    router.on('POST', '/api/v1/auth/login', async () => {});
    router.on('GET', '/api/v1/sdk.ts', async () => {});
    const document = buildOpenApi(router);
    const login = document.paths['/api/v1/auth/login']?.['post'] as Record<string, unknown>;
    expect((login['security'] as unknown[])).toEqual([]);
    const responses = login['responses'] as Record<string, unknown>;
    expect(responses['400']).toBeDefined();
    expect(responses['401']).toBeDefined();
    expect(responses['429']).toBeDefined();
  });

  it('merges curated response schemas into the generated document', () => {
    const router = new Router();
    router.on('GET', '/api/v1/auth/me', async () => {});
    const document = buildOpenApi(router);
    const me = document.paths['/api/v1/auth/me']?.['get'] as Record<string, unknown>;
    const responses = me['responses'] as Record<string, unknown>;
    const ok = responses['200'] as Record<string, unknown>;
    expect(ok['content']).toMatchObject({ 'application/json': { schema: expect.any(Object) } });
    expect(responses['400']).toBeDefined();
  });

  it('derives a Root operation for routes without literal segments', () => {
    const router = new Router();
    router.on('GET', '/', async () => {});
    router.on('GET', '/api/v1//x', async () => {});
    const document = buildOpenApi(router);
    const root = document.paths['/']?.['get'] as Record<string, unknown>;
    expect(root['operationId']).toBe('listRoot');
    expect(root['tags']).toEqual(['Auth']);
    const odd = document.paths['/api/v1//x']?.['get'] as Record<string, unknown>;
    expect(odd['operationId']).toEqual(expect.any(String));
  });
});

describe('operationIdOf', () => {
  it('prefers curated ids', () => {
    expect(operationIdOf('POST', '/api/v1/auth/login')).toBe('login');
    expect(operationIdOf('POST', '/api/v1/crawls/:id/cancel')).toBe('cancelCrawl');
    expect(operationIdOf('GET', '/api/v1/dashboard/overview')).toBe('dashboardOverview');
  });

  it('derives fallback ids by verb', () => {
    expect(operationIdOf('POST', '/api/v1/foo/bar')).toBe('createFooBar');
    expect(operationIdOf('GET', '/api/v1/foo/:id')).toBe('getFoo');
    expect(operationIdOf('GET', '/api/v1/foo')).toBe('listFoo');
    expect(operationIdOf('DELETE', '/api/v1/foo/:id')).toBe('deleteFoo');
    expect(operationIdOf('PATCH', '/api/v1/foo/:id')).toBe('updateFoo');
    expect(operationIdOf('POST', '/api/v1/foo/:id/read')).toBe('readFoo');
  });
});

describe('openapi + sdk endpoints', () => {
  let h: Harness;

  afterEach(async () => {
    await stopQuietly(h);
  });

  it('serves the OpenAPI document anonymously', async () => {
    h = await boot();
    const result = await api(h, '/api/v1/openapi.json');
    expect(result.status).toBe(200);
    const document = result.body as OpenApiDocument;
    expect(document.openapi).toBe('3.0.3');
    expect(document.paths['/api/v1/crawls']).toBeDefined();
    expect(document.paths['/api/v1/copilot/chat']?.['post']).toBeDefined();
  });

  it('serves the generated SDK source anonymously', async () => {
    h = await boot();
    const result = await api(h, '/api/v1/sdk.ts', { raw: true });
    expect(result.status).toBe(200);
    expect(result.headers.get('content-type')).toContain('text/typescript');
    expect(result.text).toContain('export class SeoGodSdk');
  });

  it('generates SDK source with methods, path params and camelCased names', async () => {
    const source = generateSdkSource(sampleRouter());
    expect(source).toContain('export class SeoGodSdk');
    expect(source).toContain('export class ApiClient');
    expect(source).toContain('getCrawl(path: Record<string, string | number>');
    expect(source).toMatch(/cancelCrawl\(path: Record<string, string \| number>/);
    expect(source).toContain("'/crawls'");
    expect(source).toContain("client.request('DELETE', '/admin/webhooks/:id'");
  });

  it('disambiguates duplicate operation ids with a numeric suffix', () => {
    const router = new Router();
    router.on('GET', '/api/v1/custom', async () => {});
    router.on('GET', '/api/v1/custom', async () => {});
    const source = generateSdkSource(router);
    expect(source).toContain('listCustom_2(');
  });
});

describe('api client', () => {
  let h: Harness;

  afterEach(async () => {
    await stopQuietly(h);
  });

  it('runs JSON requests against a live server with bearer auth', async () => {
    h = await boot();
    const { token } = await register(h, { email: 'sdk@example.com' });
    const { ApiClient, ApiRequestError } = await import('./sdk.js');

    const client = new ApiClient({ baseUrl: h.baseUrl, token });
    const overview = await client.request<{ overview: unknown }>('GET', '/api/v1/dashboard/overview');
    expect(overview.overview).toBeDefined();

    const error = await client.request('GET', '/api/v1/does-not-exist').catch((caught) => caught) as ApiRequestError;
    expect(error).toBeInstanceOf(ApiRequestError);
    expect(error.status).toBe(404);
    expect(error.code).toBe('not_found');
    expect(error.message).toEqual(expect.any(String));
  });

  it('substitutes path params and drops undefined query values', async () => {
    h = await boot();
    const { token } = await register(h, { email: 'sdk2@example.com' });
    const { ApiClient } = await import('./sdk.js');
    const client = new ApiClient({ baseUrl: h.baseUrl, token });

    const missing = (await client.request('GET', '/api/v1/crawls/:id', { path: { id: 'nope' } }).catch((caught) => caught)) as ApiRequestError;
    expect(missing.status).toBe(404);

    const reports = await client.request('GET', '/api/v1/reports', { query: { limit: undefined } });
    expect(reports).toEqual({ reports: [] });
  });

  it('returns undefined on 204 and supports token functions', async () => {
    h = await boot();
    const { token } = await register(h, { email: 'sdk3@example.com' });
    const { ApiClient } = await import('./sdk.js');
    const client = new ApiClient({ baseUrl: h.baseUrl, token: () => token });
    const loggedOut = await client.request('POST', '/api/v1/auth/logout');
    expect(loggedOut).toBeUndefined();
  });

  it('sends bodies, query strings and relative paths', async () => {
    h = await boot();
    const { token } = await register(h, { email: 'sdk4@example.com' });
    const { ApiClient } = await import('./sdk.js');
    const client = new ApiClient({ baseUrl: h.baseUrl, token });
    const created = await client.request('POST', 'api/v1/reports', {
      body: { kind: 'seo', days: 7 },
      query: { limit: 3 },
    });
    expect((created as { report: { kind: string } }).report.kind).toBe('seo');
    const fetched = await client.request('GET', 'api/v1/reports?limit=1', { query: { days: 2 } });
    expect((fetched as { reports: unknown[] }).reports).toHaveLength(1);
  });

  it('maps invalid JSON responses and non-envelope errors', async () => {
    h = await boot({
      server: {
        routes: (router) => {
          router.on('GET', '/raw', async (ctx) => {
            ctx.res.writeHead(200, { 'content-type': 'text/plain' });
            ctx.res.end('this is not json');
          });
          router.on('GET', '/blank-500', async (ctx) => {
            ctx.res.writeHead(500, { 'content-type': 'application/json' });
            ctx.res.end('{}');
          });
        },
      },
    });
    const { ApiClient, ApiRequestError } = await import('./sdk.js');
    const client = new ApiClient({ baseUrl: h.baseUrl });

    const invalid = await client.request('GET', '/raw').catch((caught) => caught) as ApiRequestError;
    expect(invalid).toBeInstanceOf(ApiRequestError);
    expect(invalid.code).toBe('invalid_response');
    expect(invalid.body).toBe('this is not json');

    const blank = await client.request('GET', '/blank-500').catch((caught) => caught) as ApiRequestError;
    expect(blank.status).toBe(500);
    expect(blank.code).toBe('request_failed');
    expect(blank.message).toContain('500');
  });
});
