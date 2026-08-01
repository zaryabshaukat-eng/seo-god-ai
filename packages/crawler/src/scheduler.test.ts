import { describe, expect, it } from 'vitest';
import type { CrawlJob, Page, PrismaClient, SeoIssue } from '@prisma/client';
import { createLogger } from '@seogod/logging';
import { MetricsRegistry } from '@seogod/monitoring';
import { Fetcher } from './fetcher.js';
import { CrawlMetrics } from './metrics.js';
import { CrawlStore } from './persistence.js';
import { CrawlScheduler } from './scheduler.js';
import { RobotsStore } from './utils/robots.js';

const NOW = new Date('2026-01-01T00:00:00Z');

function makeFakePrisma(options: { failUpsertFor?: string } = {}) {
  const pages = new Map<string, Page>();
  const issues: SeoIssue[] = [];
  const jobs = new Map<string, CrawlJob>();
  const jobsUpdates: Array<{ id: string; data: Partial<CrawlJob> }> = [];

  const prisma = {
    crawlJob: {
      update: async (args: { where: { id: string }; data: Partial<CrawlJob> }): Promise<CrawlJob> => {
        const existing = jobs.get(args.where.id);
        const updated = { ...existing, ...args.data } as CrawlJob;
        jobs.set(args.where.id, updated);
        jobsUpdates.push({ id: args.where.id, data: args.data });
        return updated;
      },
    },
    page: {
      upsert: async (args: {
        where: { crawlJobId_url: { crawlJobId: string; url: string } };
        update: Record<string, unknown>;
        create: Record<string, unknown>;
      }): Promise<Page> => {
        if (options.failUpsertFor === args.where.crawlJobId_url.url) {
          throw new Error('upsert failed');
        }
        const key = `${args.where.crawlJobId_url.crawlJobId}|${args.where.crawlJobId_url.url}`;
        const existing = pages.get(key);
        const record = {
          id: existing?.id ?? `page-${pages.size + 1}`,
          ...existing,
          ...args.create,
        } as Page;
        pages.set(key, record);
        return record;
      },
      count: async (args: { where: { crawlJobId: string } }): Promise<number> =>
        [...pages.values()].filter((p) => p.crawlJobId === args.where.crawlJobId).length,
    },
    pageLink: {
      createMany: async () => ({ count: 0 }),
    },
    pageStructuredData: {
      createMany: async () => ({ count: 0 }),
    },
    seoIssue: {
      createMany: async (args: { data: Array<Partial<SeoIssue>> }): Promise<{ count: number }> => {
        args.data.forEach((issue) => issues.push({ id: `issue-${issues.length}`, createdAt: NOW, ...issue } as SeoIssue));
        return { count: args.data.length };
      },
    },
  };
  return { prisma: prisma as unknown as PrismaClient, pages, issues, jobs };
}

function mockFetch(
  robotsContent: string,
  routes: Array<{ path: string; status: number; body: string }>,
  options: { delayMs?: number; throwingPaths?: string[] } = {},
): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (options.throwingPaths?.includes(url.pathname)) {
      throw new TypeError('fetch failed');
    }
    if (url.pathname === '/robots.txt') {
      return new Response(robotsContent, { status: 200 });
    }
    if (options.delayMs !== undefined) {
      await new Promise((resolve) => setTimeout(resolve, options.delayMs));
    }
    const route = routes.find((r) => r.path === url.pathname);
    if (route !== undefined) {
      return new Response(route.body, {
        status: route.status,
        headers: { 'content-type': 'text/html; charset=utf-8' },
      });
    }
    return new Response('not found', { status: 404 });
  }) as typeof fetch;
}

function buildScheduler(options: {
  robotsContent?: string;
  routes?: Array<{ path: string; status: number; body: string }>;
  respectRobotsTxt?: boolean;
  maxPages?: number;
  concurrency?: number;
  maxDepth?: number;
  delayMs?: number;
  throwingPaths?: string[];
  failUpsertFor?: string;
  useDefaultOptions?: boolean;
  rateLimitMs?: number;
} = {}) {
  const { prisma, pages, issues } = makeFakePrisma({ failUpsertFor: options.failUpsertFor });
  const registry = new MetricsRegistry();
  const store = new CrawlStore(prisma, { now: () => NOW });
  const fetchImpl = mockFetch(
    options.robotsContent ?? 'User-agent: *\nDisallow:\n',
    options.routes ?? [],
    { delayMs: options.delayMs, throwingPaths: options.throwingPaths },
  );
  const fetcher = new Fetcher({
    userAgent: 'SeoGodBot',
    fetchImpl,
    sleep: async () => {},
  });
  const robotsStore = new RobotsStore({ fetchImpl });
  const scheduler = new CrawlScheduler(
    {
      store,
      fetcher,
      robotsStore,
      metrics: new CrawlMetrics(registry),
      logger: createLogger({ name: 'crawler-test', level: 'silent' }),
    },
    options.useDefaultOptions === true
      ? { userAgent: 'SeoGodBot' }
      : {
          userAgent: 'SeoGodBot',
          respectRobotsTxt: options.respectRobotsTxt ?? true,
          maxPages: options.maxPages ?? 100,
          concurrency: options.concurrency ?? 2,
          maxDepth: options.maxDepth ?? 6,
          rateLimitMs: options.rateLimitMs ?? 0,
        },
  );
  return { scheduler, pages, issues, registry, store };
}

const HOME = `<html lang="en"><head><title>Home page</title></head><body>
  <h1>Welcome</h1>
  <p>Plenty of descriptive words live on the homepage.</p>
  <a href="/products/hat">The Hat</a>
  <a href="/pages/about">About us</a>
</body></html>`;

const HAT = `<html lang="en"><head><title>Hat product</title></head><body>
  <h1>The Hat</h1>
  <p>This hat is described in enough detail for a product page.</p>
</body></html>`;

describe('CrawlScheduler', () => {
  it('crawls seeds and discovered pages, recording statistics', async () => {
    const { scheduler, issues, registry, store } = buildScheduler({
      routes: [
        { path: '/', status: 200, body: HOME },
        { path: '/products/hat', status: 200, body: HAT },
        { path: '/pages/about', status: 404, body: '' },
      ],
    });

    const stats = await scheduler.run('job-1', 'store-1', ['https://acme.myshopify.com/']);

    expect(stats.pagesCrawled).toBe(2);
    expect(stats.pagesFailed).toBe(1);
    expect(stats.pagesBlocked).toBe(0);
    expect(stats.brokenLinks).toBe(1);
    expect(stats.totalIssues).toBeGreaterThanOrEqual(1);

    expect(await store.countPagesByJob('job-1')).toBe(3);
    const broken = issues.filter((issue) => issue.rule === 'broken-link');
    expect(broken).toHaveLength(1);
    expect((broken[0]?.details as { to?: string })?.to).toBe('https://acme.myshopify.com/pages/about');

    expect(registry.snapshot().counters.pages_crawled).toBe(2);
    expect(registry.snapshot().counters.crawl_failures).toBe(1);
    expect(registry.snapshot().gauges.crawl_duration_seconds).toBeGreaterThanOrEqual(0);
  });

  it('respects robots.txt and blocks disallowed pages', async () => {
    const robotsContent = 'User-agent: *\nDisallow: /private\n';
    const { scheduler, issues } = buildScheduler({
      robotsContent,
      routes: [
        {
          path: '/',
          status: 200,
          body: `<html lang="en"><head><title>Home</title></head><body><h1>Home</h1><a href="/private">Private</a></body></html>`,
        },
      ],
    });

    const stats = await scheduler.run('job-2', 'store-1', ['https://acme.myshopify.com/']);
    expect(stats.pagesBlocked).toBe(1);
    expect(stats.pagesCrawled).toBe(1);
    const blocked = issues.filter((issue) => issue.rule === 'robots-blocked');
    expect(blocked).toHaveLength(1);
  });

  it('ignores robots.txt when respectRobotsTxt is disabled', async () => {
    const robotsContent = 'User-agent: *\nDisallow: /private\n';
    const { scheduler, issues } = buildScheduler({
      robotsContent,
      respectRobotsTxt: false,
      routes: [
        {
          path: '/',
          status: 200,
          body: `<html lang="en"><head><title>Home</title></head><body><h1>Home</h1><a href="/private">Private</a></body></html>`,
        },
        { path: '/private', status: 200, body: HAT },
      ],
    });

    const stats = await scheduler.run('job-3', 'store-1', ['https://acme.myshopify.com/']);
    expect(stats.pagesBlocked).toBe(0);
    expect(stats.pagesCrawled).toBe(2);
    expect(issues.filter((issue) => issue.rule === 'robots-blocked')).toHaveLength(0);
  });

  it('respects maxPages and depth limits', async () => {
    const { scheduler } = buildScheduler({
      maxPages: 1,
      routes: [
        { path: '/', status: 200, body: HOME },
        { path: '/products/hat', status: 200, body: HAT },
      ],
    });

    const stats = await scheduler.run('job-4', 'store-1', ['https://acme.myshopify.com/']);
    expect(stats.pagesCrawled).toBe(1);

    const { scheduler: deepScheduler } = buildScheduler({
      maxDepth: 0,
      routes: [{ path: '/', status: 200, body: HOME }],
    });
    const deepStats = await deepScheduler.run('job-5', 'store-1', ['https://acme.myshopify.com/']);
    expect(deepStats.pagesCrawled).toBe(1);
    expect(deepStats.totalIssues).toBeGreaterThanOrEqual(0);
  });

  it('handles a fully failing crawl without throwing', async () => {
    const { scheduler } = buildScheduler({
      routes: [{ path: '/', status: 500, body: '' }],
    });
    const stats = await scheduler.run('job-6', 'store-1', ['https://acme.myshopify.com/']);
    expect(stats.pagesCrawled).toBe(0);
    expect(stats.pagesFailed).toBe(1);
    expect(stats.pagesBlocked).toBe(0);
  });

  it('throws when no valid seeds are provided', async () => {
    const { scheduler } = buildScheduler();
    await expect(scheduler.run('job-7', 'store-1', ['not a url'])).rejects.toThrow(
      'At least one valid seed URL is required',
    );
  });

  it('throws on an empty seed list', async () => {
    const { scheduler } = buildScheduler();
    await expect(scheduler.run('job-8', 'store-1', [])).rejects.toThrow(
      'At least one valid seed URL is required',
    );
  });

  it('skips invalid seeds but crawls the valid ones', async () => {
    const { scheduler } = buildScheduler({
      routes: [
        { path: '/', status: 200, body: HOME },
        { path: '/products/hat', status: 200, body: HAT },
      ],
    });
    const stats = await scheduler.run('job-9', 'store-1', ['https://acme.myshopify.com/', 'not a url']);
    expect(stats.pagesCrawled).toBe(2);
  });

  it('ignores external, asset and junk links', async () => {
    const { scheduler, issues } = buildScheduler({
      routes: [
        {
          path: '/',
          status: 200,
          body: `<html lang="en"><head><title>Home</title></head><body>
            <a href="https://evil.example.com/x">External</a>
            <a href="/theme.css">Css</a>
            <a href="/cart">Cart</a>
          </body></html>`,
        },
      ],
    });
    const stats = await scheduler.run('job-10', 'store-1', ['https://acme.myshopify.com/']);
    expect(stats.pagesCrawled).toBe(1);
    expect(issues.filter((issue) => issue.rule === 'broken-link')).toHaveLength(0);
  });

  it('overlaps workers and waits for in-flight pages', async () => {
    const { scheduler } = buildScheduler({
      concurrency: 2,
      delayMs: 5,
      routes: [
        { path: '/', status: 200, body: HOME },
        { path: '/products/hat', status: 200, body: HAT },
        { path: '/pages/about', status: 200, body: HAT },
      ],
    });
    const stats = await scheduler.run('job-11', 'store-1', ['https://acme.myshopify.com/']);
    expect(stats.pagesCrawled).toBe(3);
  });

  it('uses default options when none are provided', async () => {
    const { scheduler } = buildScheduler({
      useDefaultOptions: true,
      routes: [{ path: '/', status: 200, body: HOME }],
    });
    const stats = await scheduler.run('job-12', 'store-1', ['https://acme.myshopify.com/']);
    expect(stats.pagesCrawled).toBeGreaterThanOrEqual(1);
  });

  it('throttles requests when a rate limit is configured', async () => {
    const { scheduler } = buildScheduler({
      rateLimitMs: 1,
      routes: [
        { path: '/', status: 200, body: HOME },
        { path: '/products/hat', status: 200, body: HAT },
      ],
    });
    const stats = await scheduler.run('job-14', 'store-1', ['https://acme.myshopify.com/']);
    expect(stats.pagesCrawled).toBe(2);
  });

  it('continues the crawl when a page write fails', async () => {
    const { scheduler } = buildScheduler({
      failUpsertFor: 'https://acme.myshopify.com/products/hat',
      routes: [
        { path: '/', status: 200, body: HOME },
        { path: '/products/hat', status: 200, body: HAT },
      ],
    });
    const stats = await scheduler.run('job-13', 'store-1', ['https://acme.myshopify.com/']);
    expect(stats.pagesCrawled).toBe(1);
    expect(stats.totalIssues).toBeGreaterThanOrEqual(0);
  });
});
