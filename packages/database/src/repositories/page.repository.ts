import type { Page, PrismaClient } from '@prisma/client';

export interface PageUpsertInput {
  crawlJobId: string;
  storeId: string;
  url: string;
  statusCode?: number;
  title?: string;
  metaDescription?: string;
  h1?: string;
  contentHash?: string;
  wordCount?: number;
}

/**
 * Persistence for crawled page snapshots, one row per URL per crawl job.
 * Re-crawling the same URL within a job updates the snapshot in place.
 */
export class PageRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async upsert(input: PageUpsertInput): Promise<Page> {
    return this.prisma.page.upsert({
      where: { crawlJobId_url: { crawlJobId: input.crawlJobId, url: input.url } },
      update: {
        statusCode: input.statusCode,
        title: input.title,
        metaDescription: input.metaDescription,
        h1: input.h1,
        contentHash: input.contentHash,
        wordCount: input.wordCount,
      },
      create: {
        crawlJobId: input.crawlJobId,
        storeId: input.storeId,
        url: input.url,
        statusCode: input.statusCode,
        title: input.title,
        metaDescription: input.metaDescription,
        h1: input.h1,
        contentHash: input.contentHash,
        wordCount: input.wordCount,
      },
    });
  }

  async countByJob(crawlJobId: string): Promise<number> {
    return this.prisma.page.count({ where: { crawlJobId } });
  }

  async listByJob(crawlJobId: string, take = 100): Promise<Page[]> {
    return this.prisma.page.findMany({
      where: { crawlJobId },
      orderBy: { url: 'asc' },
      take,
    });
  }
}
