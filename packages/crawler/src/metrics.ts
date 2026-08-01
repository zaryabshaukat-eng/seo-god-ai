import type { MetricsRegistry } from '@seogod/monitoring';

export const CRAWLER_METRICS = {
  pagesCrawled: 'pages_crawled',
  durationSeconds: 'crawl_duration_seconds',
  failures: 'crawl_failures',
  issuesDetected: 'issues_detected',
  averageResponseTime: 'average_response_time',
  queueDepth: 'crawler_queue_depth',
} as const;

/**
 * Thin adapter over the shared {@link MetricsRegistry} that exposes the six
 * crawler metrics defined in the platform spec. Counters render with a
 * `_total` suffix (e.g. `seogod_pages_crawled_total`) in Prometheus
 * exposition format: `pages_crawled_total`, `crawl_duration_seconds`,
 * `crawl_failures_total`, `issues_detected_total`, `average_response_time`
 * and `crawler_queue_depth`.
 */
export class CrawlMetrics {
  constructor(private readonly registry: MetricsRegistry) {}

  /** Records a successfully crawled page. */
  pagesCrawled(by = 1): void {
    this.registry.increment(CRAWLER_METRICS.pagesCrawled, by);
  }

  /** Records a page that could not be crawled. */
  failures(by = 1): void {
    this.registry.increment(CRAWLER_METRICS.failures, by);
  }

  /** Records detected SEO issues. */
  issuesDetected(by = 1): void {
    this.registry.increment(CRAWLER_METRICS.issuesDetected, by);
  }

  /** Updates the current queue depth gauge. */
  queueDepth(depth: number): void {
    this.registry.setGauge(CRAWLER_METRICS.queueDepth, depth);
  }

  /** Samples a page's total response time. */
  responseTime(ms: number): void {
    this.registry.observe(CRAWLER_METRICS.averageResponseTime, ms);
  }

  /** Sets the total crawl duration once the run finishes. */
  setDurationSeconds(seconds: number): void {
    this.registry.setGauge(CRAWLER_METRICS.durationSeconds, seconds);
  }
}
