/**
 * Execution report. Dry runs must produce a complete report without touching
 * Shopify: every step is validated, diffed and planned for rollback, then
 * recorded as simulated alongside its diff.
 */

import type { ExecutionDiff } from './diff.js';
import type { Execution } from './execution.js';
import type { ExecutionMetrics } from './metrics.js';
import type { RollbackRecord } from './rollback.js';
import type { ValidationResult } from './validation.js';

export interface ExecutionReport {
  execution: Execution;
  /** Diffs produced by the executed steps. */
  diffs: ExecutionDiff[];
  /** Rollback records produced during the run. */
  rollbacks: RollbackRecord[];
  metrics: ExecutionMetrics | null;
  validations: Record<string, ValidationResult>;
}
