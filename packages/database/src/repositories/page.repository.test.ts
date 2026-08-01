import { describe, expect, it } from 'vitest';
import type { Page, PrismaClient } from '@prisma/client';
import { PageRepository } from './page.repository.js';

function makePage(overrides: Partial<Page> = {}): Page {
  return {
    id: 'page-1',
    crawlJobId: 'job-1',
    storeId: 'store-1',
    url: 'https://acme.myshopify.com/',
    finalUrl: null,
    statusCode: null,
    contentType: null,
    charset: null,
    title: null,
    metaDescription: null,
    metaRobots: null,
    canonicalUrl: null,
    lang: null,
    favicon: null,
    themeColor: null,
    ogTags: null,
    twitterTags: null,
    robotsBlocked: false,
    redirectChain: null,
    h1: null,
    contentHash: null,
    wordCount: null,
    ttfbMs: null,
    responseTimeMs: null,
    pageSizeBytes: null,
    htmlSizeBytes: null,
    scriptCount: null,
    stylesheetCount: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

type PageMap = Map<string, Page>;

function makeFakePrisma(): { prisma: PrismaClient; pages: PageMap } {
  const pages: PageMap = new Map();
  const key = (crawlJobId: string, url: string) => `${crawlJobId}|${url}`;
  const prisma = {
    page: {
      upsert: async (args: {
        where: { crawlJobId_url: { crawlJobId: string; url: string } };
        update: Record<string, unknown>;
        create: Record<string, unknown>;
      }): Promise<Page> => {
        const k = key(args.where.crawlJobId_url.crawlJobId, args.where.crawlJobId_url.url);
        const existing = pages.get(k);
        if (existing !== undefined) {
          const updated = { ...existing, ...args.update } as Page;
          pages.set(k, updated);
          return updated;
        }
        const created = makePage({
          crawlJobId: args.where.crawlJobId_url.crawlJobId,
          url: args.where.crawlJobId_url.url,
          ...(args.create as Record<string, unknown>),
        }) as Page;
        pages.set(k, created);
        return created;
      },
      count: async (args: { where: { crawlJobId: string } }): Promise<number> =>
        [...pages.values()].filter((page) => page.crawlJobId === args.where.crawlJobId).length,
      findMany: async (args: {
        where: { crawlJobId: string };
        orderBy?: unknown;
        take?: number;
      }): Promise<Page[]> =>
        [...pages.values()]
          .filter((page) => page.crawlJobId === args.where.crawlJobId)
          .slice(0, args.take),
    },
  };
  return { prisma: prisma as unknown as PrismaClient, pages };
}

describe('PageRepository', () => {
  it('creates a page snapshot', async () => {
    const { prisma } = makeFakePrisma();
    const repo = new PageRepository(prisma);
    const page = await repo.upsert({
      crawlJobId: 'job-1',
      storeId: 'store-1',
      url: 'https://acme.myshopify.com/',
      statusCode: 200,
      title: 'Home',
    });
    expect(page.url).toBe('https://acme.myshopify.com/');
    expect(page.title).toBe('Home');
  });

  it('updates the existing snapshot for a re-crawled URL', async () => {
    const { prisma, pages } = makeFakePrisma();
    const repo = new PageRepository(prisma);
    const input = {
      crawlJobId: 'job-1',
      storeId: 'store-1',
      url: 'https://acme.myshopify.com/',
      statusCode: 200,
      title: 'Old',
    };
    await repo.upsert(input);
    const updated = await repo.upsert({ ...input, title: 'New', wordCount: 55 });
    expect(updated.title).toBe('New');
    expect(updated.wordCount).toBe(55);
    expect(pages.size).toBe(1);
  });

  it('counts pages per job', async () => {
    const { prisma } = makeFakePrisma();
    const repo = new PageRepository(prisma);
    const base = { crawlJobId: 'job-1', storeId: 'store-1' };
    await repo.upsert({ ...base, url: 'https://a.com/1' });
    await repo.upsert({ ...base, url: 'https://a.com/2' });
    await repo.upsert({ ...base, url: 'https://b.com/1', crawlJobId: 'job-2' });
    expect(await repo.countByJob('job-1')).toBe(2);
    expect(await repo.countByJob('job-2')).toBe(1);
  });

  it('lists pages for a job in url order', async () => {
    const { prisma } = makeFakePrisma();
    const repo = new PageRepository(prisma);
    const base = { crawlJobId: 'job-1', storeId: 'store-1' };
    await repo.upsert({ ...base, url: 'https://a.com/1' });
    await repo.upsert({ ...base, url: 'https://a.com/2' });
    const pages = await repo.listByJob('job-1');
    expect(pages).toHaveLength(2);
  });
});
