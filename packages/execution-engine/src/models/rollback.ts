import type { RollbackRecord } from '../types/rollback.js';
import type { RollbackScope, RollbackStatus } from '../types/shared.js';
import { deterministicUuid } from '../utils/ids.js';

export interface BuildRollbackOptions {
  executionId: string;
  storeId: string;
  scope: RollbackScope;
  mode: string;
  status?: RollbackStatus;
  stepId?: string | null;
  batchId?: string | null;
  plan?: RollbackRecord['plan'];
  reason: string;
  createdAt?: Date;
}

export function buildRollbackRecord(options: BuildRollbackOptions): RollbackRecord {
  const now = options.createdAt ?? new Date();
  return {
    id: deterministicUuid(
      `${options.executionId}|${options.scope}|${options.stepId ?? 'all'}|${options.reason}`,
    ),
    executionId: options.executionId,
    stepId: options.stepId ?? null,
    batchId: options.batchId ?? null,
    storeId: options.storeId,
    scope: options.scope,
    mode: options.mode,
    status: options.status ?? 'PENDING',
    plan: options.plan ?? null,
    reason: options.reason,
    error: null,
    apiCalls: 0,
    startedAt: null,
    completedAt: null,
    createdAt: now,
  };
}
