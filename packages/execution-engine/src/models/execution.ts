import type {
  Execution,
  ExecutionBatch,
  ExecutionStep,
  ExecutionSummary,
} from '../types/execution.js';
import type { ExecutionMode, ExecutionSource } from '../types/shared.js';
import { deterministicUuid, newId } from '../utils/ids.js';

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/** Stable idempotency key: store + resource + action + normalized payload. */
export function idempotencyKeyFor(input: {
  storeId: string;
  resourceType: string;
  resourceId: string;
  actionType: string;
  payload: Record<string, unknown>;
}): string {
  return deterministicUuid(
    `${input.storeId}|${input.resourceType}|${input.resourceId}|${input.actionType}|${stableStringify(input.payload)}`,
  );
}

export interface BuildStepOptions {
  executionId: string;
  batchId: string;
  storeId: string;
  actionType: string;
  resourceType: string;
  resourceId: string;
  resourceRef?: string;
  payload: Record<string, unknown>;
  order: number;
  taskId?: string | null;
  workflowId?: string | null;
  planId?: string | null;
  decisionId?: string | null;
  recommendationId?: string | null;
  priority?: number;
  isMutating?: boolean;
  requiresApproval?: boolean;
  approved?: boolean;
  approvalRequestId?: string | null;
  dependsOn?: string[];
  maxAttempts?: number;
  idempotencyKey?: string;
  createdAt?: Date;
}

export function buildStep(options: BuildStepOptions): ExecutionStep {
  const now = options.createdAt ?? new Date();
  return {
    id: deterministicUuid(
      `${options.executionId}|${options.actionType}|${options.resourceId}|${options.order}`,
    ),
    executionId: options.executionId,
    batchId: options.batchId,
    taskId: options.taskId ?? null,
    workflowId: options.workflowId ?? null,
    storeId: options.storeId,
    planId: options.planId ?? null,
    decisionId: options.decisionId ?? null,
    recommendationId: options.recommendationId ?? null,
    actionType: options.actionType,
    resourceType: options.resourceType,
    resourceId: options.resourceId,
    resourceRef: options.resourceRef ?? options.resourceId,
    payload: options.payload,
    dependsOn: options.dependsOn ?? [],
    before: null,
    after: null,
    expectedAfter: null,
    status: 'PENDING',
    priority: options.priority ?? 0,
    order: options.order,
    isMutating: options.isMutating ?? true,
    requiresApproval: options.requiresApproval ?? false,
    approved: options.approved ?? !(options.requiresApproval ?? false),
    approvalRequestId: options.approvalRequestId ?? null,
    attemptCount: 0,
    maxAttempts: options.maxAttempts ?? 1,
    idempotencyKey:
      options.idempotencyKey ??
      idempotencyKeyFor({
        storeId: options.storeId,
        resourceType: options.resourceType,
        resourceId: options.resourceId,
        actionType: options.actionType,
        payload: options.payload,
      }),
    diffId: null,
    rollbackPlan: null,
    rollbackId: null,
    durationMs: null,
    apiCalls: 0,
    error: null,
    createdAt: now,
    updatedAt: now,
  };
}

export interface BuildBatchOptions {
  executionId: string;
  storeId: string;
  resourceType: string;
  actionType: string;
  stepIds: string[];
  order: number;
  createdAt?: Date;
}

export function buildBatch(options: BuildBatchOptions): ExecutionBatch {
  const now = options.createdAt ?? new Date();
  return {
    id: deterministicUuid(
      `${options.executionId}|${options.resourceType}|${options.actionType}|${options.order}`,
    ),
    executionId: options.executionId,
    storeId: options.storeId,
    resourceType: options.resourceType,
    actionType: options.actionType,
    stepIds: options.stepIds,
    order: options.order,
    status: 'PENDING',
    apiCalls: 0,
    createdAt: now,
    updatedAt: now,
  };
}

export function emptySummary(): ExecutionSummary {
  return {
    total: 0,
    completed: 0,
    simulated: 0,
    failed: 0,
    skipped: 0,
    cancelled: 0,
    rolledBack: 0,
    apiCalls: 0,
    durationMs: null,
  };
}

export function summarizeSteps(steps: ExecutionStep[]): ExecutionSummary {
  const summary = emptySummary();
  summary.total = steps.length;
  for (const step of steps) {
    switch (step.status) {
      case 'COMPLETED':
        summary.completed += 1;
        break;
      case 'SIMULATED':
        summary.simulated += 1;
        break;
      case 'FAILED':
        summary.failed += 1;
        break;
      case 'SKIPPED':
        summary.skipped += 1;
        break;
      case 'CANCELLED':
        summary.cancelled += 1;
        break;
      case 'ROLLED_BACK':
        summary.rolledBack += 1;
        break;
      default:
        break;
    }
    summary.apiCalls += step.apiCalls;
  }
  return summary;
}

export interface BuildExecutionOptions {
  id?: string;
  storeId: string;
  mode: ExecutionMode;
  source: ExecutionSource;
  planId?: string | null;
  workflowId?: string | null;
  decisionId?: string | null;
  steps: ExecutionStep[];
  batches: ExecutionBatch[];
  createdAt?: Date;
}

export function buildExecution(options: BuildExecutionOptions): Execution {
  const now = options.createdAt ?? new Date();
  return {
    id: options.id ?? newId(),
    storeId: options.storeId,
    planId: options.planId ?? null,
    workflowId: options.workflowId ?? null,
    decisionId: options.decisionId ?? null,
    mode: options.mode,
    source: options.source,
    status: 'PENDING',
    steps: options.steps,
    batches: options.batches,
    history: [],
    summary: summarizeSteps(options.steps),
    startedAt: null,
    completedAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

/** Recomputes the summary from the current step states. */
export function refreshSummary(execution: Execution): void {
  execution.summary = summarizeSteps(execution.steps);
}
