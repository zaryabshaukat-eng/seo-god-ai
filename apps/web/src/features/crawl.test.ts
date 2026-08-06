import { describe, expect, it } from 'vitest';
import { renderToString } from '../vdom.js';
import type { Crawl } from '../types.js';
import { crawlStatusTone, crawlStats, createCrawlApi, renderCrawlDetailPage, renderCrawlsPage, validateStartCrawlInput } from './crawl.js';

const CRAWL: Crawl = {
  id: 'crawl-1',
  storeId: 'store-1',
  status: 'completed',
  pages: 120,
  issues: 3,
  startedAt: 1700000000000,
  error: undefined,
};

describe('validateStartCrawlInput', () => {
  it('accepts a store id', () => {
    expect(validateStartCrawlInput({ storeId: 's1' })).toEqual({});
  });

  it('rejects an empty store id', () => {
    expect(validateStartCrawlInput({ storeId: ' ' }).storeId).toBe('Store ID is required.');
  });
});

describe('crawlStatusTone', () => {
  it('maps each status to a tone', () => {
    expect(crawlStatusTone('completed')).toBe('success');
    expect(crawlStatusTone('running')).toBe('info');
    expect(crawlStatusTone('queued')).toBe('info');
    expect(crawlStatusTone('paused')).toBe('warning');
    expect(crawlStatusTone('failed')).toBe('danger');
    expect(crawlStatusTone('cancelled')).toBe('danger');
    expect(crawlStatusTone('unknown' as never)).toBe('neutral');
  });
});

describe('crawlStats', () => {
  it('builds KPI cards', () => {
    const stats = crawlStats(CRAWL);
    expect(stats).toHaveLength(3);
    expect(stats[0]).toMatchObject({ id: 'pages', value: '120' });
    expect(stats[1]).toMatchObject({ id: 'issues', tone: 'warning' });
    expect(stats[2]).toMatchObject({ id: 'status', value: 'completed', tone: 'success' });
  });

  it('marks a clean crawl as successful', () => {
    expect(crawlStats({ ...CRAWL, issues: 0 })[1]).toMatchObject({ id: 'issues', tone: 'success' });
  });
});

describe('renderCrawlsPage', () => {
  it('renders the table and start form for writers', () => {
    const html = renderToString(
      renderCrawlsPage({
        crawls: [CRAWL],
        canWrite: true,
        startInput: { storeId: 's1' },
        startErrors: { storeId: 'Store ID is required.' },
        error: 'Failed',
      }),
    );
    expect(html).toContain('id="crawls-table"');
    expect(html).toContain('id="start-crawl-form"');
    expect(html).toContain('>crawl-1</td>');
    expect(html).toContain('badge--success');
    expect(html).toContain('>Failed</p>');
  });

  it('hides the start form for readers and shows an empty state', () => {
    const html = renderToString(renderCrawlsPage({ crawls: [], canWrite: false, startInput: { storeId: '' }, startErrors: {} }));
    expect(html).not.toContain('start-crawl-form');
    expect(html).toContain('No crawls yet. Start your first crawl.');
  });
});

describe('renderCrawlDetailPage', () => {
  it('renders stats and an error', () => {
    const html = renderToString(renderCrawlDetailPage({ ...CRAWL, error: 'boom' }));
    expect(html).toContain('Crawl crawl-1');
    expect(html).toContain('kpi-card');
    expect(html).toContain('>boom</p>');
  });

  it('renders without an error', () => {
    const html = renderToString(renderCrawlDetailPage(CRAWL));
    expect(html).not.toContain('role="alert"');
  });
});

describe('createCrawlApi', () => {
  it('wraps crawl endpoints onto the client', async () => {
    const calls: Array<{ method: string; url: string; body: unknown }> = [];
    const api = {
      request: async <T>(method: string, url: string, body: unknown): Promise<T> => {
        calls.push({ method, url, body });
        return { ok: true } as T;
      },
    } as never;
    const crawlApi = createCrawlApi(api);
    await crawlApi.list();
    await crawlApi.start('s1');
    await crawlApi.get('crawl-1');
    await crawlApi.cancel('crawl-1');
    expect(calls).toEqual([
      { method: 'GET', url: '/api/v1/crawls', body: undefined },
      { method: 'POST', url: '/api/v1/crawls', body: { storeId: 's1' } },
      { method: 'GET', url: '/api/v1/crawls/crawl-1', body: undefined },
      { method: 'POST', url: '/api/v1/crawls/crawl-1/cancel', body: undefined },
    ]);
  });
});
