import type { MetricsRegistry } from '@seogod/monitoring';

export const SCHEDULER_METRICS_NAMES = {
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
} as const;

/**
 * Thin adapter over the shared {@link MetricsRegistry} exposing the
 * scheduler counters and gauges defined in the platform spec. Counters
 * render with a `_total` suffix in Prometheus exposition format.
 */
export class SchedulerMetrics {
  constructor(private readonly registry: MetricsRegistry) {}

  jobsScheduled(by = 1): void {
    this.registry.increment(SCHEDULER_METRICS_NAMES.jobsScheduled, by);
  }

  jobsCompleted(by = 1): void {
    this.registry.increment(SCHEDULER_METRICS_NAMES.jobsCompleted, by);
  }

  jobsFailed(by = 1): void {
    this.registry.increment(SCHEDULER_METRICS_NAMES.jobsFailed, by);
  }

  jobsRetried(by = 1): void {
    this.registry.increment(SCHEDULER_METRICS_NAMES.jobsRetried, by);
  }

  jobsSkipped(by = 1): void {
    this.registry.increment(SCHEDULER_METRICS_NAMES.jobsSkipped, by);
  }

  /** Records the wall-clock duration of a single attempt. */
  observeRunDurationMs(durationMs: number): void {
    this.registry.observe(SCHEDULER_METRICS_NAMES.runDurationMs, durationMs);
  }

  setQueueDepth(depth: number): void {
    this.registry.setGauge(SCHEDULER_METRICS_NAMES.queueDepth, depth);
  }

  setLocksHeld(count: number): void {
    this.registry.setGauge(SCHEDULER_METRICS_NAMES.locksHeld, count);
  }

  locksContended(by = 1): void {
    this.registry.increment(SCHEDULER_METRICS_NAMES.locksContended, by);
  }

  polls(by = 1): void {
    this.registry.increment(SCHEDULER_METRICS_NAMES.polls, by);
  }
}
