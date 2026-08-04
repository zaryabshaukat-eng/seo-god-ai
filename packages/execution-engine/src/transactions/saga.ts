import type { Execution, ExecutionBatch, ExecutionStep } from '../types/execution.js';
import type { OperationResult } from '../types/publisher.js';
import type { RollbackEngine } from '../rollback/engine.js';

export type BatchStepRunner = (step: ExecutionStep) => Promise<OperationResult>;

export type SagaBatchStatus = 'COMPLETED' | 'FAILED' | 'ROLLED_BACK';

export interface SagaBatchResult {
  batchId: string;
  status: SagaBatchStatus;
  apiCalls: number;
  executed: string[];
  rolledBack: string[];
}

export interface BatchSagaOptions {
  rollback: RollbackEngine;
  /** Compensate already-executed steps in reverse order on failure. */
  autoRollback?: boolean;
  shopDomain?: string;
}

/**
 * Executes a batch of steps as a saga: each step runs through the provided
 * runner, and on failure the already-executed steps are compensated in
 * reverse order via the rollback engine.
 */
export class BatchSaga {
  private readonly rollback: RollbackEngine;
  private readonly autoRollback: boolean;
  private readonly shopDomain?: string;

  constructor(options: BatchSagaOptions) {
    this.rollback = options.rollback;
    this.autoRollback = options.autoRollback ?? true;
    this.shopDomain = options.shopDomain;
  }

  async runBatch(
    batch: ExecutionBatch,
    execution: Execution,
    runStep: BatchStepRunner,
  ): Promise<SagaBatchResult> {
    const executed: ExecutionStep[] = [];
    for (const stepId of batch.stepIds) {
      const step = execution.steps.find((candidate) => candidate.id === stepId);
      if (step === undefined) continue;
      try {
        const result = await runStep(step);
        executed.push(step);
        step.apiCalls = result.apiCalls;
      } catch (error) {
        step.status = 'FAILED';
        step.error = error instanceof Error ? error.message : String(error);
        if (this.autoRollback) {
          await this.compensate(executed, execution);
          return { batchId: batch.id, status: 'ROLLED_BACK', apiCalls: 0, executed: executed.map((s) => s.id), rolledBack: executed.map((s) => s.id) };
        }
        return { batchId: batch.id, status: 'FAILED', apiCalls: 0, executed: executed.map((s) => s.id), rolledBack: [] };
      }
    }
    return {
      batchId: batch.id,
      status: 'COMPLETED',
      apiCalls: executed.reduce((sum, step) => sum + step.apiCalls, 0),
      executed: executed.map((step) => step.id),
      rolledBack: [],
    };
  }

  private async compensate(executed: ExecutionStep[], execution: Execution): Promise<void> {
    for (const step of [...executed].reverse()) {
      const result = await this.rollback.rollbackStep(step, this.shopDomain ?? step.storeId);
      step.status = result.status === 'COMPLETED' ? 'ROLLED_BACK' : 'FAILED';
      if (result.status === 'FAILED') step.error = result.error ?? step.error;
    }
    void execution;
  }
}
