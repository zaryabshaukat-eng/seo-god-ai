import { describe, expect, it } from 'vitest';
import { MetricsRegistry } from '@seogod/monitoring';
import { CrawlMetrics, CRAWLER_METRICS } from './metrics.js';

describe('CrawlMetrics', () => {
  it('exposes the six spec metric names', () => {
    expect(CRAWLER_METRICS).toEqual({
      pagesCrawled: 'pages_crawled',
      durationSeconds: 'crawl_duration_seconds',
      failures: 'crawl_failures',
      issuesDetected: 'issues_detected',
      averageResponseTime: 'average_response_time',
      queueDepth: 'crawler_queue_depth',
    });
  });

  it('records counters, gauges and histograms through the registry', () => {
    const registry = new MetricsRegistry();
    const metrics = new CrawlMetrics(registry);

    metrics.pagesCrawled();
    metrics.pagesCrawled(2);
    metrics.failures();
    metrics.issuesDetected(4);
    metrics.queueDepth(7);
    metrics.setDurationSeconds(12.5);
    metrics.responseTime(40);
    metrics.responseTime(60);

    const snapshot = registry.snapshot();
    expect(snapshot.counters.pages_crawled).toBe(3);
    expect(snapshot.counters.crawl_failures).toBe(1);
    expect(snapshot.counters.issues_detected).toBe(4);
    expect(snapshot.gauges.crawler_queue_depth).toBe(7);
    expect(snapshot.gauges.crawl_duration_seconds).toBe(12.5);
    expect(snapshot.histograms.average_response_time).toEqual({
      count: 2,
      sum: 100,
      min: 40,
      max: 60,
      avg: 50,
    });

    const rendered = registry.render();
    expect(rendered).toContain('seogod_pages_crawled_total 3');
    expect(rendered).toContain('seogod_crawler_queue_depth 7');
    expect(rendered).toContain('seogod_average_response_time_milliseconds_count 2');
  });
});
