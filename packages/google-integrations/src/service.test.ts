import { describe, expect, it, vi } from 'vitest';
import type { EventBus } from '@seogod/events';
import { MetricsRegistry } from '@seogod/monitoring';
import { MemoryCredentialStorage } from './credentials.js';
import { GoogleApiError, GoogleAuthError, GoogleValidationError } from './errors.js';
import {
  GoogleIntegrationsService,
  type GoogleIntegrationsServiceOptions,
} from './service.js';
import type { StoredCredential } from './types.js';

const NOW = new Date('2026-08-05T12:00:00Z');

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(data === null ? null : JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function fetchFor(map: Record<string, unknown>, status = 200): typeof fetch {
  return async (input: Parameters<typeof fetch>[0]) => {
    const url = String(input);
    const key = Object.keys(map).find((candidate) => url.includes(candidate));
    if (!key) {
      throw new Error(`No route for ${url}`);
    }
    return jsonResponse(map[key], status);
  };
}

function credential(provider: StoredCredential['provider'], account = 'owner@example.com'): StoredCredential {
  return {
    provider,
    account,
    accessToken: 'at-1',
    refreshToken: 'rt-1',
    scope: 's1',
    expiresAt: NOW.getTime() + 3600_000,
    tokenType: 'Bearer',
    updatedAt: NOW.toISOString(),
  };
}

function seededStorage(providers: StoredCredential['provider'][] = ['search-console', 'analytics', 'indexing']) {
  const storage = new MemoryCredentialStorage();
  for (const provider of providers) {
    void storage.save(credential(provider));
  }
  return storage;
}

function makeService(
  overrides: Partial<GoogleIntegrationsServiceOptions> = {},
): GoogleIntegrationsService {
  return new GoogleIntegrationsService({
    clientId: 'client-1',
    clientSecret: 'secret-1',
    redirectUri: 'https://app.example.com/cb',
    fetchImpl: fetchFor({ '/sites': { siteEntry: [{ siteUrl: 'sc-domain:example.com', permissionLevel: 'siteFullUser' }] } }),
    credentialStorage: seededStorage(),
    now: () => NOW,
    ...overrides,
  });
}

describe('GoogleIntegrationsService', () => {
  it('requires clientId, clientSecret and redirectUri', () => {
    expect(
      () => new GoogleIntegrationsService({ clientId: '', clientSecret: 's', redirectUri: 'r' }),
    ).toThrow(GoogleValidationError);
    expect(
      () => new GoogleIntegrationsService({ clientId: 'c', clientSecret: '', redirectUri: 'r' }),
    ).toThrow(GoogleValidationError);
    expect(
      () => new GoogleIntegrationsService({ clientId: 'c', clientSecret: 's', redirectUri: '' }),
    ).toThrow(GoogleValidationError);
  });

  it('defaults fetchImpl, storage and metrics when not provided', () => {
    expect(
      () =>
        new GoogleIntegrationsService({
          clientId: 'c',
          clientSecret: 's',
          redirectUri: 'r',
        }),
    ).not.toThrow();
  });

  it('accepts an optional metrics registry', async () => {
    const service = makeService({ metrics: new MetricsRegistry() });
    const sites = await service.listSites('owner@example.com');
    expect(sites[0]?.siteUrl).toBe('sc-domain:example.com');
  });

  describe('buildAuthorizationUrl', () => {
    it('combines profile and provider scopes', () => {
      const url = new URL(
        makeService().buildAuthorizationUrl({ state: 'abc', provider: 'search-console' }),
      );
      const scopes = url.searchParams.get('scope')?.split(' ') ?? [];
      expect(scopes).toContain('openid');
      expect(scopes).toContain('https://www.googleapis.com/auth/webmasters.readonly');
      expect(scopes).not.toContain('https://www.googleapis.com/auth/indexing');
    });

    it('uses the union of all provider scopes when no provider is given', () => {
      const url = new URL(makeService().buildAuthorizationUrl({ state: 'abc' }));
      const scopes = url.searchParams.get('scope') ?? '';
      expect(scopes).toContain('https://www.googleapis.com/auth/analytics.readonly');
      expect(scopes).toContain('https://www.googleapis.com/auth/indexing');
    });

    it('lets explicit scopes override the defaults', () => {
      const url = new URL(makeService().buildAuthorizationUrl({ state: 'abc', scopes: ['x'] }));
      expect(url.searchParams.get('scope')).toBe('x');
    });
  });

  describe('handleOAuthCallback', () => {
    function oauthFetch(): typeof fetch {
      return fetchFor({
        'oauth2.googleapis.com/token': {
          access_token: 'at-1',
          refresh_token: 'rt-1',
          expires_in: 3600,
          scope: 'openid s1',
          token_type: 'Bearer',
        },
        'userinfo': {
          sub: 'sub-1',
          email: 'owner@example.com',
          email_verified: true,
          name: 'Owner',
        },
      });
    }

    it('exchanges the code, identifies the account and stores the credential', async () => {
      const storage = new MemoryCredentialStorage();
      const service = makeService({ fetchImpl: oauthFetch(), credentialStorage: storage });
      const stored = await service.handleOAuthCallback({
        provider: 'search-console',
        code: 'code-1',
        state: 'abc',
        expectedState: 'abc',
      });

      expect(stored.account).toBe('owner@example.com');
      expect(stored.accessToken).toBe('at-1');
      expect(stored.refreshToken).toBe('rt-1');
      expect(stored.expiresAt).toBe(NOW.getTime() + 3600_000);

      const persisted = await storage.get('search-console', 'owner@example.com');
      expect(persisted?.accessToken).toBe('at-1');
    });

    it('supports an explicit account override', async () => {
      const service = makeService({ fetchImpl: oauthFetch() });
      const stored = await service.handleOAuthCallback({
        provider: 'search-console',
        code: 'code-1',
        state: 'abc',
        account: 'team@example.com',
      });
      expect(stored.account).toBe('team@example.com');
    });

    it('rejects flows with an error param, missing code or a state mismatch', async () => {
      const service = makeService({ fetchImpl: oauthFetch() });
      await expect(
        service.handleOAuthCallback({ provider: 'search-console', code: 'c', state: 's', error: 'access_denied' }),
      ).rejects.toBeInstanceOf(GoogleAuthError);
      await expect(
        service.handleOAuthCallback({ provider: 'search-console', code: '', state: 's' }),
      ).rejects.toBeInstanceOf(GoogleValidationError);
      await expect(
        service.handleOAuthCallback({ provider: 'search-console', code: 'c', state: 'bad', expectedState: 'good' }),
      ).rejects.toBeInstanceOf(GoogleAuthError);
    });

    it('encrypts stored credentials at rest when a key is provided', async () => {
      const raw = new MemoryCredentialStorage();
      const service = makeService({
        fetchImpl: oauthFetch(),
        credentialStorage: raw,
        credentialEncryptionKey: 'b'.repeat(64),
      });
      await service.handleOAuthCallback({
        provider: 'search-console',
        code: 'code-1',
        state: 'abc',
      });
      const encrypted = await raw.get('search-console', 'owner@example.com');
      expect(encrypted?.accessToken).toContain('"ct"');
      const read = await service.getCredentials('search-console', 'owner@example.com');
      expect(read?.accessToken).toBe('at-1');
    });
  });

  describe('credentials', () => {
    it('returns stored credentials and null for unknown accounts', async () => {
      const service = makeService();
      expect((await service.getCredentials('search-console', 'owner@example.com'))?.accessToken).toBe('at-1');
      expect(await service.getCredentials('search-console', 'nobody@example.com')).toBeNull();
    });

    it('disconnects a provider/account', async () => {
      const service = makeService();
      await service.disconnect('search-console', 'owner@example.com');
      expect(await service.getCredentials('search-console', 'owner@example.com')).toBeNull();
    });
  });

  describe('sync', () => {
    it('resolves a valid token and runs a search-console sync, publishing events', async () => {
      const bus = { publish: vi.fn(async () => ({})) } as unknown as Pick<EventBus, 'publish'>;
      const service = makeService({
        fetchImpl: fetchFor({
          'searchAnalytics/query': {
            rows: [{ keys: ['2026-08-01'], clicks: 5, impressions: 100, ctr: 0.05, position: 3 }],
            totalClicks: 5,
            totalImpressions: 100,
            totalCtr: 0.05,
            totalPosition: 3,
          },
        }),
        eventBus: bus,
      });

      const result = await service.sync({
        provider: 'search-console',
        account: 'owner@example.com',
        resource: 'sc-domain:example.com',
      });

      expect(result.status).toBe('SUCCESS');
      expect(result.rowsProcessed).toBe(1);
      expect(bus.publish).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'google.searchconsole.synced' }),
      );
    });

    it('does not resolve a token for public providers', async () => {
      const service = makeService({
        fetchImpl: fetchFor({
          runPagespeed: {
            lighthouseResult: { categories: {}, audits: {}, fetchTime: 't' },
          },
        }),
      });
      const result = await service.sync({
        provider: 'pagespeed',
        account: 'owner@example.com',
        resource: 'https://example.com',
        url: 'https://example.com',
      });
      expect(result.status).toBe('SUCCESS');
    });

    it('throws a typed error when an authenticated provider has no credentials', async () => {
      const service = makeService({ credentialStorage: new MemoryCredentialStorage() });
      await expect(
        service.sync({ provider: 'search-console', account: 'nobody@example.com', resource: 'site' }),
      ).rejects.toBeInstanceOf(GoogleApiError);
    });
  });

  describe('direct client access', () => {
    it('lists sites', async () => {
      const service = makeService();
      const sites = await service.listSites('owner@example.com');
      expect(sites[0]?.siteUrl).toBe('sc-domain:example.com');
    });

    it('runs search analytics and submits a sitemap', async () => {
      let putCalled = false;
      const service = makeService({
        fetchImpl: async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
          const url = String(input);
          if (url.includes('searchAnalytics/query')) {
            return jsonResponse({
              rows: [{ keys: ['q'], clicks: 1, impressions: 2, ctr: 0.5, position: 1 }],
              totalClicks: 1,
            });
          }
          if (url.includes('sitemaps/sitemap.xml')) {
            putCalled = init?.method === 'PUT';
            return jsonResponse(null, 204);
          }
          throw new Error(`No route for ${url}`);
        },
      });

      const response = await service.searchAnalytics('owner@example.com', 'sc-domain:example.com', {
        startDate: '2026-07-01',
        endDate: '2026-08-01',
      });
      expect(response.rows[0]?.keys).toEqual(['q']);
      await service.submitSitemap('owner@example.com', 'sc-domain:example.com', 'sitemap.xml');
      expect(putCalled).toBe(true);
    });

    it('lists sitemaps', async () => {
      const service = makeService({
        fetchImpl: fetchFor({
          'sc-domain%3Aexample.com/sitemaps': {
            sitemap: [{ path: 'https://example.com/sitemap.xml', lastSubmitted: 't', type: 'sitemap' }],
          },
        }),
      });
      const sitemaps = await service.listSitemaps('owner@example.com', 'sc-domain:example.com');
      expect(sitemaps[0]).toMatchObject({
        path: 'https://example.com/sitemap.xml',
        type: 'sitemap',
      });
    });

    it('runs a GA4 report', async () => {
      const service = makeService({
        fetchImpl: fetchFor({
          ':runReport': {
            dimensionHeaders: [{ name: 'date' }],
            metricHeaders: [{ name: 'sessions' }],
            rows: [{ dimensionValues: [{ value: '20260801' }], metricValues: [{ value: '12' }] }],
            rowCount: 1,
          },
        }),
      });
      const response = await service.runReport('owner@example.com', '12345', {
        dateRanges: [{ startDate: '2026-07-01', endDate: '2026-08-01' }],
        metrics: [{ name: 'sessions' }],
      });
      expect(response.rows[0]?.metricValues).toEqual(['12']);
    });

    it('runs PageSpeed, Rich Results and Indexing calls', async () => {
      const service = makeService({
        fetchImpl: fetchFor({
          runPagespeed: {
            lighthouseResult: { categories: { performance: { score: 0.9 } }, audits: {}, fetchTime: 't' },
          },
          'htmlChecks:run': { testId: 'test-1', url: 'https://example.com', status: 'TESTING' },
          'htmlChecks/test-1': {
            testId: 'test-1',
            url: 'https://example.com',
            status: 'PASS',
            result: { items: [] },
          },
          'urlNotifications:publish': {
            urlNotificationMetadata: { url: 'https://example.com/page', latestUpdate: { url: 'https://example.com/page', notifyTime: 't', type: 'URL_UPDATED' } },
          },
        }),
      });

      const speed = await service.analyzePageSpeed({ url: 'https://example.com' });
      expect(speed.scores.performance).toBe(0.9);

      const test = await service.runRichResultsTest({ url: 'https://example.com' });
      expect(test.testId).toBe('test-1');

      const status = await service.getRichResultsStatus('test-1');
      expect(status.status).toBe('PASS');

      const indexing = await service.notifyIndexing('owner@example.com', 'https://example.com/page', 'URL_UPDATED');
      expect(indexing.latestUpdate?.type).toBe('URL_UPDATED');
    });

    it('maps a missing credential to a typed error on direct calls', async () => {
      const service = makeService({ credentialStorage: new MemoryCredentialStorage() });
      await expect(service.listSites('nobody@example.com')).rejects.toBeInstanceOf(GoogleApiError);
    });
  });
});
