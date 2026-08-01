import { describe, expect, it } from 'vitest';
import type { CrawlJob, Page, PageLink, PageStructuredData, PrismaClient, SeoIssue } from '@prisma/client';
import { CrawlStore } from './persistence.js';
import type { PageExtraction } from './types.js';

const NOW = new Date('2026-01-01T00:00:00Z');

function makeExtraction(overrides: Partial<PageExtraction> = {}): PageExtraction {
  return {
    url: 'https://acme.myshopify.com/products/hat',
    finalUrl: 'https://acme.myshopify.com/products/hat',
    statusCode: 200,
    contentType: 'text/html',
    charset: 'utf-8',
    redirectChain: [],
    robotsBlocked: false,
    title: 'Hats',
    metaDescription: 'Quality hats.',
    metaRobots: 'index,follow',
    canonicalUrl: 'https://acme.myshopify.com/products/hat',
    h1: ['Hats'],
    lang: 'en',
    favicon: '/favicon.ico',
    themeColor: null,
    ogTags: { 'og:title': 'Hats' },
    twitterTags: {},
    links: [
      { href: 'https://acme.myshopify.com/collections/all', anchorText: 'All', rel: null, isInternal: true, isImage: false },
    ],
    images: [],
    structuredData: [{ format: 'jsonld', schemaType: 'Product', valid: true, raw: { '@type': 'Product' } }],
    wordCount: 10,
    contentHash: 'abc123',
    performance: { ttfbMs: 10, responseTimeMs: 20, pageSizeBytes: 100, htmlSizeBytes: 90, scriptCount: 2, stylesheetCount: 1 },
    ...overrides,
  };
}

function makeFakePrisma(): {
  prisma: PrismaClient;
  pages: Map<string, Page>;
  links: PageLink[];
  structured: PageStructuredData[];
  issues: SeoIssue[];
  jobs: Map<string, CrawlJob>;
} {
  const pages = new Map<string, Page>();
  const links: PageLink[] = [];
  const structured: PageStructuredData[] = [];
  const issues: SeoIssue[] = [];
  const jobs = new Map<string, CrawlJob>();
  let jobCounter = 0;

  const prisma = {
    crawlJob: {
      create: async (args: { data: { storeId: string; seeds?: unknown } }): Promise<CrawlJob> => {
        const job = {
          id: `job-${++jobCounter}`,
          storeId: args.data.storeId,
          status: 'PENDING',
          totalPages: 0,
          seeds: args.data.seeds ?? null,
          statistics: null,
          error: null,
          createdAt: NOW,
          startedAt: null,
          finishedAt: null,
        } as CrawlJob;
        jobs.set(job.id, job);
        return job;
      },
      findUnique: async (args: { where: { id: string } }): Promise<CrawlJob | null> =>
        jobs.get(args.where.id) ?? null,
      update: async (args: { where: { id: string }; data: Partial<CrawlJob> }): Promise<CrawlJob> => {
        const existing = jobs.get(args.where.id);
        if (existing === undefined) throw new Error('not found');
        const updated = { ...existing, ...args.data } as CrawlJob;
        jobs.set(args.where.id, updated);
        return updated;
      },
    },
    page: {
      upsert: async (args: {
        where: { crawlJobId_url: { crawlJobId: string; url: string } };
        update: Record<string, unknown>;
        create: Record<string, unknown>;
      }): Promise<Page> => {
        const key = `${args.where.crawlJobId_url.crawlJobId}|${args.where.crawlJobId_url.url}`;
        const existing = pages.get(key);
        const record = {
          id: existing?.id ?? `page-${pages.size + 1}`,
          ...existing,
          ...args.update,
          ...args.create,
          crawlJobId: args.where.crawlJobId_url.crawlJobId,
          url: args.where.crawlJobId_url.url,
        } as Page;
        pages.set(key, record);
        return record;
      },
      count: async (args: { where: { crawlJobId: string } }): Promise<number> =>
        [...pages.values()].filter((p) => p.crawlJobId === args.where.crawlJobId).length,
      findMany: async (args: { where: { crawlJobId: string } }): Promise<Page[]> =>
        [...pages.values()].filter((p) => p.crawlJobId === args.where.crawlJobId),
    },
    pageLink: {
      createMany: async (args: { data: Array<Partial<PageLink>> }): Promise<{ count: number }> => {
        args.data.forEach((link) => {
          links.push({ id: `link-${links.length}`, createdAt: NOW, ...link } as PageLink);
        });
        return { count: args.data.length };
      },
    },
    pageStructuredData: {
      createMany: async (args: {
        data: Array<Partial<PageStructuredData>>;
      }): Promise<{ count: number }> => {
        args.data.forEach((block) => {
          structured.push({ id: `sd-${structured.length}`, createdAt: NOW, ...block } as PageStructuredData);
        });
        return { count: args.data.length };
      },
    },
    seoIssue: {
      createMany: async (args: { data: Array<Partial<SeoIssue>> }): Promise<{ count: number }> => {
        args.data.forEach((issue) => {
          issues.push({ id: `issue-${issues.length}`, createdAt: NOW, ...issue } as SeoIssue);
        });
        return { count: args.data.length };
      },
    },
  };
  return { prisma: prisma as unknown as PrismaClient, pages, links, structured, issues, jobs };
}

describe('CrawlStore', () => {
  it('creates a job with seeds and tracks the lifecycle', async () => {
    const { prisma, jobs } = makeFakePrisma();
    const store = new CrawlStore(prisma, { now: () => NOW });

    const job = await store.createJob('store-1', ['https://acme.myshopify.com/']);
    expect(job.status).toBe('PENDING');
    expect(job.seeds).toEqual(['https://acme.myshopify.com/']);

    await store.markRunning(job.id);
    expect(jobs.get(job.id)?.status).toBe('RUNNING');
    expect(jobs.get(job.id)?.startedAt).toEqual(NOW);

    const statistics = {
      pagesCrawled: 3,
      pagesFailed: 0,
      pagesBlocked: 1,
      totalIssues: 4,
      brokenLinks: 1,
      averageResponseTimeMs: 50,
      totalBytes: 300,
      durationMs: 100,
    };
    await store.completeJob(job.id, statistics);
    const finished = jobs.get(job.id);
    expect(finished?.status).toBe('COMPLETED');
    expect(finished?.finishedAt).toEqual(NOW);
    expect(finished?.totalPages).toBe(4);
  });

  it('marks a job failed with an error', async () => {
    const { prisma, jobs } = makeFakePrisma();
    const store = new CrawlStore(prisma, { now: () => NOW });
    const job = await store.createJob('store-1', []);
    await store.failJob(job.id, 'boom');
    expect(jobs.get(job.id)?.status).toBe('FAILED');
    expect(jobs.get(job.id)?.error).toBe('boom');
  });

  it('uses the real clock when no clock is injected', async () => {
    const { prisma, jobs } = makeFakePrisma();
    const store = new CrawlStore(prisma);
    const job = await store.createJob('store-1', []);
    await store.markRunning(job.id);
    expect(jobs.get(job.id)?.status).toBe('RUNNING');
    expect(jobs.get(job.id)?.startedAt).not.toBeNull();
  });

  it('upserts page snapshots with rich fields', async () => {
    const { prisma, pages } = makeFakePrisma();
    const store = new CrawlStore(prisma);
    const extraction = makeExtraction();

    const page = await store.upsertPage('job-1', 'store-1', extraction);
    expect(page.title).toBe('Hats');
    expect(page.wordCount).toBe(10);
    expect(page.scriptCount).toBe(2);
    expect(page.canonicalUrl).toBe('https://acme.myshopify.com/products/hat');
    expect(page.h1).toBe('Hats');
    expect(page.robotsBlocked).toBe(false);

    const updated = await store.upsertPage('job-1', 'store-1', makeExtraction({ title: 'Better Hats' }));
    expect(pages.size).toBe(1);
    expect(updated.title).toBe('Better Hats');
  });

  it('persists redirect chains and null tag maps as database null', async () => {
    const { prisma, pages } = makeFakePrisma();
    const store = new CrawlStore(prisma);

    const redirected = makeExtraction({
      redirectChain: ['https://acme.myshopify.com/a', 'https://acme.myshopify.com/b'],
    });
    const page = await store.upsertPage('job-1', 'store-1', redirected);
    expect(page.redirectChain).toEqual([
      'https://acme.myshopify.com/a',
      'https://acme.myshopify.com/b',
    ]);

    const bare = await store.upsertPage(
      'job-1',
      'store-1',
      makeExtraction({
        ogTags: null as unknown as Record<string, string>,
        twitterTags: undefined as unknown as Record<string, string>,
      }),
    );
    expect(bare.url).toBe('https://acme.myshopify.com/products/hat');
    expect(pages.has('job-1|https://acme.myshopify.com/products/hat')).toBe(true);
  });

  it('persists links, structured data and issues', async () => {
    const { prisma, links, structured, issues } = makeFakePrisma();
    const store = new CrawlStore(prisma);
    const extraction = makeExtraction();

    const page = await store.upsertPage('job-1', 'store-1', extraction);
    await store.saveLinks(page.id, extraction.links);
    await store.saveStructuredData(page.id, extraction.structuredData);
    await store.saveIssues(page.id, [
      {
        rule: 'missing-title',
        severity: 'HIGH',
        message: 'no title',
        details: {},
        evidence: extraction.url,
      },
    ]);

    expect(links).toHaveLength(1);
    expect(links[0]?.href).toBe('https://acme.myshopify.com/collections/all');
    expect(links[0]?.isInternal).toBe(true);
    expect(structured).toHaveLength(1);
    expect(structured[0]?.schemaType).toBe('Product');
    expect(issues).toHaveLength(1);
    expect(issues[0]?.severity).toBe('HIGH');
  });

  it('skips empty link/issue writes', async () => {
    const { prisma, links, issues, structured } = makeFakePrisma();
    const store = new CrawlStore(prisma);
    await store.saveLinks('page-1', []);
    await store.saveIssues('page-1', []);
    await store.saveStructuredData('page-1', []);
    expect(links).toHaveLength(0);
    expect(issues).toHaveLength(0);
    expect(structured).toHaveLength(0);
  });

  it('counts and lists pages for a job', async () => {
    const { prisma } = makeFakePrisma();
    const store = new CrawlStore(prisma);
    await store.upsertPage('job-1', 'store-1', makeExtraction({ url: 'https://a.com/1' }));
    await store.upsertPage('job-1', 'store-1', makeExtraction({ url: 'https://a.com/2' }));
    expect(await store.countPagesByJob('job-1')).toBe(2);
    expect(await store.listPagesByJob('job-1')).toHaveLength(2);
    expect(await store.listPagesByJob('job-other')).toHaveLength(0);
  });

  it('gets a job by id', async () => {
    const { prisma } = makeFakePrisma();
    const store = new CrawlStore(prisma);
    const job = await store.createJob('store-1', []);
    expect((await store.getJob(job.id))?.id).toBe(job.id);
    expect(await store.getJob('nope')).toBeNull();
  });
});
