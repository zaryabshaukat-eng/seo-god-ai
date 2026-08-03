/**
 * Executor contract and service-level result types. The executor is the
 * adapter that performs real work (e.g. Shopify mutations); the service stays
 * deterministic and the executor is injected.
 */

import type { ExecutionResult, RollbackPlan, RollbackRecord } from './result.js';
import type { ExecutionTask, ExecutionPlan } from './plan.js';
import type { Decision } from './decision.js';
import type { PrioritizedRecommendation } from './prioritizer.js';
import type { ConflictReport } from './conflict.js';
import type { ApprovalRequest } from './approval.js';

/** Performs the actual work of a task and of its rollback. */
export interface PlanExecutor {
  executeTask(task: ExecutionTask): Promise<ExecutionResult>;
  executeRollback(plan: RollbackPlan): Promise<{
    status: 'COMPLETED' | 'FAILED';
    error?: string;
    completedAt: Date;
  }>;
}

export interface DecisionEngineResult {
  decision: Decision;
  prioritized: PrioritizedRecommendation[];
}

export interface PlanResult {
  decision: Decision;
  plan: ExecutionPlan;
  approvalRequest: ApprovalRequest;
  conflicts: ConflictReport;
  prioritized: PrioritizedRecommendation[];
}

export interface ApprovalResult {
  plan: ExecutionPlan;
  approvalRequest: ApprovalRequest;
}

export interface ExecutionPlanResult {
  plan: ExecutionPlan;
  results: ExecutionResult[];
}

export interface RollbackResult {
  records: RollbackRecord[];
  plan: ExecutionPlan;
}
