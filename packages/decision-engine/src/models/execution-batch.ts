import type { ExecutionBatch, TaskStatus } from '../types/plan.js';

/** Execution batch model: status transitions for a batch. */
export class ExecutionBatchModel {
  static fromRecord(record: ExecutionBatch): ExecutionBatch {
    return { ...record };
  }

  static setStatus(batch: ExecutionBatch, status: TaskStatus): ExecutionBatch {
    return { ...batch, status };
  }
}
