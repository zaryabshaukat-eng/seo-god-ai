/**
 * Observability domain models: normalized execution records, SEO snapshots,
 * immutable change history, alerts and timeline points.
 */

export type ExecutionStatus =
  | 'QUEUED'
  | 'EXECUTING'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED'
  | 'ROLLED_BACK';

/** Terminal execution states. */
export const TERMINAL_STATUSES: ReadonlySet<ExecutionStatus> = new Set([
  'COMPLETED',
  'FAILED',
  'CANCELLED',
  'ROLLED_BACK',
]);

/**
 * Normalized view of an execution. Built from execution engine events and/or
 * a full execution report; never mutated after its terminal event.
 */
export interface ExecutionRecord {
  executionId: string;
  storeId: string;
  batchId?: string;
  workflowId?: string;
  entityType?: string;
  entityId?: string;
  operation?: string;
  status: ExecutionStatus;
  /** When the execution was first seen. */
  startedAt: string;
  /** When the execution reached a terminal state. */
  completedAt?: string;
  durationMs?: number;
  retryCount?: number;
  error?: string;
  reason?: string;
  rollbackId?: string;
  simulation?: boolean;
  /** Step-level counters, populated from a full report when available. */
  totalSteps?: number;
  completedSteps?: number;
  simulatedSteps?: number;
  failedSteps?: number;
  skippedSteps?: number;
  cancelledSteps?: number;
  rolledBackSteps?: number;
  apiCalls?: number;
  batchSize?: number;
  averageStepTimeMs?: number;
  writeRate?: number;
}

/** A point-in-time SEO health snapshot for a store. */
export interface SeoSnapshot {
  snapshotId: string;
  storeId: string;
  crawlJobId?: string;
  executionId?: string;
  /** When the snapshot was captured. */
  capturedAt: string;
  /** Whether this was captured before or after an execution. */
  reference?: 'BEFORE' | 'AFTER';
  /** Overall SEO health score, 0..100. */
  overallScore: number;
  /** Per-category scores, e.g. `{ title: 80, description: 60 }`. */
  scores?: Record<string, number>;
  pagesCrawled?: number;
  totalIssues?: number;
  brokenLinks?: number;
  averageResponseTimeMs?: number;
  recommendationsCount?: number;
  issues?: Array<{ category: string; count: number }>;
}

/**
 * Immutable change-history entry. Once appended to the store a change record
 * can never be updated or removed; reversals are recorded as `revert` entries.
 */
export interface ChangeRecord {
  changeId: string;
  kind: 'apply' | 'revert';
  executionId: string;
  storeId: string;
  entityType?: string;
  entityId: string;
  operation?: string;
  /** When the change was applied or reverted. */
  appliedAt: string;
  changedFields: string[];
  before: unknown;
  after: unknown;
  rollbackId?: string;
}

export type AlertType =
  | 'execution_failure'
  | 'rollback_spike'
  | 'validation_spike'
  | 'seo_regression';

export type AlertSeverity = 'info' | 'warning' | 'critical';

/** A generated alert, stored in the alert log. */
export interface AlertRecord {
  alertId: string;
  type: AlertType;
  severity: AlertSeverity;
  message: string;
  triggeredAt: string;
  storeId?: string;
  /** Structured context describing why the alert fired. */
  context: Record<string, unknown>;
}

export type TimelinePointType = 'execution' | 'seo_score' | 'performance';

/** A single point on a historical timeline. */
export interface TimelinePoint {
  timestamp: string;
  type: TimelinePointType;
  storeId?: string;
  /** Numeric value: duration, score or throughput. */
  value: number;
  /** Execution status, snapshot reference or bucket label. */
  label?: string;
  executionId?: string;
}

/** Complete history snapshot served by the dashboard API. */
export interface ObservabilityHistory {
  executions: ExecutionRecord[];
  snapshots: SeoSnapshot[];
  changes: ChangeRecord[];
  alerts: AlertRecord[];
  events: StoredEventLike[];
}

/** Structural event-log entry used by the history API (typed payload omitted
 * from the wire-friendly view). */
export interface StoredEventLike {
  id: string;
  type: string;
  storeId?: string;
  occurredAt: string;
}

/** SEO score timeline served by the dashboard API. */
export interface SeoTimeline {
  storeId?: string;
  points: Array<{
    timestamp: string;
    overallScore: number;
    reference?: 'BEFORE' | 'AFTER';
    pagesCrawled?: number;
    totalIssues?: number;
  }>;
}

/** Execution performance timeline served by the dashboard API. */
export interface PerformanceTimeline {
  points: Array<{
    timestamp: string;
    /** Average execution time in ms for the bucket. */
    averageDurationMs: number;
    /** Number of terminal executions in the bucket. */
    executions: number;
    /** Number of failed executions in the bucket. */
    failures: number;
  }>;
}
