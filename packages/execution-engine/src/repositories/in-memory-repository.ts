import type { ExecutionDiff } from '../types/diff.js';
import type { Execution, ExecutionBatch, ExecutionHistoryEntry, ExecutionStep } from '../types/execution.js';
import type { ExecutionMetrics } from '../types/metrics.js';
import type { ExecutionFilter, ExecutionRepository } from '../types/repository.js';
import type { RollbackRecord } from '../types/rollback.js';

const ACTIVE_STATUSES = new Set(['PENDING', 'VALIDATING', 'QUEUED', 'EXECUTING']);

/** In-memory {@link ExecutionRepository} for tests, dry-runs and single-node
 * deployments. Not durable across restarts. */
export class InMemoryExecutionRepository implements ExecutionRepository {
  private readonly executions = new Map<string, Execution>();
  private readonly steps = new Map<string, ExecutionStep>();
  private readonly batches = new Map<string, ExecutionBatch>();
  private readonly history = new Map<string, ExecutionHistoryEntry[]>();
  private readonly diffs = new Map<string, ExecutionDiff>();
  private readonly rollbacks = new Map<string, RollbackRecord>();
  private readonly metrics = new Map<string, ExecutionMetrics>();

  async saveExecution(execution: Execution): Promise<void> {
    this.executions.set(execution.id, execution);
  }

  async getExecution(id: string): Promise<Execution | null> {
    return this.executions.get(id) ?? null;
  }

  async listExecutions(filter?: ExecutionFilter): Promise<Execution[]> {
    let results = [...this.executions.values()];
    if (filter?.storeId !== undefined) results = results.filter((e) => e.storeId === filter.storeId);
    if (filter?.status !== undefined) results = results.filter((e) => e.status === filter.status);
    if (filter?.mode !== undefined) results = results.filter((e) => e.mode === filter.mode);
    return results;
  }

  async saveStep(step: ExecutionStep): Promise<void> {
    this.steps.set(step.id, step);
  }

  async getStep(id: string): Promise<ExecutionStep | null> {
    return this.steps.get(id) ?? null;
  }

  async saveBatch(batch: ExecutionBatch): Promise<void> {
    this.batches.set(batch.id, batch);
  }

  async appendHistory(executionId: string, entry: ExecutionHistoryEntry): Promise<void> {
    const entries = this.history.get(executionId) ?? [];
    entries.push(entry);
    this.history.set(executionId, entries);
  }

  async saveDiff(diff: ExecutionDiff): Promise<void> {
    this.diffs.set(diff.id, diff);
  }

  async getDiff(id: string): Promise<ExecutionDiff | null> {
    return this.diffs.get(id) ?? null;
  }

  async saveRollback(record: RollbackRecord): Promise<void> {
    this.rollbacks.set(record.id, record);
  }

  async getRollback(id: string): Promise<RollbackRecord | null> {
    return this.rollbacks.get(id) ?? null;
  }

  async saveMetrics(executionId: string, metrics: ExecutionMetrics): Promise<void> {
    this.metrics.set(executionId, metrics);
  }

  async getMetrics(executionId: string): Promise<ExecutionMetrics | null> {
    return this.metrics.get(executionId) ?? null;
  }

  async findCompletedStep(
    storeId: string,
    resourceType: string,
    resourceId: string,
    actionType: string,
  ): Promise<ExecutionStep | null> {
    for (const step of this.steps.values()) {
      if (
        step.storeId === storeId &&
        step.resourceType === resourceType &&
        step.resourceId === resourceId &&
        step.actionType === actionType &&
        (step.status === 'COMPLETED' || step.status === 'SIMULATED')
      ) {
        return step;
      }
    }
    return null;
  }

  async listActiveExecutions(storeId?: string): Promise<Execution[]> {
    return [...this.executions.values()].filter(
      (e) =>
        ACTIVE_STATUSES.has(e.status) &&
        (storeId === undefined || e.storeId === storeId),
    );
  }
}
