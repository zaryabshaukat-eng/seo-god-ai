import type { CrawlJob, CrawlStatus, PrismaClient } from '@prisma/client';
import { NotFoundError } from '@seogod/core';

export interface CrawlJobCreateInput {
  storeId: string;
}

/**
 * Persistence for crawl runs. A job tracks the lifecycle of one crawl over
 * a store: PENDING -> RUNNING -> COMPLETED/FAILED/CANCELLED.
 */
export class CrawlJobRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(input: CrawlJobCreateInput): Promise<CrawlJob> {
    return this.prisma.crawlJob.create({ data: { storeId: input.storeId } });
  }

  async get(id: string): Promise<CrawlJob | null> {
    return this.prisma.crawlJob.findUnique({ where: { id } });
  }

  async getOrThrow(id: string): Promise<CrawlJob> {
    const job = await this.get(id);
    if (job === null) {
      throw new NotFoundError(`Crawl job "${id}" not found`, {
        module: 'database',
        operation: 'crawlJob.getOrThrow',
        context: { crawlJobId: id },
      });
    }
    return job;
  }

  async markRunning(id: string): Promise<CrawlJob> {
    return this.prisma.crawlJob.update({
      where: { id },
      data: { status: 'RUNNING', startedAt: new Date() },
    });
  }

  async markFinished(
    id: string,
    status: Extract<CrawlStatus, 'COMPLETED' | 'FAILED' | 'CANCELLED'>,
    totalPages?: number,
  ): Promise<CrawlJob> {
    return this.prisma.crawlJob.update({
      where: { id },
      data: { status, finishedAt: new Date(), totalPages },
    });
  }

  async listRecent(storeId: string, take = 20): Promise<CrawlJob[]> {
    return this.prisma.crawlJob.findMany({
      where: { storeId },
      orderBy: { createdAt: 'desc' },
      take,
    });
  }
}
