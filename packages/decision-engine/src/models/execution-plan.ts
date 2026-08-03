import type {
  ExecutionBatch,
  ExecutionPlan,
  ExecutionTask,
  PlanDependency,
  PlanStatus,
} from '../types/plan.js';
import type { ExecutionResult, RiskLevel } from '../types/result.js';

export interface ExecutionPlanCreateInput {
  id: string;
  storeId: string;
  decisionId: string;
  version: number;
  tasks: ExecutionTask[];
  batches: ExecutionBatch[];
  orderedTaskIds: string[];
  dependencies: PlanDependency[];
  estimatedDurationMinutes: number;
  totalEffortHours: number;
  totalImpact: number;
  risk: RiskLevel;
  now: () => Date;
}

/**
 * Execution plan model: creation and deterministic status transitions. The
 * plan is treated as an immutable value; each transition returns a copy.
 */
export class ExecutionPlanModel {
  static create(input: ExecutionPlanCreateInput): ExecutionPlan {
    return {
      id: input.id,
      storeId: input.storeId,
      decisionId: input.decisionId,
      status: 'DRAFT',
      version: input.version,
      tasks: input.tasks.map((task) => ({ ...task })),
      batches: input.batches.map((batch) => ({ ...batch })),
      orderedTaskIds: [...input.orderedTaskIds],
      dependencies: input.dependencies.map((dependency) => ({ ...dependency })),
      approvalRequestId: null,
      estimatedDurationMinutes: input.estimatedDurationMinutes,
      totalEffortHours: input.totalEffortHours,
      totalImpact: input.totalImpact,
      risk: input.risk,
      createdAt: input.now(),
      updatedAt: input.now(),
    };
  }

  static fromRecord(record: ExecutionPlan): ExecutionPlan {
    return {
      ...record,
      tasks: record.tasks.map((task) => ({ ...task })),
      batches: record.batches.map((batch) => ({ ...batch })),
      orderedTaskIds: [...record.orderedTaskIds],
      dependencies: record.dependencies.map((dependency) => ({ ...dependency })),
    };
  }

  static setStatus(plan: ExecutionPlan, status: PlanStatus, now: () => Date): ExecutionPlan {
    return { ...plan, status, updatedAt: now() };
  }

  static setApprovalRequestId(plan: ExecutionPlan, approvalRequestId: string): ExecutionPlan {
    return { ...plan, approvalRequestId };
  }

  static setTaskStatus(
    plan: ExecutionPlan,
    taskId: string,
    status: ExecutionPlan['tasks'][number]['status'],
    now: () => Date,
  ): ExecutionPlan {
    const tasks = plan.tasks.map((task) =>
      task.id === taskId ? { ...task, status, updatedAt: now() } : { ...task },
    );
    return { ...plan, tasks, updatedAt: now() };
  }

  static setTaskResult(plan: ExecutionPlan, taskId: string, result: ExecutionResult): ExecutionPlan {
    const tasks = plan.tasks.map((task) =>
      task.id === taskId ? { ...task, result, updatedAt: result.completedAt } : { ...task },
    );
    return { ...plan, tasks, updatedAt: result.completedAt };
  }

  static setBatchStatuses(plan: ExecutionPlan, status: ExecutionPlan['batches'][number]['status']): ExecutionPlan {
    const batches = plan.batches.map((batch) => ({ ...batch, status }));
    return { ...plan, batches };
  }

  static taskById(plan: ExecutionPlan, taskId: string): ExecutionTask | undefined {
    return plan.tasks.find((task) => task.id === taskId);
  }
}
