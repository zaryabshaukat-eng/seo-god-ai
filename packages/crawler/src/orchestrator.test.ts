import { describe, expect, it, vi } from 'vitest';
import type { CrawlJob, Page, PrismaClient } from '@prisma/client';
import { createLogger } from '@seogod/logging';
import { MetricsRegistry } from '@seogod/monitoring';
import type { EventBus } from '@seogod/events';
import { CrawlOrchestrator } from './orchestrator.js';

const NOW = new Date('2026-01-01T00:00:00Z');

function makeFakePrisma() {
  const jobs = new Map<string, CrawlJob>();
  const jobUpdates: Array<{ id: string; data: Partial<CrawlJob> }> = [];

  const prisma = {
    crawlJob: {
      create: async (args: { data: { storeId: string; seeds: unknown } }): Promise<CrawlJob> => {
        const job = {
          id: `job-${jobs.size + 1}`,
          storeId: args.data.storeId,
          status: 'PENDING',
          seeds: args.data.seeds,
          startedAt: null,
          finishedAt: null,
          totalPages: null,
          statistics: null,
          error: null,
          createdAt: NOW,
        } as unknown as CrawlJob;
        jobs.set(job.id, job);
        return job;
      },
      update: async (args: { where: { id: string }; data: Partial<CrawlJob> }): Promise<CrawlJob> => {
        const existing = jobs.get(args.where.id);
        const updated = { ...existing, ...args.data } as CrawlJob;
        jobs.set(args.where.id, updated);
        jobUpdates.push({ id: args.where.id, data: args.data });
        return updated;
      },
    },
    page: {
      upsert: async (args: {
        where: { crawlJobId_url: { crawlJobId: string; url: string } };
        update: Record<string, unknown>;
        create: Record<string, unknown>;
      }): Promise<Page> => {
        const record = { id: 'page-1', ...args.create } as Page;
        return record;
      },
      count: async (): Promise<number> => 1,
    },
    pageLink: { createMany: async () => ({ count: 0 }) },
    pageStructuredData: { createMany: async () => ({ count: 0 }) },
    seoIssue: { createMany: async () => ({ count: 0 }) },
  };
  return { prisma: prisma as unknown as PrismaClient, jobs, jobUpdates };
}

function mockFetch(
  robotsContent: string,
  routes: Array<{ path: string; status: number; body: string }>,
): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.pathname === '/robots.txt') {
      return new Response(robotsContent, { status: 200 });
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

const HOME = `<html lang="en"><head><title>Home page</title></head><body>
  <h1>Welcome</h1>
  <p>Plenty of descriptive words live on the homepage.</p>
</body></html>`;

function buildOrchestrator(options: {
  eventBus?: EventBus;
  throwOnPublish?: boolean;
  seeds?: string[];
  maxPages?: number;
} = {}) {
  const { prisma, jobs, jobUpdates } = makeFakePrisma();
  const registry = new MetricsRegistry();
  let publish;
  if (options.throwOnPublish === true) {
    publish = vi.fn().mockRejectedValue(new Error('outbox down'));
  } else {
    publish = vi.fn().mockResolvedValue({ id: 'event-1' });
  }
  const eventBus = options.eventBus ?? ({ publish } as unknown as EventBus);
  const fetchImpl = mockFetch('User-agent: *\nDisallow:\n', [
    { path: '/', status: 200, body: HOME },
  ]);
  const orchestrator = new CrawlOrchestrator(
    {
      prisma,
      logger: createLogger({ name: 'crawler-test', level: 'silent' }),
      metrics: registry,
      eventBus,
      fetchImpl,
      now: () => NOW,
    },
    {
      userAgent: 'SeoGodBot',
      respectRobotsTxt: true,
      maxPages: options.maxPages ?? 100,
      concurrency: 2,
      rateLimitMs: 0,
    },
  );
  return { orchestrator, jobs, jobUpdates, publish, prisma, fetchImpl };
}

describe('CrawlOrchestrator', () => {
  it('creates a job, crawls, completes it, and publishes crawl.completed', async () => {
    const { orchestrator, jobs, publish } = buildOrchestrator();
    const result = await orchestrator.crawl('store-1', ['https://acme.myshopify.com/']);

    expect(result.status).toBe('COMPLETED');
    expect(result.error).toBeNull();
    expect(result.statistics.pagesCrawled).toBeGreaterThanOrEqual(1);

    const job = jobs.get(result.crawlJobId);
    expect(job?.status).toBe('COMPLETED');
    expect(job?.totalPages).toBe(result.statistics.pagesCrawled);

    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'crawl.completed',
        aggregateType: 'crawlJob',
        aggregateId: result.crawlJobId,
      }),
    );
  });

  it('marks the job failed and publishes crawl.failed when the crawl errors', async () => {
    const { orchestrator, jobs, publish } = buildOrchestrator();
    const result = await orchestrator.crawl('store-1', ['not-a-valid-url']);

    expect(result.status).toBe('FAILED');
    expect(result.error).toBe('At least one valid seed URL is required');
    expect(result.statistics.pagesCrawled).toBe(0);

    const job = jobs.get(result.crawlJobId);
    expect(job?.status).toBe('FAILED');
    expect(job?.error).toBe('At least one valid seed URL is required');

    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'crawl.failed', aggregateId: result.crawlJobId }),
    );
  });

  it('still completes the job when event publishing fails', async () => {
    const { orchestrator, jobs, publish } = buildOrchestrator({ throwOnPublish: true });
    const result = await orchestrator.crawl('store-1', ['https://acme.myshopify.com/']);

    expect(result.status).toBe('COMPLETED');
    expect(publish).toHaveBeenCalled();
    expect(jobs.get(result.crawlJobId)?.status).toBe('COMPLETED');
  });

  it('skips event publishing when no event bus is wired', async () => {
    const { prisma, fetchImpl } = buildOrchestrator();
    const orchestrator = new CrawlOrchestrator(
      {
        prisma,
        logger: createLogger({ name: 'crawler-test', level: 'silent' }),
        metrics: new MetricsRegistry(),
        fetchImpl,
        now: () => NOW,
      },
      { userAgent: 'SeoGodBot' },
    );
    const result = await orchestrator.crawl('store-1', ['https://acme.myshopify.com/']);
    expect(result.status).toBe('COMPLETED');
  });

  it('falls back to the global fetch and real clock when not injected', async () => {
    const { prisma } = buildOrchestrator();
    const fetchImpl = mockFetch('User-agent: *\nDisallow:\n', [
      { path: '/', status: 200, body: HOME },
    ]);
    vi.stubGlobal('fetch', fetchImpl);
    try {
      const orchestrator = new CrawlOrchestrator(
        {
          prisma,
          logger: createLogger({ name: 'crawler-test', level: 'silent' }),
          metrics: new MetricsRegistry(),
        },
        { userAgent: 'SeoGodBot' },
      );
      const result = await orchestrator.crawl('store-1', ['https://acme.myshopify.com/']);
      expect(result.status).toBe('COMPLETED');
      expect(result.statistics.pagesCrawled).toBeGreaterThanOrEqual(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
