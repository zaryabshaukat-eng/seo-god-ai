import type { ExecutionTask, TaskStatus } from '../types/plan.js';
import type { ExecutionResult, RollbackPlan } from '../types/result.js';

/**
 * Execution task model: pure helpers that derive task state transitions.
 * Tasks are treated as immutable values; each transition returns a copy.
 */
export class ExecutionTaskModel {
  static fromRecord(record: ExecutionTask): ExecutionTask {
    return { ...record };
  }

  static setStatus(task: ExecutionTask, status: TaskStatus, now: () => Date): ExecutionTask {
    return { ...task, status, updatedAt: now() };
  }

  static attachRollback(task: ExecutionTask, rollback: RollbackPlan | null): ExecutionTask {
    return { ...task, rollback };
  }

  static attachResult(task: ExecutionTask, result: ExecutionResult): ExecutionTask {
    return { ...task, result, updatedAt: result.completedAt };
  }
}
