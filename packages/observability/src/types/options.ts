/**
 * Configuration options for the observability engine.
 */

import type { MetricsRegistry } from '@seogod/monitoring';

export interface AlertEngineOptions {
  /** Window over which rollback events are counted for spike detection (ms). */
  rollbackSpikeWindowMs: number;
  /** Minimum rollbacks inside the window to fire a spike alert. */
  rollbackSpikeThreshold: number;
  /** Window over which validation failures are counted (ms). */
  validationSpikeWindowMs: number;
  /** Minimum validation failures inside the window to fire a spike alert. */
  validationSpikeThreshold: number;
  /** Minimum overall score drop vs the previous snapshot to fire a regression. */
  seoRegressionDelta: number;
  /** Retry count at or above which an execution failure is critical. */
  criticalRetryCount: number;
}

export const DEFAULT_ALERT_OPTIONS: AlertEngineOptions = {
  rollbackSpikeWindowMs: 60 * 60 * 1000,
  rollbackSpikeThreshold: 3,
  validationSpikeWindowMs: 60 * 60 * 1000,
  validationSpikeThreshold: 5,
  seoRegressionDelta: 5,
  criticalRetryCount: 3,
};

/** Options for the {@link ObservabilityService} facade. */
export interface ObservabilityServiceOptions {
  /** Clock injection for deterministic timestamps (ISO 8601). */
  now?: () => string;
  /** Overrides for alert thresholds. */
  alert?: Partial<AlertEngineOptions>;
  /** Optional metrics registry the engine reports counters/gauges into. */
  metrics?: MetricsRegistry;
}
