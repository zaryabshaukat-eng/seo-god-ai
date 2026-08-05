import type { ExecutionEvent } from '@seogod/execution-engine';
import type { ExecutionReport } from '@seogod/execution-engine';
import type { ExecutionStatus } from '@seogod/execution-engine';

export interface EventFactory {
  executionId: string;
  storeId: string;
}

/** Builds a fully-populated execution event (the engine always emits the
 * logging contract fields). */
export function executionEvent(
  type: ExecutionEvent['type'],
  overrides: Partial<ExecutionEvent> & { executionId?: string; storeId?: string } = {},
): ExecutionEvent {
  return {
    type,
    executionId: 'exec-1',
    storeId: 'store-1',
    batchId: 'batch-1',
    workflowId: 'wf-1',
    entityType: 'page',
    entityId: 'page-1',
    operation: 'seo.update_title',
    retryCount: 0,
    ...overrides,
  } as ExecutionEvent;
}

export interface ReportSeed {
  executionId?: string;
  storeId?: string;
  status?: string;
  startedAt?: Date;
  completedAt?: Date;
  summaryOverrides?: Partial<ExecutionReport['execution']['summary']>;
  diffCount?: number;
  hasChanges?: boolean;
  rollbackCompleted?: boolean;
  rollbackStatus?: string;
}

/** Builds a synthetic execution report for `recordReport` tests. */
export function buildReport(seed: ReportSeed = {}): ExecutionReport {
  const executionId = seed.executionId ?? 'exec-1';
  const storeId = seed.storeId ?? 'store-1';
  const startedAt = seed.startedAt ?? new Date('2026-01-01T00:00:00.000Z');
  const completedAt = seed.completedAt ?? new Date('2026-01-01T00:00:01.000Z');
  const hasChanges = seed.hasChanges ?? true;
  const summary = {
    total: 2,
    completed: 1,
    simulated: 1,
    failed: 0,
    skipped: 0,
    cancelled: 0,
    rolledBack: 0,
    apiCalls: 3,
    durationMs: 1000,
    ...seed.summaryOverrides,
  };

  return {
    execution: {
      id: executionId,
      storeId,
      planId: 'plan-1',
      workflowId: 'wf-1',
      decisionId: 'decision-1',
      mode: 'PRODUCTION',
      source: 'plan',
      status: (seed.status ?? 'COMPLETED') as ExecutionStatus,
      steps: [
        {
          id: 'step-1',
          executionId,
          batchId: 'batch-1',
          taskId: null,
          workflowId: 'wf-1',
          storeId,
          planId: 'plan-1',
          decisionId: 'decision-1',
          recommendationId: 'rec-1',
          actionType: 'seo.update_title',
          resourceType: 'page',
          resourceId: 'page-1',
          resourceRef: 'https://store.com/page-1',
          payload: { title: 'New Title' },
          dependsOn: [],
          before: { title: 'Old Title' },
          after: { title: 'New Title' },
          expectedAfter: null,
          status: 'COMPLETED',
          priority: 1,
          order: 0,
          isMutating: true,
          requiresApproval: false,
          approved: true,
          approvalRequestId: null,
          attemptCount: 1,
          maxAttempts: 3,
          idempotencyKey: 'idem-1',
          diffId: 'diff-1',
          rollbackPlan: null,
          rollbackId: null,
          durationMs: 1000,
          apiCalls: 2,
          error: null,
          createdAt: startedAt,
          updatedAt: completedAt,
        },
      ],
      batches: [],
      history: [],
      summary,
      startedAt,
      completedAt,
      createdAt: startedAt,
      updatedAt: completedAt,
    },
    diffs: [
      {
        id: `diff-${executionId}`,
        executionId,
        stepId: 'step-1',
        storeId,
        resourceType: 'page',
        resourceId: 'page-1',
        actionType: 'seo.update_title',
        entityId: 'page-1',
        changedFields: ['title'],
        changes: [{ field: 'title', kind: 'changed', previous: 'Old Title', next: 'New Title' }],
        summary: 'title changed',
        before: { title: 'Old Title' },
        after: { title: 'New Title' },
        hasChanges,
        createdAt: startedAt,
      },
    ],
    rollbacks: seed.rollbackCompleted || seed.rollbackStatus !== undefined
      ? [
          {
            id: 'rollback-1',
            executionId,
            stepId: 'step-1',
            batchId: 'batch-1',
            storeId,
            scope: 'single',
            mode: 'PRODUCTION',
            status: (seed.rollbackStatus ?? 'COMPLETED') as 'COMPLETED' | 'FAILED',
            plan: {
              available: true,
              reason: undefined,
              steps: [
                {
                  action: 'restore_field',
                  resourceType: 'page',
                  resourceId: 'page-1',
                  payload: { title: 'Old Title' },
                },
              ],
            },
            reason: 'user requested',
            error: null,
            apiCalls: 1,
            startedAt: completedAt,
            completedAt,
            createdAt: completedAt,
          },
        ]
      : [],
    metrics: {
      executionId,
      storeId,
      mode: 'PRODUCTION',
      startedAt,
      completedAt,
      durationMs: 1000,
      totalSteps: 2,
      completed: 1,
      simulated: 1,
      failed: 0,
      skipped: 0,
      cancelled: 0,
      rolledBack: 0,
      apiCalls: 3,
      writeRate: 1.5,
      batchSize: 1,
      rollbacks: 0,
      averageStepTimeMs: 500,
      createdAt: completedAt,
    },
    validations: {},
  };
}
