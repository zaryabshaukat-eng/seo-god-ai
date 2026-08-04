/**
 * Repository contract. Persistence is behind an interface so executions can be
 * stored in memory (default), Postgres, or any durable store; every write to
 * Shopify must be mirrored here for audit and recovery.
 */

import type { ExecutionDiff } from './diff.js';
import type { Execution, ExecutionBatch, ExecutionHistoryEntry, ExecutionStep } from './execution.js';
import type { ExecutionMetrics } from './metrics.js';
import type { RollbackRecord } from './rollback.js';

export interface ExecutionFilter {
  storeId?: string;
  status?: string;
  mode?: string;
}

export interface ExecutionRepository {
  saveExecution(execution: Execution): Promise<void>;
  getExecution(id: string): Promise<Execution | null>;
  listExecutions(filter?: ExecutionFilter): Promise<Execution[]>;
  saveStep(step: ExecutionStep): Promise<void>;
  getStep(id: string): Promise<ExecutionStep | null>;
  saveBatch(batch: ExecutionBatch): Promise<void>;
  appendHistory(executionId: string, entry: ExecutionHistoryEntry): Promise<void>;
  saveDiff(diff: ExecutionDiff): Promise<void>;
  getDiff(id: string): Promise<ExecutionDiff | null>;
  saveRollback(record: RollbackRecord): Promise<void>;
  getRollback(id: string): Promise<RollbackRecord | null>;
  saveMetrics(executionId: string, metrics: ExecutionMetrics): Promise<void>;
  getMetrics(executionId: string): Promise<ExecutionMetrics | null>;
  findCompletedStep(
    storeId: string,
    resourceType: string,
    resourceId: string,
    actionType: string,
  ): Promise<ExecutionStep | null>;
  listActiveExecutions(storeId?: string): Promise<Execution[]>;
}
