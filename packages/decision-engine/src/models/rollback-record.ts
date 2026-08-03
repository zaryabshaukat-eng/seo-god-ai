import type { ExecutionPlan } from '../types/plan.js';
import type { RollbackPlan, RollbackRecord, RollbackStatus } from '../types/result.js';
import { newId } from '../utils/ids.js';

export interface RollbackRecordCreateInput {
  planId: string;
  taskId: string;
  storeId: string;
  rollback: RollbackPlan;
  reason: string;
  now: () => Date;
}

/**
 * Rollback record model: creation and deterministic status transitions for a
 * rollback execution.
 */
export class RollbackRecordModel {
  static create(input: RollbackRecordCreateInput): RollbackRecord {
    return {
      id: newId(),
      storeId: input.storeId,
      planId: input.planId,
      taskId: input.taskId,
      status: 'PENDING',
      steps: input.rollback.steps.map((step) => ({ ...step })),
      reason: input.reason,
      error: null,
      startedAt: input.now(),
      completedAt: null,
      createdAt: input.now(),
    };
  }

  static fromRecord(record: RollbackRecord): RollbackRecord {
    return { ...record };
  }

  static complete(
    record: RollbackRecord,
    completedAt: Date,
  ): RollbackRecord {
    return { ...record, status: 'COMPLETED', completedAt };
  }

  static fail(record: RollbackRecord, error: string, completedAt: Date): RollbackRecord {
    return { ...record, status: 'FAILED', error, completedAt };
  }

  static setStatus(record: RollbackRecord, status: RollbackStatus): RollbackRecord {
    return { ...record, status };
  }
}

/** Marks every task of a plan as rolled back (or a single task when given). */
export function planRolledBack(
  plan: ExecutionPlan,
  taskId: string | null,
  now: () => Date,
): ExecutionPlan {
  const tasks = plan.tasks.map((task) => {
    if (taskId !== null && task.id !== taskId) return { ...task };
    if (task.status === 'COMPLETED' || task.status === 'FAILED' || task.status === 'IN_PROGRESS') {
      return { ...task, status: 'ROLLED_BACK' as const, updatedAt: now() };
    }
    return { ...task };
  });
  return { ...plan, tasks, status: 'ROLLED_BACK', updatedAt: now() };
}
