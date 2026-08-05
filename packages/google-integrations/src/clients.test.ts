import { describe, expect, it } from 'vitest';
import {
  AnalyticsClient,
  IndexingClient,
  PageSpeedClient,
  RichResultsClient,
  SearchConsoleClient,
} from './clients.js';
import { GoogleValidationError } from './errors.js';
import { GoogleHttpClient } from './http-client.js';

function httpFor(fetchImpl: typeof fetch): GoogleHttpClient {
  return new GoogleHttpClient({ baseUrl: 'https://api.example.com', fetchImpl });
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('SearchConsoleClient', () => {
  it('lists sites and maps entries', async () => {
    const client = new SearchConsoleClient(
      httpFor(async (input, init) => {
        expect(String(input)).toBe('https://api.example.com/sites');
        expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer at-1');
        return jsonResponse({
          siteEntry: [
            { siteUrl: 'sc-domain:example.com', permissionLevel: 'siteFullUser' },
            { siteUrl: 'https://other.com/' },
          ],
        });
      }),
    );
    const sites = await client.listSites('at-1');
    expect(sites).toEqual([
      { siteUrl: 'sc-domain:example.com', permissionLevel: 'siteFullUser' },
      { siteUrl: 'https://other.com/', permissionLevel: '' },
    ]);
  });

  it('returns an empty list when siteEntry is absent', async () => {
    const client = new SearchConsoleClient(httpFor(async () => jsonResponse({})));
    expect(await client.listSites('at-1')).toEqual([]);
  });

  it('normalizes malformed site entries', async () => {
    const client = new SearchConsoleClient(
      httpFor(async () => jsonResponse({ siteEntry: [{ siteUrl: 42, permissionLevel: null }, 'junk'] })),
    );
    expect(await client.listSites('at-1')).toEqual([
      { siteUrl: '', permissionLevel: '' },
      { siteUrl: '', permissionLevel: '' },
    ]);
  });

  it('runs search analytics and normalizes rows', async () => {
    const client = new SearchConsoleClient(
      httpFor(async (input, init) => {
        expect(String(input)).toBe(
          'https://api.example.com/sites/sc-domain%3Aexample.com/searchAnalytics/query',
        );
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        expect(body).toMatchObject({ startDate: '2026-07-01', endDate: '2026-08-01', dimensions: ['date'] });
        return jsonResponse({
          rows: [{ keys: ['2026-07-05'], clicks: '5', impressions: '100', ctr: '0.05', position: '3.5' }],
          totalClicks: 5,
          totalImpressions: 100,
          totalCtr: 0.05,
          totalPosition: 3.5,
        });
      }),
    );
    const response = await client.searchAnalytics('at-1', 'sc-domain:example.com', {
      startDate: '2026-07-01',
      endDate: '2026-08-01',
      dimensions: ['date'],
    });
    expect(response.rows[0]).toMatchObject({ clicks: 5, impressions: 100, ctr: 0.05, position: 3.5 });
    expect(response.rows[0]?.keys).toEqual(['2026-07-05']);
    expect(response.totalClicks).toBe(5);
  });

  it('tolerates rows without keys', async () => {
    const client = new SearchConsoleClient(
      httpFor(async () => jsonResponse({ rows: [{ clicks: 1 }], totalClicks: 1 })),
    );
    const response = await client.searchAnalytics('at-1', 'site', { startDate: 'a', endDate: 'b' });
    expect(response.rows[0]?.keys).toEqual([]);
    expect(response.rows[0]?.clicks).toBe(1);
    expect(response.totalPosition).toBe(0);
  });

  it('passes through the optional search analytics fields', async () => {
    const client = new SearchConsoleClient(
      httpFor(async (_input, init) => {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        expect(body.dimensions).toEqual(['query']);
        expect(body.searchType).toBe('web');
        expect(body.rowLimit).toBe(10);
        expect(body.startRow).toBe(5);
        return jsonResponse({});
      }),
    );
    await client.searchAnalytics('at-1', 'site', {
      startDate: 'a',
      endDate: 'b',
      dimensions: ['query'],
      searchType: 'web',
      rowLimit: 10,
      startRow: 5,
    });
  });

  it('tolerates a malformed search analytics response', async () => {
    const client = new SearchConsoleClient(
      httpFor(async () => jsonResponse({ rows: 'nope', totalClicks: 'abc', totalPosition: 'bad' })),
    );
    const response = await client.searchAnalytics('at-1', 'site', { startDate: 'a', endDate: 'b' });
    expect(response.rows).toEqual([]);
    expect(response.totalClicks).toBe(0);
    expect(response.totalPosition).toBe(0);
  });

  it('validates search analytics input', async () => {
    const client = new SearchConsoleClient(httpFor(async () => jsonResponse({})));
    await expect(client.searchAnalytics('at-1', '', { startDate: 'a', endDate: 'b' })).rejects.toBeInstanceOf(
      GoogleValidationError,
    );
    await expect(client.searchAnalytics('at-1', 'site', { startDate: '', endDate: 'b' })).rejects.toBeInstanceOf(
      GoogleValidationError,
    );
  });

  it('lists and normalizes sitemaps', async () => {
    const client = new SearchConsoleClient(
      httpFor(async (input) => {
        expect(String(input)).toBe('https://api.example.com/sites/sc-domain%3Aexample.com/sitemaps');
        return jsonResponse({
          sitemap: [
            {
              path: 'https://example.com/sitemap.xml',
              lastSubmitted: '2026-01-01T00:00:00Z',
              isPending: false,
              isSitemapsIndex: false,
              type: 'sitemap',
              errors: '',
              warnings: '',
            },
          ],
        });
      }),
    );
    const sitemaps = await client.listSitemaps('at-1', 'sc-domain:example.com');
    expect(sitemaps[0]).toMatchObject({
      path: 'https://example.com/sitemap.xml',
      isPending: false,
      isSitemapsIndex: false,
      type: 'sitemap',
      lastDownloaded: null,
    });
    await expect(client.listSitemaps('at-1', '')).rejects.toBeInstanceOf(GoogleValidationError);
  });

  it('returns an empty list when the sitemap payload is missing', async () => {
    const client = new SearchConsoleClient(httpFor(async () => jsonResponse({})));
    expect(await client.listSitemaps('at-1', 'site')).toEqual([]);
  });

  it('normalizes a sitemap entry missing required fields', async () => {
    const client = new SearchConsoleClient(httpFor(async () => jsonResponse({ sitemap: [{}] })));
    const [entry] = await client.listSitemaps('at-1', 'site');
    expect(entry).toMatchObject({
      path: '',
      lastSubmitted: null,
      isPending: false,
      isSitemapsIndex: false,
      type: null,
    });
  });

  it('normalizes a sitemap with all optional fields', async () => {
    const client = new SearchConsoleClient(
      httpFor(async () =>
        jsonResponse({
          sitemap: [
            {
              path: 'p',
              lastSubmitted: 's',
              lastDownloaded: 'd',
              isPending: true,
              isSitemapsIndex: true,
              type: 'index',
              errors: 'e',
              warnings: 'w',
            },
          ],
        }),
      ),
    );
    const [entry] = await client.listSitemaps('at-1', 'site');
    expect(entry).toMatchObject({
      path: 'p',
      lastSubmitted: 's',
      lastDownloaded: 'd',
      isPending: true,
      isSitemapsIndex: true,
      type: 'index',
      errors: 'e',
      warnings: 'w',
    });
  });

  it('submits a sitemap via PUT', async () => {
    let url = '';
    const client = new SearchConsoleClient(
      httpFor(async (input, init) => {
        url = String(input);
        expect(init?.method).toBe('PUT');
        return new Response(null, { status: 204 });
      }),
    );
    await client.submitSitemap('at-1', { siteUrl: 'sc-domain:example.com', feedpath: 'sitemap.xml' });
    expect(url).toBe('https://api.example.com/sites/sc-domain%3Aexample.com/sitemaps/sitemap.xml');
    await expect(
      client.submitSitemap('at-1', { siteUrl: '', feedpath: 'sitemap.xml' }),
    ).rejects.toBeInstanceOf(GoogleValidationError);
    await expect(
      client.submitSitemap('at-1', { siteUrl: 'sc-domain:example.com', feedpath: '' }),
    ).rejects.toBeInstanceOf(GoogleValidationError);
  });
});

describe('AnalyticsClient', () => {
  it('runs a GA4 report and normalizes the response', async () => {
    const client = new AnalyticsClient(
      httpFor(async (input, init) => {
        expect(String(input)).toBe('https://api.example.com/properties/12345:runReport');
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        expect(body.metrics).toEqual([{ name: 'sessions' }]);
        return jsonResponse({
          dimensionHeaders: [{ name: 'date' }],
          metricHeaders: [{ name: 'sessions' }],
          rows: [
            {
              dimensionValues: [{ value: '20260801' }],
              metricValues: [{ value: '12' }],
            },
          ],
          rowCount: 1,
        });
      }),
    );
    const response = await client.runReport('at-1', '12345', {
      dateRanges: [{ startDate: '2026-07-01', endDate: '2026-08-01' }],
      metrics: [{ name: 'sessions' }],
    });
    expect(response.dimensionHeaders).toEqual(['date']);
    expect(response.metricHeaders).toEqual(['sessions']);
    expect(response.rows[0]).toEqual({ dimensionValues: ['20260801'], metricValues: ['12'] });
    expect(response.rowCount).toBe(1);
  });

  it('falls back to rowCount from rows length', async () => {
    const client = new AnalyticsClient(
      httpFor(async () => jsonResponse({ rows: [{ dimensionValues: [], metricValues: [] }] })),
    );
    const response = await client.runReport('at-1', '12345', {
      dateRanges: [{ startDate: 'a', endDate: 'b' }],
      metrics: [{ name: 'sessions' }],
    });
    expect(response.rowCount).toBe(1);
  });

  it('passes through the optional GA4 report fields', async () => {
    const client = new AnalyticsClient(
      httpFor(async (_input, init) => {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        expect(body.dimensions).toEqual([{ name: 'date' }]);
        expect(body.limit).toBe(10);
        expect(body.offset).toBe(0);
        return jsonResponse({});
      }),
    );
    await client.runReport('at-1', '12345', {
      dateRanges: [{ startDate: 'a', endDate: 'b' }],
      metrics: [{ name: 'sessions' }],
      dimensions: [{ name: 'date' }],
      limit: 10,
      offset: 0,
    });
  });

  it('normalizes a malformed GA4 response', async () => {
    const client = new AnalyticsClient(
      httpFor(async () =>
        jsonResponse({
          dimensionHeaders: [{ name: 'date' }, {}],
          metricHeaders: 'junk',
          rows: [{ dimensionValues: [{ value: 42 }, {}], metricValues: [] }],
        }),
      ),
    );
    const response = await client.runReport('at-1', '12345', {
      dateRanges: [{ startDate: 'a', endDate: 'b' }],
      metrics: [{ name: 'sessions' }],
    });
    expect(response.dimensionHeaders).toEqual(['date', '']);
    expect(response.metricHeaders).toEqual([]);
    expect(response.rows[0]).toEqual({ dimensionValues: ['', ''], metricValues: [] });
  });

  it('normalizes null headers and dimension values', async () => {
    const client = new AnalyticsClient(
      httpFor(async () =>
        jsonResponse({
          dimensionHeaders: [null],
          metricHeaders: null,
          rows: [{ dimensionValues: [null], metricValues: [null] }],
        }),
      ),
    );
    const response = await client.runReport('at-1', '12345', {
      dateRanges: [{ startDate: 'a', endDate: 'b' }],
      metrics: [{ name: 'sessions' }],
    });
    expect(response.dimensionHeaders).toEqual(['']);
    expect(response.metricHeaders).toEqual([]);
    expect(response.rows[0]).toEqual({ dimensionValues: [''], metricValues: [''] });
  });

  it('validates input', async () => {
    const client = new AnalyticsClient(httpFor(async () => jsonResponse({})));
    await expect(
      client.runReport('at-1', '', {
        dateRanges: [{ startDate: 'a', endDate: 'b' }],
        metrics: [{ name: 'sessions' }],
      }),
    ).rejects.toBeInstanceOf(GoogleValidationError);
    await expect(
      client.runReport('at-1', '12345', { dateRanges: [], metrics: [] }),
    ).rejects.toBeInstanceOf(GoogleValidationError);
  });
});

describe('PageSpeedClient', () => {
  it('analyzes a URL and normalizes scores and audits', async () => {
    let url = '';
    const client = new PageSpeedClient(
      httpFor(async (input) => {
        url = String(input);
        return jsonResponse({
          lighthouseResult: {
            fetchTime: '2026-08-05T00:00:00.000Z',
            categories: {
              performance: { score: 0.9 },
              seo: { score: 0.8 },
            },
            audits: {
              'first-contentful-paint': { score: 0.9, displayValue: '1.2 s' },
              'largest-contentful-paint': { score: 0.7, displayValue: '2.0 s' },
              'total-blocking-time': { score: 0.5, displayValue: '100 ms' },
              'cumulative-layout-shift': { score: 0.9, displayValue: '0.01' },
              'speed-index': { score: 0.8, displayValue: '1.5 s' },
              interactive: { score: 0.6, displayValue: '3.0 s' },
            },
          },
        });
      }),
    );
    const result = await client.analyze({ url: 'https://example.com', strategy: 'desktop' });
    expect(url).toContain('url=https%3A%2F%2Fexample.com');
    expect(url).toContain('strategy=desktop');
    expect(url).toContain('category=performance');
    expect(result.scores).toEqual({ performance: 0.9, seo: 0.8 });
    expect(result.metrics.firstContentfulPaint).toEqual({ score: 0.9, displayValue: '1.2 s' });
    expect(result.strategy).toBe('desktop');
    expect(result.fetchedAt).toBe('2026-08-05T00:00:00.000Z');
  });

  it('defaults strategy, missing audits and API key handling', async () => {
    const client = new PageSpeedClient(
      httpFor(async (input) => {
        expect(String(input)).toContain('key=key-1');
        expect(String(input)).toContain('strategy=mobile');
        return jsonResponse({});
      }),
    );
    const result = await client.analyze({ url: 'https://example.com' }, 'key-1');
    expect(result.metrics.speedIndex).toEqual({ score: null, displayValue: '' });
    expect(result.scores).toEqual({});
  });

  it('normalizes missing or malformed page speed fields', async () => {
    const client = new PageSpeedClient(
      httpFor(async () =>
        jsonResponse({
          lighthouseResult: {
            fetchTime: 123,
            categories: { performance: { score: '9' } },
            audits: { 'first-contentful-paint': { score: 'x', displayValue: 42 } },
          },
        }),
      ),
    );
    const result = await client.analyze({ url: 'https://example.com' });
    expect(result.scores).toEqual({});
    expect(result.fetchedAt).toBe('');
    expect(result.metrics.firstContentfulPaint).toEqual({ score: null, displayValue: '' });
  });

  it('handles an empty page speed response', async () => {
    const client = new PageSpeedClient(httpFor(async () => new Response(null, { status: 200 })));
    const result = await client.analyze({ url: 'https://example.com' });
    expect(result.scores).toEqual({});
    expect(result.metrics.firstContentfulPaint).toEqual({ score: null, displayValue: '' });
  });

  it('validates the URL', async () => {
    const client = new PageSpeedClient(httpFor(async () => jsonResponse({})));
    await expect(client.analyze({ url: '' })).rejects.toBeInstanceOf(GoogleValidationError);
  });
});

describe('RichResultsClient', () => {
  it('runs a test', async () => {
    const client = new RichResultsClient(
      httpFor(async (input, init) => {
        expect(String(input)).toBe('https://api.example.com/urlTestingTools/htmlChecks:run');
        expect(JSON.parse(String(init?.body))).toMatchObject({ url: 'https://example.com' });
        return jsonResponse({ testId: 'test-1', url: 'https://example.com', status: 'TESTING' });
      }),
    );
    const result = await client.runTest({ url: 'https://example.com' });
    expect(result).toEqual({ testId: 'test-1', url: 'https://example.com', status: 'TESTING' });
    await expect(client.runTest({ url: '' })).rejects.toBeInstanceOf(GoogleValidationError);
  });

  it('passes requestScreenshot through to the test request', async () => {
    const client = new RichResultsClient(
      httpFor(async (_input, init) => {
        expect(JSON.parse(String(init?.body))).toEqual({
          url: 'https://example.com',
          requestScreenshot: true,
        });
        return jsonResponse({});
      }),
    );
    await client.runTest({ url: 'https://example.com', requestScreenshot: true });
  });

  it('normalizes a malformed test response', async () => {
    const client = new RichResultsClient(httpFor(async () => jsonResponse({})));
    const result = await client.runTest({ url: 'https://example.com' });
    expect(result).toEqual({ testId: '', url: 'https://example.com', status: 'UNKNOWN' });
  });

  it('reads the test status and normalizes items', async () => {
    const client = new RichResultsClient(
      httpFor(async (input) => {
        expect(String(input)).toBe('https://api.example.com/urlTestingTools/htmlChecks/test-1');
        return jsonResponse({
          testId: 'test-1',
          url: 'https://example.com',
          status: 'PASS',
          result: {
            items: [
              {
                name: 'RichResult',
                items: [{ name: 'Item', text: 'ok', isPass: true }],
                resultsCount: 1,
                passCount: 1,
              },
            ],
          },
        });
      }),
    );
    const result = await client.getTestStatus('test-1');
    expect(result.status).toBe('PASS');
    expect(result.items[0]?.items[0]?.isPass).toBe(true);
    expect(result.items[0]?.resultsCount).toBe(1);
    await expect(client.getTestStatus('')).rejects.toBeInstanceOf(GoogleValidationError);
  });

  it('normalizes a malformed status response', async () => {
    const client = new RichResultsClient(httpFor(async () => jsonResponse({})));
    const result = await client.getTestStatus('t');
    expect(result).toEqual({ testId: 't', url: '', status: 'UNKNOWN', items: [] });
  });

  it('normalizes a rich results status with sparse items', async () => {
    const client = new RichResultsClient(
      httpFor(async () =>
        jsonResponse({
          testId: 't',
          status: 'PASS',
          result: { items: [{ items: [{}, null] }] },
        }),
      ),
    );
    const result = await client.getTestStatus('t');
    expect(result.items[0]).toMatchObject({ name: '', resultsCount: 0, passCount: 0 });
    expect(result.items[0]?.items).toEqual([
      { name: '', text: '', isPass: false },
      { name: '', text: '', isPass: false },
    ]);
  });
});

describe('IndexingClient', () => {
  it('notifies a URL update', async () => {
    const client = new IndexingClient(
      httpFor(async (input, init) => {
        expect(String(input)).toBe('https://api.example.com/urlNotifications:publish');
        expect(JSON.parse(String(init?.body))).toEqual({
          url: 'https://example.com/page',
          type: 'URL_UPDATED',
        });
        return jsonResponse({
          urlNotificationMetadata: {
            url: 'https://example.com/page',
            latestUpdate: { url: 'https://example.com/page', notifyTime: 't', type: 'URL_UPDATED' },
          },
        });
      }),
    );
    const result = await client.notify('at-1', 'https://example.com/page', 'URL_UPDATED');
    expect(result.url).toBe('https://example.com/page');
    expect(result.latestUpdate?.type).toBe('URL_UPDATED');
    expect(result.latestRemove).toBeNull();
    await expect(client.notify('at-1', '', 'URL_UPDATED')).rejects.toBeInstanceOf(GoogleValidationError);
  });

  it('reads metadata and normalizes missing entries', async () => {
    const client = new IndexingClient(
      httpFor(async (input) => {
        expect(String(input)).toBe('https://api.example.com/urlNotifications/metadata?url=https%3A%2F%2Fexample.com%2Fpage');
        return jsonResponse({ url: 'https://example.com/page' });
      }),
    );
    const result = await client.getStatus('at-1', 'https://example.com/page');
    expect(result.latestUpdate).toBeNull();
    expect(result.latestRemove).toBeNull();
    await expect(client.getStatus('at-1', '')).rejects.toBeInstanceOf(GoogleValidationError);
  });

  it('normalizes a URL_DELETED notification', async () => {
    const client = new IndexingClient(
      httpFor(async () =>
        jsonResponse({
          urlNotificationMetadata: {
            url: 'https://example.com',
            latestUpdate: { url: 'https://example.com', notifyTime: 't', type: 'URL_DELETED' },
          },
        }),
      ),
    );
    const result = await client.notify('at-1', 'https://example.com', 'URL_DELETED');
    expect(result.latestUpdate?.type).toBe('URL_DELETED');
  });

  it('treats an explicit null metadata entry as missing', async () => {
    const client = new IndexingClient(
      httpFor(async () => jsonResponse({ urlNotificationMetadata: { url: 'x', latestUpdate: null } })),
    );
    const result = await client.getStatus('at-1', 'https://example.com');
    expect(result.latestUpdate).toBeNull();
  });

  it('normalizes metadata entries with missing fields', async () => {
    const client = new IndexingClient(
      httpFor(async () =>
        jsonResponse({
          urlNotificationMetadata: {
            url: 'https://example.com',
            latestUpdate: { url: 1, notifyTime: null, type: 'URL_UPDATED' },
          },
        }),
      ),
    );
    const result = await client.getStatus('at-1', 'https://example.com');
    expect(result.latestUpdate).toEqual({ url: '', notifyTime: '', type: 'URL_UPDATED' });
  });
});
