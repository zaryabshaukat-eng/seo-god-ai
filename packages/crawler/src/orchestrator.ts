import type { Prisma, PrismaClient } from '@prisma/client';
import type { EventBus } from '@seogod/events';
import type { Logger } from '@seogod/logging';
import type { MetricsRegistry } from '@seogod/monitoring';
import { Fetcher } from './fetcher.js';
import { CrawlMetrics } from './metrics.js';
import { CrawlStore } from './persistence.js';
import {
  CrawlScheduler,
  type CrawlSchedulerOptions,
} from './scheduler.js';
import type { CrawlResult, CrawlStatistics } from './types.js';
import { RobotsStore } from './utils/robots.js';

export interface CrawlOrchestratorOptions extends CrawlSchedulerOptions {
  /** Request timeout for a single page fetch. */
  fetchTimeoutMs?: number;
  /** Retries per page before it is recorded as failed. */
  maxRetries?: number;
}

export interface CrawlOrchestratorDependencies {
  prisma: PrismaClient;
  logger: Logger;
  metrics: MetricsRegistry;
  /** Outbox event bus; crawler events are skipped when omitted. */
  eventBus?: EventBus;
  fetchImpl?: typeof fetch;
  /** Clock injection for deterministic tests. */
  now?: () => Date;
}

const FAILED_STATISTICS: CrawlStatistics = {
  pagesCrawled: 0,
  pagesFailed: 0,
  pagesBlocked: 0,
  totalIssues: 0,
  brokenLinks: 0,
  averageResponseTimeMs: 0,
  totalBytes: 0,
  durationMs: 0,
};

/**
 * Entry point for running crawls. Owns the CrawlJob lifecycle, wires the
 * scheduler's dependencies together from platform primitives, and emits
 * `crawl.completed` / `crawl.failed` events through the outbox (best-effort:
 * a publishing failure is logged but never fails the crawl).
 */
export class CrawlOrchestrator {
  private readonly schedulerOptions: CrawlSchedulerOptions;
  private readonly fetchTimeoutMs: number;
  private readonly maxRetries: number;
  private readonly nowMs: () => number;

  constructor(
    private readonly deps: CrawlOrchestratorDependencies,
    options: CrawlOrchestratorOptions,
  ) {
    this.schedulerOptions = {
      userAgent: options.userAgent,
      concurrency: options.concurrency,
      respectRobotsTxt: options.respectRobotsTxt,
      maxPages: options.maxPages,
      queueMaxSize: options.queueMaxSize,
      maxDepth: options.maxDepth,
      rateLimitMs: options.rateLimitMs,
    };
    this.fetchTimeoutMs = options.fetchTimeoutMs ?? 10_000;
    this.maxRetries = options.maxRetries ?? 3;
    this.nowMs = () => (this.deps.now?.() ?? new Date()).getTime();
  }

  /** Runs a crawl for `storeId`, returning the persisted job outcome. */
  async crawl(storeId: string, seeds: string[]): Promise<CrawlResult> {
    const store = new CrawlStore(this.deps.prisma, { now: this.deps.now });
    const job = await store.createJob(storeId, seeds);

    const scheduler = this.buildScheduler(store);
    try {
      const statistics = await scheduler.run(job.id, storeId, seeds);
      await store.completeJob(job.id, statistics);
      await this.publishEvent('crawl.completed', job.id, { storeId, statistics });
      return { crawlJobId: job.id, storeId, status: 'COMPLETED', statistics, error: null };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'crawl failed';
      await store.failJob(job.id, message);
      await this.publishEvent('crawl.failed', job.id, { storeId, error: message });
      return { crawlJobId: job.id, storeId, status: 'FAILED', statistics: FAILED_STATISTICS, error: message };
    }
  }

  private buildScheduler(store: CrawlStore): CrawlScheduler {
    const fetchImpl = this.deps.fetchImpl ?? fetch;
    const fetcher = new Fetcher({
      userAgent: this.schedulerOptions.userAgent,
      timeoutMs: this.fetchTimeoutMs,
      maxRetries: this.maxRetries,
      fetchImpl,
      now: this.nowMs,
    });
    const robotsStore = new RobotsStore({ fetchImpl, now: this.nowMs });
    return new CrawlScheduler(
      {
        store,
        fetcher,
        robotsStore,
        metrics: new CrawlMetrics(this.deps.metrics),
        logger: this.deps.logger,
        now: this.nowMs,
      },
      this.schedulerOptions,
    );
  }

  private async publishEvent(
    type: 'crawl.completed' | 'crawl.failed',
    crawlJobId: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    if (this.deps.eventBus === undefined) return;
    try {
      await this.deps.eventBus.publish({
        type,
        aggregateType: 'crawlJob',
        aggregateId: crawlJobId,
        payload: payload as unknown as Prisma.InputJsonValue,
      });
    } catch (err) {
      this.deps.logger.warn({ err, type, crawlId: crawlJobId }, 'crawl.event-publish-failed');
    }
  }
}
