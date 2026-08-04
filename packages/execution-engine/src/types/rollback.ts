/**
 * Rollback types. A {@link RollbackPlan} is produced before every mutating
 * step and describes how to undo it; a completed rollback is recorded as a
 * {@link RollbackRecord}. Rollback is only available when the previous state
 * was captured and the operation supports restoring it.
 */

import type { RollbackScope, RollbackStatus, RollbackStepAction } from './shared.js';

export interface RollbackStep {
  action: RollbackStepAction;
  resourceType: string;
  resourceId: string;
  payload: Record<string, unknown>;
}

export interface RollbackPlan {
  /** False when the previous state is unknown or cannot be restored. */
  available: boolean;
  /** Why the rollback is (or is not) available. */
  reason: string | undefined;
  steps: RollbackStep[];
}

export interface RollbackRecord {
  id: string;
  executionId: string;
  stepId: string | null;
  batchId: string | null;
  storeId: string;
  scope: RollbackScope;
  mode: string;
  status: RollbackStatus;
  plan: RollbackPlan | null;
  reason: string;
  error: string | null;
  apiCalls: number;
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
}
