import { randomUUID } from 'node:crypto';
import type { Logger } from '@seogod/logging';
import { detectCrossPageIssues, detectPageIssues } from './detectors.js';
import type { PageLinkStatus } from './detectors.js';
import type { Fetcher, FetchResult } from './fetcher.js';
import type { CrawlMetrics } from './metrics.js';
import { parseHtml } from './parser.js';
import type { CrawlStore } from './persistence.js';
import { UrlQueue } from './queue.js';
import { RateLimiter } from './rate-limiter.js';
import type {
  CrawlStatistics,
  PageExtraction,
  PageLinkData,
  SeoIssue,
  UrlRecord,
} from './types.js';
import { getOrigin, isCrawlableUrl, makeUrlRecord, normalizeUrl } from './utils/urls.js';
import { RobotsTxt } from './utils/robots.js';
import type { RobotsStore } from './utils/robots.js';

export interface CrawlSchedulerDependencies {
  store: CrawlStore;
  fetcher: Fetcher;
  robotsStore: RobotsStore;
  metrics: CrawlMetrics;
  logger: Logger;
  now?: () => number;
}

export interface CrawlSchedulerOptions {
  userAgent: string;
  concurrency?: number;
  respectRobotsTxt?: boolean;
  maxPages?: number;
  queueMaxSize?: number;
  maxDepth?: number;
  rateLimitMs?: number;
}

interface RunState {
  crawlJobId: string;
  storeId: string;
  seedOrigin: string;
  queue: UrlQueue;
  rateLimiter: RateLimiter;
  pageIds: Map<string, string>;
  fetchedStatus: Map<string, number>;
  pagesSeen: Array<{ url: string; title: string | null; metaDescription: string | null }>;
  pageLinks: Array<{ from: string; links: PageLinkData[] }>;
  pagesCrawled: number;
  pagesFailed: number;
  pagesBlocked: number;
  totalIssues: number;
  totalBytes: number;
  responseTimes: number[];
  activeWorkers: number;
  notified: Array<() => void>;
  done: boolean;
}

const DEFAULT_CONCURRENCY = 8;
const DEFAULT_MAX_PAGES = 5000;
const DEFAULT_MAX_DEPTH = 6;
const DEFAULT_QUEUE_MAX_SIZE = 20_000;

/**
 * Runs the crawl loop over the URL queue. Manages robots compliance, the
 * shared rate limiter, a bounded worker pool with graceful drain, per-page
 * extraction and persistence, metric updates, and cross-page SEO detection
 * once the crawl finishes.
 */
export class CrawlScheduler {
  private readonly userAgent: string;
  private readonly concurrency: number;
  private readonly respectRobotsTxt: boolean;
  private readonly maxPages: number;
  private readonly queueMaxSize: number;
  private readonly maxDepth: number;
  private readonly rateLimitMs: number;
  private readonly now: () => number;
  private readonly store: CrawlStore;
  private readonly fetcher: Fetcher;
  private readonly robotsStore: RobotsStore;
  private readonly metrics: CrawlMetrics;
  private readonly logger: Logger;

  constructor(deps: CrawlSchedulerDependencies, options: CrawlSchedulerOptions) {
    this.store = deps.store;
    this.fetcher = deps.fetcher;
    this.robotsStore = deps.robotsStore;
    this.metrics = deps.metrics;
    this.logger = deps.logger;
    this.now = deps.now ?? (() => Date.now());
    this.userAgent = options.userAgent;
    this.concurrency = options.concurrency ?? DEFAULT_CONCURRENCY;
    this.respectRobotsTxt = options.respectRobotsTxt ?? true;
    this.maxPages = options.maxPages ?? DEFAULT_MAX_PAGES;
    this.queueMaxSize = options.queueMaxSize ?? DEFAULT_QUEUE_MAX_SIZE;
    this.maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
    this.rateLimitMs = options.rateLimitMs ?? 0;
  }

  /** Crawls a store, returning the final crawl statistics. */
  async run(crawlJobId: string, storeId: string, seeds: string[]): Promise<CrawlStatistics> {
    const startMs = this.now();
    const seedOrigin = getOrigin(seeds[0] ?? '');
    if (seedOrigin === null || seeds.length === 0) {
      throw new Error('At least one valid seed URL is required');
    }

    const state: RunState = {
      crawlJobId,
      storeId,
      seedOrigin,
      queue: new UrlQueue({ maxSize: this.queueMaxSize, visitedLimit: this.maxPages }),
      rateLimiter: new RateLimiter({
        rateLimitMs: this.rateLimitMs,
        now: this.now,
        sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      }),
      pageIds: new Map(),
      fetchedStatus: new Map(),
      pagesSeen: [],
      pageLinks: [],
      pagesCrawled: 0,
      pagesFailed: 0,
      pagesBlocked: 0,
      totalIssues: 0,
      totalBytes: 0,
      responseTimes: [],
      activeWorkers: 0,
      notified: [],
      done: false,
    };

    for (const seed of seeds) {
      const normalized = normalizeUrl(seed);
      const record = normalized === null ? null : makeUrlRecord(normalized, 0, true);
      if (record !== null) state.queue.add(record);
    }

    await this.store.markRunning(crawlJobId);
    this.logger.info({ crawlId: crawlJobId, seeds: seeds.length }, 'crawl.started');

    const workers = Array.from({ length: this.concurrency }, () => this.worker(state));
    await Promise.all(workers);

    const statistics = await this.finalize(state, startMs);
    return statistics;
  }

  private async worker(state: RunState): Promise<void> {
    while (!state.done) {
      const record = state.queue.next();
      if (record === null) {
        if (state.activeWorkers === 0 && state.queue.isEmpty) {
          state.done = true;
          this.wake(state);
          break;
        }
        await this.waitForWake(state);
        continue;
      }
      state.activeWorkers += 1;
      try {
        await this.processPage(state, record);
      } catch (err) {
        this.logger.error(
          { crawlId: state.crawlJobId, url: record.url, err },
          'crawl.page.errored',
        );
      } finally {
        state.activeWorkers -= 1;
        this.wake(state);
      }
    }
  }

  private async processPage(state: RunState, record: UrlRecord): Promise<void> {
    this.metrics.queueDepth(state.queue.size);

    const robots = this.respectRobotsTxt
      ? await this.robotsStore.forUrl(record.url, this.userAgent)
      : RobotsTxt.allowAll();

    if (!robots.isAllowed(record.url, this.userAgent)) {
      const extraction = this.blockedExtraction(record.url);
      const pageId = (await this.store.upsertPage(state.crawlJobId, state.storeId, extraction)).id;
      state.pageIds.set(record.url, pageId);
      const issues = detectPageIssues(extraction);
      await this.store.saveIssues(pageId, issues);
      state.pagesBlocked += 1;
      state.totalIssues += issues.length;
      this.metrics.issuesDetected(issues.length);
      this.logger.warn(
        { crawlId: state.crawlJobId, url: record.url },
        'crawl.page.robots-blocked',
      );
      return;
    }

    await state.rateLimiter.acquire();
    const result = await this.fetcher.fetch(record.url);

    if (result.error !== null || result.statusCode >= 400) {
      const extraction = this.failedExtraction(record.url, result);
      const pageId = (await this.store.upsertPage(state.crawlJobId, state.storeId, extraction)).id;
      state.pageIds.set(record.url, pageId);
      state.pagesFailed += 1;
      this.metrics.failures();
      if (result.statusCode >= 400) {
        state.fetchedStatus.set(this.key(result.finalUrl), result.statusCode);
      }
      this.logger.error(
        {
          crawlId: state.crawlJobId,
          url: record.url,
          status: result.statusCode,
          error: result.error,
          durationMs: result.responseTimeMs,
        },
        'crawl.page.failed',
      );
      return;
    }

    const extraction = parseHtml(result.body, {
      requestedUrl: record.url,
      finalUrl: result.finalUrl,
      contentType: result.contentType,
      charset: result.charset,
      redirectChain: result.redirectChain,
      performance: {
        ttfbMs: result.ttfbMs,
        responseTimeMs: result.responseTimeMs,
        pageSizeBytes: result.bodyBytes,
        htmlSizeBytes: result.bodyBytes,
        scriptCount: 0,
        stylesheetCount: 0,
      },
    });

    const pageId = (await this.store.upsertPage(state.crawlJobId, state.storeId, extraction)).id;
    state.pageIds.set(record.url, pageId);
    await this.store.saveLinks(pageId, extraction.links);
    await this.store.saveStructuredData(pageId, extraction.structuredData);

    const issues = detectPageIssues(extraction);
    await this.store.saveIssues(pageId, issues);

    state.pagesCrawled += 1;
    state.totalIssues += issues.length;
    state.totalBytes += result.bodyBytes;
    state.responseTimes.push(result.responseTimeMs);
    state.pagesSeen.push({
      url: record.url,
      title: extraction.title,
      metaDescription: extraction.metaDescription,
    });
    state.pageLinks.push({ from: record.url, links: extraction.links });
    state.fetchedStatus.set(this.key(result.finalUrl), result.statusCode);

    this.metrics.pagesCrawled();
    this.metrics.issuesDetected(issues.length);
    this.metrics.responseTime(result.responseTimeMs);

    this.enqueueLinks(state, extraction, record.depth);

    this.logger.info(
      {
        requestId: randomUUID(),
        crawlId: state.crawlJobId,
        url: record.url,
        status: result.statusCode,
        durationMs: result.responseTimeMs,
        issueCount: issues.length,
      },
      'crawl.page.crawled',
    );
  }

  private enqueueLinks(state: RunState, extraction: PageExtraction, depth: number): void {
    if (depth >= this.maxDepth) return;
    for (const link of extraction.links) {
      if (!isCrawlableUrl(link.href, state.seedOrigin)) continue;
      state.queue.add(
        makeUrlRecord(normalizeUrl(link.href) as string, depth + 1, false) as UrlRecord,
      );
    }
  }

  private async finalize(state: RunState, startMs: number): Promise<CrawlStatistics> {
    const linkStatuses: PageLinkStatus[] = [];
    for (const { from, links } of state.pageLinks) {
      for (const link of links) {
        if (!link.isInternal) continue;
        const statusCode = state.fetchedStatus.get(normalizeUrl(link.href) as string);
        if (statusCode === undefined) continue;
        linkStatuses.push({ from, href: normalizeUrl(link.href) as string, statusCode });
      }
    }

    const crossIssues = detectCrossPageIssues({
      pages: state.pagesSeen,
      linkStatuses,
    });

    for (const issue of crossIssues) {
      await this.store.saveIssues(state.pageIds.get(affectedUrl(issue)) as string, [issue]);
    }
    state.totalIssues += crossIssues.length;
    this.metrics.issuesDetected(crossIssues.length);

    const averageResponseTimeMs =
      state.responseTimes.length > 0
        ? state.responseTimes.reduce((total, ms) => total + ms, 0) / state.responseTimes.length
        : 0;

    const statistics: CrawlStatistics = {
      pagesCrawled: state.pagesCrawled,
      pagesFailed: state.pagesFailed,
      pagesBlocked: state.pagesBlocked,
      totalIssues: state.totalIssues,
      brokenLinks: crossIssues.filter((issue) => issue.rule === 'broken-link').length,
      averageResponseTimeMs,
      totalBytes: state.totalBytes,
      durationMs: this.now() - startMs,
    };

    this.metrics.setDurationSeconds(statistics.durationMs / 1000);
    this.logger.info(
      {
        crawlId: state.crawlJobId,
        statistics,
      },
      'crawl.completed',
    );
    return statistics;
  }

  private blockedExtraction(url: string): PageExtraction {
    return {
      url,
      finalUrl: url,
      statusCode: 0,
      contentType: null,
      charset: null,
      redirectChain: [],
      robotsBlocked: true,
      title: null,
      metaDescription: null,
      metaRobots: null,
      canonicalUrl: null,
      h1: [],
      lang: null,
      favicon: null,
      themeColor: null,
      ogTags: {},
      twitterTags: {},
      links: [],
      images: [],
      structuredData: [],
      wordCount: 0,
      contentHash: '',
      performance: { ttfbMs: 0, responseTimeMs: 0, pageSizeBytes: 0, htmlSizeBytes: 0, scriptCount: 0, stylesheetCount: 0 },
    };
  }

  private failedExtraction(url: string, result: FetchResult): PageExtraction {
    return {
      url,
      finalUrl: result.finalUrl,
      statusCode: result.statusCode,
      contentType: null,
      charset: null,
      redirectChain: result.redirectChain,
      robotsBlocked: false,
      title: null,
      metaDescription: null,
      metaRobots: null,
      canonicalUrl: null,
      h1: [],
      lang: null,
      favicon: null,
      themeColor: null,
      ogTags: {},
      twitterTags: {},
      links: [],
      images: [],
      structuredData: [],
      wordCount: 0,
      contentHash: '',
      performance: {
        ttfbMs: result.ttfbMs,
        responseTimeMs: result.responseTimeMs,
        pageSizeBytes: result.bodyBytes,
        htmlSizeBytes: result.bodyBytes,
        scriptCount: 0,
        stylesheetCount: 0,
      },
    };
  }

  private key(url: string): string {
    return normalizeUrl(url) as string;
  }

  private waitForWake(state: RunState): Promise<void> {
    return new Promise((resolve) => {
      state.notified.push(resolve);
    });
  }

  private wake(state: RunState): void {
    const waiters = state.notified;
    state.notified = [];
    for (const resolve of waiters) resolve();
  }
}

function affectedUrl(issue: SeoIssue): string {
  const details = issue.details as { affectedUrl?: string; from?: string };
  return (details.affectedUrl ?? details.from) as string;
}
