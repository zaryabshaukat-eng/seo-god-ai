/**
 * Execution metrics. Aggregated per execution so every run is measurable and
 * comparable, mirroring the live counters exposed by the monitoring layer.
 */

export interface ExecutionMetrics {
  executionId: string;
  storeId: string;
  mode: string;
  startedAt: Date;
  completedAt: Date;
  durationMs: number;
  totalSteps: number;
  completed: number;
  simulated: number;
  failed: number;
  skipped: number;
  cancelled: number;
  rolledBack: number;
  apiCalls: number;
  /** Shopify API calls per minute (0 when no calls were made). */
  writeRate: number;
  /** Mean number of steps per batch. */
  batchSize: number;
  rollbacks: number;
  averageStepTimeMs: number;
  createdAt: Date;
}
