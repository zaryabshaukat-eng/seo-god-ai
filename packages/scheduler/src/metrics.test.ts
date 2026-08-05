import { describe, expect, it } from 'vitest';
import { MetricsRegistry } from '@seogod/monitoring';
import { SchedulerMetrics, SCHEDULER_METRICS_NAMES } from './metrics.js';

describe('SCHEDULER_METRICS_NAMES', () => {
  it('defines the platform metric names', () => {
    expect(SCHEDULER_METRICS_NAMES).toEqual({
      jobsScheduled: 'scheduler_jobs_scheduled',
      jobsCompleted: 'scheduler_jobs_completed',
      jobsFailed: 'scheduler_jobs_failed',
      jobsRetried: 'scheduler_jobs_retried',
      jobsSkipped: 'scheduler_jobs_skipped',
      runDurationMs: 'scheduler_run_duration_ms',
      queueDepth: 'scheduler_queue_depth',
      locksHeld: 'scheduler_locks_held',
      locksContended: 'scheduler_locks_contended',
      polls: 'scheduler_polls',
    });
  });
});

describe('SchedulerMetrics', () => {
  it('records counters with the default increment of one', () => {
    const registry = new MetricsRegistry();
    const metrics = new SchedulerMetrics(registry);
    metrics.jobsScheduled();
    metrics.jobsCompleted();
    metrics.jobsFailed();
    metrics.jobsRetried();
    metrics.jobsSkipped();
    metrics.locksContended();
    metrics.polls();
    const snapshot = registry.snapshot();
    expect(snapshot.counters).toEqual({
      scheduler_jobs_scheduled: 1,
      scheduler_jobs_completed: 1,
      scheduler_jobs_failed: 1,
      scheduler_jobs_retried: 1,
      scheduler_jobs_skipped: 1,
      scheduler_locks_contended: 1,
      scheduler_polls: 1,
    });
  });

  it('records counters with a custom increment', () => {
    const registry = new MetricsRegistry();
    const metrics = new SchedulerMetrics(registry);
    metrics.jobsScheduled(3);
    metrics.locksContended(2);
    const snapshot = registry.snapshot();
    expect(snapshot.counters.scheduler_jobs_scheduled).toBe(3);
    expect(snapshot.counters.scheduler_locks_contended).toBe(2);
  });

  it('records run duration as a histogram observation', () => {
    const registry = new MetricsRegistry();
    const metrics = new SchedulerMetrics(registry);
    metrics.observeRunDurationMs(12);
    metrics.observeRunDurationMs(28);
    const snapshot = registry.snapshot();
    expect(snapshot.histograms.scheduler_run_duration_ms).toEqual({
      count: 2,
      sum: 40,
      min: 12,
      max: 28,
      avg: 20,
    });
  });

  it('sets queue depth and locks held gauges', () => {
    const registry = new MetricsRegistry();
    const metrics = new SchedulerMetrics(registry);
    metrics.setQueueDepth(4);
    metrics.setLocksHeld(1);
    metrics.setQueueDepth(0);
    const snapshot = registry.snapshot();
    expect(snapshot.gauges.scheduler_queue_depth).toBe(0);
    expect(snapshot.gauges.scheduler_locks_held).toBe(1);
  });
});
