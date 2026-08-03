/**
 * Risk, execution-result, and rollback types. Every mutating task carries a
 * {@link RollbackPlan} describing how to undo it; a completed rollback is
 * recorded as a {@link RollbackRecord}.
 */

import type { ResourceType, TaskActionType } from './actions.js';

export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH';

export type ExecutionResultStatus = 'SUCCESS' | 'FAILURE' | 'SKIPPED';

export type RollbackStatus = 'PENDING' | 'COMPLETED' | 'FAILED';

export interface ExecutionResult {
  id: string;
  taskId: string;
  planId: string;
  storeId: string;
  status: ExecutionResultStatus;
  durationMs: number;
  message: string;
  apiResponses: Record<string, unknown>[];
  startedAt: Date;
  completedAt: Date;
}

export type RollbackStepAction =
  | 'restore_field'
  | 'restore_position'
  | 'recreate'
  | 'restore'
  | 'revert';

export interface RollbackStep {
  action: RollbackStepAction;
  resourceType: string;
  resourceId: string;
  payload: Record<string, unknown>;
}

export interface RollbackPlan {
  taskId: string;
  storeId: string;
  planId: string;
  actionType: TaskActionType;
  resourceType: ResourceType;
  resourceId: string;
  /** False when the previous state is unknown and cannot be restored. */
  available: boolean;
  /** Why the rollback is (or is not) available. */
  reason: string;
  steps: RollbackStep[];
}

export interface RollbackRecord {
  id: string;
  storeId: string;
  planId: string;
  taskId: string;
  status: RollbackStatus;
  steps: RollbackStep[];
  reason: string;
  error: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
}
