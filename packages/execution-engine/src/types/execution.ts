/**
 * Execution domain types. An {@link Execution} is the unit of work: it groups
 * {@link ExecutionBatch}es of {@link ExecutionStep}s, tracks a full history,
 * and accumulates a summary. Steps are the atomic unit of execution and carry
 * the concrete write payload, before/after state, diff and rollback plan.
 */

import type { RollbackPlan } from './rollback.js';
import type {
  BatchStatus,
  ExecutionMode,
  ExecutionSource,
  ExecutionStatus,
  StepStatus,
} from './shared.js';

export type { BatchStatus, ExecutionMode, ExecutionSource, ExecutionStatus, StepStatus };

export interface ExecutionHistoryEntry {
  at: Date;
  event: string;
  detail: Record<string, unknown> | null;
}

export interface ExecutionStep {
  id: string;
  executionId: string;
  batchId: string;
  taskId: string | null;
  workflowId: string | null;
  storeId: string;
  planId: string | null;
  decisionId: string | null;
  recommendationId: string | null;
  actionType: string;
  resourceType: string;
  resourceId: string;
  resourceRef: string;
  payload: Record<string, unknown>;
  /** Step ids that must complete (or be simulated) before this one. */
  dependsOn: string[];
  /** Current Shopify state captured immediately before the write, if known. */
  before: Record<string, unknown> | null;
  /** State observed after the write, if known. */
  after: Record<string, unknown> | null;
  /** The state the operation would produce (used by dry-run/simulation). */
  expectedAfter: Record<string, unknown> | null;
  status: StepStatus;
  priority: number;
  order: number;
  isMutating: boolean;
  requiresApproval: boolean;
  approved: boolean;
  approvalRequestId: string | null;
  attemptCount: number;
  maxAttempts: number;
  /** Stable key used to detect already-applied executions (idempotency). */
  idempotencyKey: string;
  diffId: string | null;
  rollbackPlan: RollbackPlan | null;
  rollbackId: string | null;
  durationMs: number | null;
  apiCalls: number;
  error: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ExecutionBatch {
  id: string;
  executionId: string;
  storeId: string;
  resourceType: string;
  actionType: string;
  stepIds: string[];
  order: number;
  status: BatchStatus;
  apiCalls: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface ExecutionSummary {
  total: number;
  completed: number;
  simulated: number;
  failed: number;
  skipped: number;
  cancelled: number;
  rolledBack: number;
  apiCalls: number;
  durationMs: number | null;
}

export interface Execution {
  id: string;
  storeId: string;
  planId: string | null;
  workflowId: string | null;
  decisionId: string | null;
  mode: ExecutionMode;
  source: ExecutionSource;
  status: ExecutionStatus;
  steps: ExecutionStep[];
  batches: ExecutionBatch[];
  history: ExecutionHistoryEntry[];
  summary: ExecutionSummary;
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
