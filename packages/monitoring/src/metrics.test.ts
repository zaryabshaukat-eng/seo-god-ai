import { describe, expect, it } from 'vitest';
import { MetricsRegistry } from './metrics.js';

describe('MetricsRegistry', () => {
  it('increments counters', () => {
    const metrics = new MetricsRegistry();
    metrics.increment('events.processed');
    metrics.increment('events.processed');
    metrics.increment('events.failed');
    const snapshot = metrics.snapshot();
    expect(snapshot.counters['events.processed']).toBe(2);
    expect(snapshot.counters['events.failed']).toBe(1);
  });

  it('tracks gauges', () => {
    const metrics = new MetricsRegistry();
    metrics.setGauge('active_crawls', 3);
    metrics.setGauge('active_crawls', 1);
    expect(metrics.snapshot().gauges['active_crawls']).toBe(1);
  });

  it('aggregates timings', () => {
    const metrics = new MetricsRegistry();
    metrics.observe('page.fetch_ms', 10);
    metrics.observe('page.fetch_ms', 30);
    const snapshot = metrics.snapshot();
    expect(snapshot.histograms['page.fetch_ms']).toMatchObject({
      count: 2,
      sum: 40,
      min: 10,
      max: 30,
      avg: 20,
    });
  });

  it('renders prometheus text exposition', () => {
    const metrics = new MetricsRegistry();
    metrics.increment('events.processed', 3);
    metrics.setGauge('active_crawls', 1);
    metrics.observe('page.fetch_ms', 15);
    const text = metrics.render();
    expect(text).toContain('# TYPE seogod_events_processed_total counter');
    expect(text).toContain('seogod_events_processed_total 3');
    expect(text).toContain('seogod_active_crawls 1');
    expect(text).toContain('seogod_page_fetch_ms_milliseconds_count 1');
    expect(text).toContain('seogod_page_fetch_ms_milliseconds_sum 15');
  });

  it('resets all values', () => {
    const metrics = new MetricsRegistry();
    metrics.increment('a');
    metrics.setGauge('b', 1);
    metrics.observe('c', 1);
    metrics.reset();
    const snapshot = metrics.snapshot();
    expect(Object.keys(snapshot.counters)).toHaveLength(0);
    expect(Object.keys(snapshot.gauges)).toHaveLength(0);
    expect(Object.keys(snapshot.histograms)).toHaveLength(0);
  });
});
