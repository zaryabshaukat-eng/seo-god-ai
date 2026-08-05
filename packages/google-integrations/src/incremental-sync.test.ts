import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createLogger } from '@seogod/logging';
import { MetricsRegistry } from '@seogod/monitoring';
import type { GoogleEventPublisher } from './events.js';
import { IncrementalSync, type SyncDependencies } from './incremental-sync.js';
import { GoogleMetrics } from './metrics.js';
import { MemoryGoogleSyncRepository } from './repository.js';

const NOW = new Date('2026-08-05T00:00:00Z');

const fakeClients = {
  searchConsole: {
    listSites: vi.fn(),
    searchAnalytics: vi.fn(),
    listSitemaps: vi.fn(),
    submitSitemap: vi.fn(),
  },
  analytics: { runReport: vi.fn() },
  pageSpeed: { analyze: vi.fn() },
  richResults: { runTest: vi.fn() },
  indexing: { notify: vi.fn(), getStatus: vi.fn() },
};

const publisher = { publish: vi.fn(async () => {}) } as GoogleEventPublisher;

function makeEngine(overrides: Partial<SyncDependencies> = {}) {
  const registry = new MetricsRegistry();
  const engine = new IncrementalSync({
    repository: new MemoryGoogleSyncRepository(),
    clients: fakeClients as unknown as SyncDependencies['clients'],
    publisher,
    logger: createLogger({ level: 'silent' }),
    metrics: new GoogleMetrics(registry),
    now: () => NOW,
    ...overrides,
  });
  return { engine, registry };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(fakeClients.searchConsole.searchAnalytics).mockResolvedValue({
    rows: [
      { keys: ['2026-08-01'], clicks: 5, impressions: 100, ctr: 0.05, position: 3 },
      { keys: ['2026-08-02'], clicks: 3, impressions: 50, ctr: 0.06, position: 2 },
    ],
    totalClicks: 8,
    totalImpressions: 150,
    totalCtr: 0.053,
    totalPosition: 2.5,
  });
});

describe('IncrementalSync', () => {
  it('runs a first-time search-console sync from the default window', async () => {
    const repo = new MemoryGoogleSyncRepository();
    const { engine, registry } = makeEngine({ repository: repo });
    const result = await engine.run({
      provider: 'search-console',
      account: 'owner@example.com',
      resource: 'sc-domain:example.com',
      accessToken: 'at-1',
    });

    expect(result.status).toBe('SUCCESS');
    expect(result.cursor).toBe('2026-08-05');
    expect(result.rowsProcessed).toBe(2);
    expect(fakeClients.searchConsole.searchAnalytics).toHaveBeenCalledWith('at-1', 'sc-domain:example.com', {
      startDate: '2026-07-06',
      endDate: '2026-08-05',
      dimensions: ['date'],
      rowLimit: undefined,
    });
    expect(publisher.publish).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'google.searchconsole.synced', resource: 'sc-domain:example.com' }),
    );

    const state = await repo.getState('search-console', 'sc-domain:example.com');
    expect(state?.status).toBe('SYNCED');
    expect(state?.cursor).toBe('2026-08-05');

    const snapshot = registry.snapshot();
    expect(snapshot.counters.google_syncs).toBe(1);
    expect(snapshot.counters.google_rows_processed).toBe(2);
    expect(snapshot.gauges.google_sync_duration_seconds).toBeGreaterThanOrEqual(0);
  });

  it('honours a custom end date on the first run', async () => {
    const { engine } = makeEngine();
    await engine.run({
      provider: 'search-console',
      account: 'owner@example.com',
      resource: 'sc-domain:example.com',
      accessToken: 'at-1',
      endDate: '2026-08-04',
    });
    const call = vi.mocked(fakeClients.searchConsole.searchAnalytics).mock.calls[0]![2];
    expect(call.startDate).toBe('2026-07-06');
    expect(call.endDate).toBe('2026-08-04');
  });

  it('uses a persisted cursor as the next start date', async () => {
    const repo = new MemoryGoogleSyncRepository();
    await repo.saveState({
      provider: 'search-console',
      resource: 'sc-domain:example.com',
      cursor: '2026-07-20',
      lastSyncedAt: '2026-07-20T00:00:00Z',
      status: 'SYNCED',
    });
    const { engine } = makeEngine({ repository: repo });
    await engine.run({
      provider: 'search-console',
      account: 'owner@example.com',
      resource: 'sc-domain:example.com',
      accessToken: 'at-1',
    });
    const call = vi.mocked(fakeClients.searchConsole.searchAnalytics).mock.calls[0]![2];
    expect(call.startDate).toBe('2026-07-20');
  });

  it('runs a GA4 sync with the default metrics and event', async () => {
    vi.mocked(fakeClients.analytics.runReport).mockResolvedValue({
      dimensionHeaders: ['date'],
      metricHeaders: ['sessions'],
      rows: [{ dimensionValues: ['20260801'], metricValues: ['12'] }],
      rowCount: 1,
    });
    const { engine } = makeEngine();
    const result = await engine.run({
      provider: 'analytics',
      account: 'owner@example.com',
      resource: '12345',
      accessToken: 'at-1',
    });

    expect(result.status).toBe('SUCCESS');
    expect(result.cursor).toBe('2026-08-05');
    const query = vi.mocked(fakeClients.analytics.runReport).mock.calls[0]![2];
    expect(query.metrics).toEqual([{ name: 'sessions' }, { name: 'totalUsers' }, { name: 'screenPageViews' }]);
    expect(query.dateRanges).toEqual([{ startDate: '2026-07-06', endDate: '2026-08-05' }]);
    expect(publisher.publish).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'google.analytics.synced', resource: '12345' }),
    );
  });

  it('runs a PageSpeed sync and publishes the audit event', async () => {
    vi.mocked(fakeClients.pageSpeed.analyze).mockResolvedValue({
      url: 'https://example.com',
      strategy: 'mobile',
      fetchedAt: 't',
      scores: { performance: 0.9 },
      metrics: {
        firstContentfulPaint: { score: 0.9, displayValue: '1.2 s' },
        largestContentfulPaint: { score: 0.7, displayValue: '2.0 s' },
        totalBlockingTime: { score: 0.5, displayValue: '100 ms' },
        cumulativeLayoutShift: { score: 0.9, displayValue: '0.01' },
        speedIndex: { score: 0.8, displayValue: '1.5 s' },
        interactive: { score: 0.6, displayValue: '3.0 s' },
      },
    });
    const { engine } = makeEngine();
    const result = await engine.run({
      provider: 'pagespeed',
      account: 'owner@example.com',
      resource: 'https://example.com',
      url: 'https://example.com',
    });

    expect(result.status).toBe('SUCCESS');
    expect(result.rowsProcessed).toBe(1);
    expect(publisher.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'google.pagespeed.completed',
        payload: expect.objectContaining({ url: 'https://example.com' }),
      }),
    );
  });

  it('fails a PageSpeed sync without a URL', async () => {
    const { engine, registry } = makeEngine();
    const result = await engine.run({
      provider: 'pagespeed',
      account: 'owner@example.com',
      resource: 'https://example.com',
    });
    expect(result.status).toBe('FAILED');
    expect(result.error).toContain('url is required');
    expect(registry.snapshot().counters.google_sync_failures).toBe(1);
  });

  it('runs a Rich Results sync', async () => {
    vi.mocked(fakeClients.richResults.runTest).mockResolvedValue({
      testId: 'test-1',
      url: 'https://example.com',
      status: 'TESTING',
    });
    const { engine } = makeEngine();
    const result = await engine.run({
      provider: 'rich-results',
      account: 'owner@example.com',
      resource: 'https://example.com',
      url: 'https://example.com',
    });
    expect(result.status).toBe('SUCCESS');
    expect(publisher.publish).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'google.richresults.completed', payload: { url: 'https://example.com', testId: 'test-1', status: 'TESTING' } }),
    );
  });

  it('runs an Indexing sync with the default notification type', async () => {
    vi.mocked(fakeClients.indexing.notify).mockResolvedValue({
      url: 'https://example.com/page',
      latestUpdate: { url: 'https://example.com/page', notifyTime: 't', type: 'URL_UPDATED' },
      latestRemove: null,
    });
    const { engine } = makeEngine();
    const result = await engine.run({
      provider: 'indexing',
      account: 'owner@example.com',
      resource: 'https://example.com/page',
      url: 'https://example.com/page',
      accessToken: 'at-1',
    });
    expect(result.status).toBe('SUCCESS');
    expect(fakeClients.indexing.notify).toHaveBeenCalledWith('at-1', 'https://example.com/page', 'URL_UPDATED');
    expect(publisher.publish).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'google.indexing.notified', payload: { url: 'https://example.com/page', type: 'URL_UPDATED' } }),
    );
  });

  it('records a FAILED state and publishes sync.failed when a client throws', async () => {
    const repo = new MemoryGoogleSyncRepository();
    vi.mocked(fakeClients.searchConsole.searchAnalytics).mockRejectedValue(new Error('boom'));
    const { engine, registry } = makeEngine({ repository: repo });

    const result = await engine.run({
      provider: 'search-console',
      account: 'owner@example.com',
      resource: 'sc-domain:example.com',
      accessToken: 'at-1',
    });

    expect(result.status).toBe('FAILED');
    expect(result.error).toBe('boom');
    expect(publisher.publish).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'google.sync.failed', payload: expect.objectContaining({ error: 'boom' }) }),
    );

    const state = await repo.getState('search-console', 'sc-domain:example.com');
    expect(state?.status).toBe('FAILED');
    expect(state?.error).toBe('boom');
    expect(registry.snapshot().counters.google_sync_failures).toBe(1);
  });

  it('keeps the last good cursor after a failure', async () => {
    const repo = new MemoryGoogleSyncRepository();
    await repo.saveState({
      provider: 'search-console',
      resource: 'sc-domain:example.com',
      cursor: '2026-07-20',
      lastSyncedAt: '2026-07-20T00:00:00Z',
      status: 'SYNCED',
    });
    vi.mocked(fakeClients.searchConsole.searchAnalytics).mockRejectedValue(new Error('boom'));
    const { engine } = makeEngine({ repository: repo });
    const result = await engine.run({
      provider: 'search-console',
      account: 'owner@example.com',
      resource: 'sc-domain:example.com',
      accessToken: 'at-1',
    });
    expect(result.cursor).toBe('2026-07-20');
    const state = await repo.getState('search-console', 'sc-domain:example.com');
    expect(state?.cursor).toBe('2026-07-20');
  });

  it('logs and ignores publisher failures (best effort)', async () => {
    vi.mocked(publisher.publish).mockRejectedValue(new Error('outbox down'));
    const { engine } = makeEngine();
    const result = await engine.run({
      provider: 'search-console',
      account: 'owner@example.com',
      resource: 'sc-domain:example.com',
      accessToken: 'at-1',
    });
    expect(result.status).toBe('SUCCESS');
  });

  it('skips publishing entirely when no publisher is configured', async () => {
    const { engine } = makeEngine({ publisher: undefined });
    const result = await engine.run({
      provider: 'search-console',
      account: 'owner@example.com',
      resource: 'sc-domain:example.com',
      accessToken: 'at-1',
    });
    expect(result.status).toBe('SUCCESS');
    expect(publisher.publish).not.toHaveBeenCalled();
  });

  it('defaults the clock and first-run window when not provided', async () => {
    const engine = new IncrementalSync({
      repository: new MemoryGoogleSyncRepository(),
      clients: fakeClients as unknown as SyncDependencies['clients'],
      publisher,
      logger: createLogger({ level: 'silent' }),
    });
    const result = await engine.run({
      provider: 'search-console',
      account: 'owner@example.com',
      resource: 'sc-domain:example.com',
    });
    expect(result.status).toBe('SUCCESS');
  });

  it('runs a search-console sync without a pre-resolved token', async () => {
    const { engine } = makeEngine();
    const result = await engine.run({
      provider: 'search-console',
      account: 'owner@example.com',
      resource: 'sc-domain:example.com',
    });
    expect(result.status).toBe('SUCCESS');
    expect(fakeClients.searchConsole.searchAnalytics).toHaveBeenCalledWith(
      '',
      'sc-domain:example.com',
      expect.anything(),
    );
  });

  it('runs an analytics sync without a pre-resolved token', async () => {
    vi.mocked(fakeClients.analytics.runReport).mockResolvedValue({
      dimensionHeaders: [],
      metricHeaders: [],
      rows: [],
      rowCount: 0,
    });
    const { engine } = makeEngine();
    const result = await engine.run({
      provider: 'analytics',
      account: 'owner@example.com',
      resource: '12345',
    });
    expect(result.status).toBe('SUCCESS');
    expect(fakeClients.analytics.runReport).toHaveBeenCalledWith('', '12345', expect.anything());
  });

  it('runs an indexing sync without a pre-resolved token', async () => {
    vi.mocked(fakeClients.indexing.notify).mockResolvedValue({
      url: 'https://example.com/page',
      latestUpdate: { url: 'https://example.com/page', notifyTime: 't', type: 'URL_UPDATED' },
      latestRemove: null,
    });
    const { engine } = makeEngine();
    const result = await engine.run({
      provider: 'indexing',
      account: 'owner@example.com',
      resource: 'https://example.com/page',
      url: 'https://example.com/page',
    });
    expect(result.status).toBe('SUCCESS');
    expect(fakeClients.indexing.notify).toHaveBeenCalledWith('', 'https://example.com/page', 'URL_UPDATED');
  });

  it('honours an explicit startDate override', async () => {
    const { engine } = makeEngine();
    await engine.run({
      provider: 'search-console',
      account: 'owner@example.com',
      resource: 'sc-domain:example.com',
      accessToken: 'at-1',
      startDate: '2026-01-01',
    });
    const call = vi.mocked(fakeClients.searchConsole.searchAnalytics).mock.calls[0]![2];
    expect(call.startDate).toBe('2026-01-01');
  });

  it('stringifies non-Error failures', async () => {
    vi.mocked(fakeClients.searchConsole.searchAnalytics).mockRejectedValue('boom-string');
    const { engine } = makeEngine();
    const result = await engine.run({
      provider: 'search-console',
      account: 'owner@example.com',
      resource: 'sc-domain:example.com',
      accessToken: 'at-1',
    });
    expect(result.status).toBe('FAILED');
    expect(result.error).toBe('boom-string');
  });

  it('fails a Rich Results sync without a URL', async () => {
    const { engine, registry } = makeEngine();
    const result = await engine.run({
      provider: 'rich-results',
      account: 'owner@example.com',
      resource: 'https://example.com',
    });
    expect(result.status).toBe('FAILED');
    expect(result.error).toContain('url is required');
    expect(registry.snapshot().counters.google_sync_failures).toBe(1);
  });

  it('fails an Indexing sync without a URL', async () => {
    const { engine } = makeEngine();
    const result = await engine.run({
      provider: 'indexing',
      account: 'owner@example.com',
      resource: 'https://example.com/page',
    });
    expect(result.status).toBe('FAILED');
    expect(result.error).toContain('url is required');
  });

  it('honours an explicit indexing notification type', async () => {
    vi.mocked(fakeClients.indexing.notify).mockResolvedValue({
      url: 'https://example.com/page',
      latestUpdate: { url: 'https://example.com/page', notifyTime: 't', type: 'URL_DELETED' },
      latestRemove: null,
    });
    const { engine } = makeEngine();
    const result = await engine.run({
      provider: 'indexing',
      account: 'owner@example.com',
      resource: 'https://example.com/page',
      url: 'https://example.com/page',
      accessToken: 'at-1',
      indexingType: 'URL_DELETED',
    });
    expect(result.status).toBe('SUCCESS');
    expect(fakeClients.indexing.notify).toHaveBeenCalledWith('at-1', 'https://example.com/page', 'URL_DELETED');
    expect(publisher.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'google.indexing.notified',
        payload: expect.objectContaining({ type: 'URL_DELETED' }),
      }),
    );
  });
});
