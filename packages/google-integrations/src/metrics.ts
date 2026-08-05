import type { MetricsRegistry } from '@seogod/monitoring';

export const GOOGLE_METRICS_NAMES = {
  requests: 'google_api_requests',
  requestFailures: 'google_api_request_failures',
  syncs: 'google_syncs',
  syncFailures: 'google_sync_failures',
  rowsProcessed: 'google_rows_processed',
  syncDurationSeconds: 'google_sync_duration_seconds',
} as const;

/**
 * Thin adapter over the shared {@link MetricsRegistry} that exposes the
 * Google-integration counters defined in the platform spec. Counters render
 * with a `_total` suffix (e.g. `seogod_google_api_requests_total`) in
 * Prometheus exposition format.
 */
export class GoogleMetrics {
  constructor(private readonly registry: MetricsRegistry) {}

  /** Records a completed API request (after the final attempt). */
  requests(by = 1): void {
    this.registry.increment(GOOGLE_METRICS_NAMES.requests, by);
  }

  /** Records a failed API request (after retries are exhausted). */
  requestFailures(by = 1): void {
    this.registry.increment(GOOGLE_METRICS_NAMES.requestFailures, by);
  }

  /** Records a completed incremental sync. */
  syncs(by = 1): void {
    this.registry.increment(GOOGLE_METRICS_NAMES.syncs, by);
  }

  /** Records a failed incremental sync. */
  syncFailures(by = 1): void {
    this.registry.increment(GOOGLE_METRICS_NAMES.syncFailures, by);
  }

  /** Records rows produced by a sync run. */
  rowsProcessed(by = 1): void {
    this.registry.increment(GOOGLE_METRICS_NAMES.rowsProcessed, by);
  }

  /** Sets the total duration of a sync run once it finishes. */
  setSyncDurationSeconds(seconds: number): void {
    this.registry.setGauge(GOOGLE_METRICS_NAMES.syncDurationSeconds, seconds);
  }
}
