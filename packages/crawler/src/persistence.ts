import {
  Prisma,
  type CrawlJob,
  type Page,
  type PrismaClient,
  type Severity,
} from '@prisma/client';
import type {
  CrawlStatistics,
  PageExtraction,
  PageLinkData,
  SeoIssue,
  StructuredDataBlock,
} from './types.js';

export interface CrawlStoreOptions {
  now?: () => Date;
}

/**
 * Persistence layer for crawl runs. Writes the CrawlJob lifecycle and the
 * rich page snapshot (metadata, links, structured data, issues, performance)
 * introduced for the crawler. Like the audit and events packages, it owns a
 * Prisma client; no other part of the platform touches the datastore.
 */
export class CrawlStore {
  private readonly now: () => Date;

  constructor(
    private readonly prisma: PrismaClient,
    options: CrawlStoreOptions = {},
  ) {
    this.now = options.now ?? (() => new Date());
  }

  async createJob(storeId: string, seeds: string[]): Promise<CrawlJob> {
    return this.prisma.crawlJob.create({
      data: {
        storeId,
        seeds: seeds.length > 0 ? seeds : Prisma.JsonNull,
      },
    });
  }

  async getJob(id: string): Promise<CrawlJob | null> {
    return this.prisma.crawlJob.findUnique({ where: { id } });
  }

  async markRunning(id: string): Promise<CrawlJob> {
    return this.prisma.crawlJob.update({
      where: { id },
      data: { status: 'RUNNING', startedAt: this.now() },
    });
  }

  async completeJob(id: string, statistics: CrawlStatistics): Promise<CrawlJob> {
    return this.prisma.crawlJob.update({
      where: { id },
      data: {
        status: 'COMPLETED',
        finishedAt: this.now(),
        totalPages: statistics.pagesCrawled + statistics.pagesBlocked,
        statistics: statistics as unknown as Prisma.InputJsonValue,
      },
    });
  }

  async failJob(id: string, error: string): Promise<CrawlJob> {
    return this.prisma.crawlJob.update({
      where: { id },
      data: { status: 'FAILED', finishedAt: this.now(), error },
    });
  }

  /** Upserts the page snapshot keyed on (crawlJobId, url). */
  async upsertPage(
    crawlJobId: string,
    storeId: string,
    extraction: PageExtraction,
  ): Promise<Page> {
    const fields = this.pageFields(extraction);
    return this.prisma.page.upsert({
      where: { crawlJobId_url: { crawlJobId, url: extraction.url } },
      update: fields,
      create: {
        ...(fields as unknown as Prisma.PageUncheckedCreateInput),
        crawlJobId,
        storeId,
        url: extraction.url,
      },
    });
  }

  async saveLinks(pageId: string, links: PageLinkData[]): Promise<void> {
    if (links.length === 0) return;
    await this.prisma.pageLink.createMany({
      data: links.map((link) => ({
        pageId,
        href: link.href,
        anchorText: link.anchorText,
        rel: link.rel,
        isInternal: link.isInternal,
        isImage: link.isImage,
      })),
    });
  }

  async saveStructuredData(pageId: string, blocks: StructuredDataBlock[]): Promise<void> {
    if (blocks.length === 0) return;
    await this.prisma.pageStructuredData.createMany({
      data: blocks.map((block) => ({
        pageId,
        format: block.format,
        schemaType: block.schemaType,
        valid: block.valid,
        raw: block.raw as Prisma.InputJsonValue,
      })),
    });
  }

  async saveIssues(pageId: string, issues: SeoIssue[]): Promise<void> {
    if (issues.length === 0) return;
    await this.prisma.seoIssue.createMany({
      data: issues.map((issue) => ({
        pageId,
        rule: issue.rule,
        severity: issue.severity as Severity,
        message: issue.message,
        details: issue.details as Prisma.InputJsonValue,
      })),
    });
  }

  async countPagesByJob(crawlJobId: string): Promise<number> {
    return this.prisma.page.count({ where: { crawlJobId } });
  }

  async listPagesByJob(crawlJobId: string, take = 1000): Promise<Page[]> {
    return this.prisma.page.findMany({
      where: { crawlJobId },
      orderBy: { url: 'asc' },
      take,
    });
  }

  private pageFields(extraction: PageExtraction): Prisma.PageUncheckedUpdateInput {
    const { performance } = extraction;
    return {
      finalUrl: extraction.finalUrl,
      statusCode: extraction.statusCode,
      contentType: extraction.contentType,
      charset: extraction.charset,
      title: extraction.title,
      metaDescription: extraction.metaDescription,
      metaRobots: extraction.metaRobots,
      canonicalUrl: extraction.canonicalUrl,
      lang: extraction.lang,
      favicon: extraction.favicon,
      themeColor: extraction.themeColor,
      ogTags: emptyToDbNull(extraction.ogTags),
      twitterTags: emptyToDbNull(extraction.twitterTags),
      robotsBlocked: extraction.robotsBlocked,
      redirectChain:
        extraction.redirectChain.length > 0
          ? extraction.redirectChain
          : Prisma.DbNull,
      h1: extraction.h1[0] ?? null,
      contentHash: extraction.contentHash,
      wordCount: extraction.wordCount,
      ttfbMs: performance.ttfbMs,
      responseTimeMs: performance.responseTimeMs,
      pageSizeBytes: performance.pageSizeBytes,
      htmlSizeBytes: performance.htmlSizeBytes,
      scriptCount: performance.scriptCount,
      stylesheetCount: performance.stylesheetCount,
    };
  }
}

function emptyToDbNull(
  value: Record<string, string> | null | undefined,
): Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput {
  if (value === null || value === undefined) return Prisma.DbNull;
  return Object.keys(value).length === 0
    ? Prisma.DbNull
    : (value as unknown as Prisma.InputJsonValue);
}
