/**
 * Plan, task, and batch types. A {@link ExecutionPlan} is the ordered,
 * batched, dependency-resolved, approval-gated set of changes derived from a
 * decision. Tasks are the atomic unit of execution; batches group compatible
 * work to optimize API usage.
 */

import type { ExecutionResult, RiskLevel, RollbackPlan } from './result.js';
import type { ResourceType, TaskActionType } from './actions.js';

export type { ResourceType, TaskActionType } from './actions.js';

export type TaskStatus =
  | 'PENDING'
  | 'READY'
  | 'BLOCKED'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'FAILED'
  | 'SKIPPED'
  | 'ROLLED_BACK';

export type PlanStatus =
  | 'DRAFT'
  | 'AWAITING_APPROVAL'
  | 'APPROVED'
  | 'REJECTED'
  | 'EXECUTING'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED'
  | 'ROLLED_BACK';

export interface ExecutionTask {
  id: string;
  storeId: string;
  decisionId: string;
  planId: string;
  recommendationId: string;
  rule: string;
  actionType: TaskActionType;
  resourceType: ResourceType;
  /** Stable business key of the resource (URL or platform id). */
  resourceId: string;
  /** Human-readable reference to the resource. */
  resourceRef: string;
  /** The concrete change to apply (JSON-safe). */
  payload: Record<string, unknown>;
  /** 0..100 derived priority. */
  priority: number;
  status: TaskStatus;
  /** Task ids that must complete first. */
  dependsOn: string[];
  /** Whether this action writes store data (drives rollback/risk). */
  isMutating: boolean;
  risk: RiskLevel;
  estimatedSeconds: number;
  rollback: RollbackPlan | null;
  result: ExecutionResult | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ExecutionBatch {
  id: string;
  storeId: string;
  planId: string;
  resourceType: Exclude<ResourceType, 'store'>;
  actionType: TaskActionType;
  taskIds: string[];
  /** Deterministic execution order within the plan. */
  order: number;
  status: TaskStatus;
  estimatedSeconds: number;
  /** Estimated API calls this batch needs after grouping. */
  apiCalls: number;
}

export interface PlanDependency {
  taskId: string;
  dependsOn: string;
}

export interface ExecutionPlan {
  id: string;
  storeId: string;
  decisionId: string;
  status: PlanStatus;
  version: number;
  tasks: ExecutionTask[];
  batches: ExecutionBatch[];
  orderedTaskIds: string[];
  dependencies: PlanDependency[];
  approvalRequestId: string | null;
  estimatedDurationMinutes: number;
  totalEffortHours: number;
  totalImpact: number;
  risk: RiskLevel;
  createdAt: Date;
  updatedAt: Date;
}
