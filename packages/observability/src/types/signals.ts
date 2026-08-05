/**
 * Metrics and learning signals computed by the observability engine.
 */

export interface ExecutionMetricsSummary {
  totalExecutions: number;
  queued: number;
  executing: number;
  completed: number;
  failed: number;
  cancelled: number;
  rolledBack: number;
  /** Fraction of terminal executions that completed, 0..1. */
  successRate: number;
  /** Fraction of terminal executions that failed, 0..1. */
  failureRate: number;
  /** Fraction of terminal executions that were rolled back, 0..1. */
  rollbackRate: number;
  /** Average execution duration in ms across completed executions. */
  averageExecutionTimeMs: number;
  /** 95th percentile execution duration in ms across completed executions. */
  p95ExecutionTimeMs: number;
  /** Total validation failures observed. */
  validationFailures: number;
  /** Total safety violations observed. */
  safetyViolations: number;
  /** Total rollbacks observed. */
  totalRollbacks: number;
  /** Crawl health: fraction of crawls that completed, 0..1. */
  crawlSuccessRate: number;
  /** Total executions whose writes were simulated (dry runs). */
  simulated: number;
}

/** Rollup of overview counters served by the dashboard API. */
export interface ObservabilityOverview {
  storeCount: number;
  executionCount: number;
  activeExecutionCount: number;
  completedCount: number;
  failedCount: number;
  rolledBackCount: number;
  alertCount: number;
  openAlertCount: number;
  latestSeoScore: number | null;
  latestExecutionAt: string | null;
  successRate: number;
}

/**
 * Learning signal for a repeatable action type. Shape is intentionally
 * compatible with the decision engine's `HistoricalOutcome`
 * (`rule`, `attempts`, `successes`, `averageImpact`) so signals can be fed
 * straight into decision planning.
 */
export interface LearningSignal {
  /** Action identity, e.g. `product.seo_field_update` or `missing-title`. */
  rule: string;
  /** Execution operation (when known) that produced the signal. */
  actionType: string;
  /** When scoped to a single store, the store id. */
  storeId?: string;
  /** Number of prior executions of this action. */
  attempts: number;
  /** Number of executions that succeeded. */
  successes: number;
  /** Average measured SEO impact (0..100); unknown impact defaults to 0. */
  averageImpact: number;
  /** Rolling success rate, 0..1. */
  successRate: number;
  /** Rolling rollback rate, 0..1. */
  rollbackRate: number;
  /** Average execution time in ms. */
  averageDurationMs: number;
  /** When the action was last executed. */
  lastExecutedAt?: string;
}

/** Shape accepted by the decision engine as `HistoricalOutcome`. */
export interface HistoricalOutcome {
  rule: string;
  attempts: number;
  successes: number;
  averageImpact: number;
}
