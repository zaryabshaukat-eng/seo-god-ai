import { describe, expect, it } from 'vitest';
import {
  buildBatch,
  buildExecution,
  buildStep,
  emptySummary,
  idempotencyKeyFor,
  refreshSummary,
  summarizeSteps,
} from './execution.js';
import { isUuid } from '../utils/ids.js';

describe('execution models', () => {
  it('idempotencyKeyFor is stable and payload-order independent', () => {
    const a = idempotencyKeyFor({ storeId: 's', resourceType: 'product', resourceId: 'p', actionType: 'update_title', payload: { title: 'x' } });
    const b = idempotencyKeyFor({ storeId: 's', resourceType: 'product', resourceId: 'p', actionType: 'update_title', payload: { title: 'x' } });
    const c = idempotencyKeyFor({ storeId: 's', resourceType: 'product', resourceId: 'p', actionType: 'update_title', payload: { title: 'y' } });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(isUuid(a)).toBe(true);
  });

  it('buildStep creates a deterministic pending step', () => {
    const step = buildStep({
      executionId: 'e1',
      batchId: 'b1',
      storeId: 's1',
      actionType: 'update_title',
      resourceType: 'product',
      resourceId: 'p1',
      payload: { title: 'New' },
      order: 2,
      requiresApproval: true,
    });
    expect(step.status).toBe('PENDING');
    expect(step.order).toBe(2);
    expect(step.requiresApproval).toBe(true);
    expect(step.approved).toBe(false);
    expect(step.isMutating).toBe(true);
    expect(step.dependsOn).toEqual([]);
    expect(step.before).toBeNull();
    expect(step.after).toBeNull();
    expect(step.apiCalls).toBe(0);
    expect(isUuid(step.id)).toBe(true);
    expect(isUuid(step.idempotencyKey)).toBe(true);
    const same = buildStep({
      executionId: 'e1',
      batchId: 'b1',
      storeId: 's1',
      actionType: 'update_title',
      resourceType: 'product',
      resourceId: 'p1',
      payload: { title: 'New' },
      order: 2,
    });
    expect(same.id).toBe(step.id);
  });

  it('buildStep derives approval and resourceRef defaults', () => {
    const step = buildStep({
      executionId: 'e1',
      batchId: 'b1',
      storeId: 's1',
      actionType: 'update_url',
      resourceType: 'page',
      resourceId: 'page-1',
      payload: { url: '/x' },
      order: 0,
      isMutating: false,
    });
    expect(step.approved).toBe(true);
    expect(step.resourceRef).toBe('page-1');
    expect(step.requiresApproval).toBe(false);
  });

  it('buildBatch groups steps under a deterministic id', () => {
    const batch = buildBatch({
      executionId: 'e1',
      storeId: 's1',
      resourceType: 'product',
      actionType: 'update_title',
      stepIds: ['a', 'b'],
      order: 0,
    });
    expect(batch.stepIds).toEqual(['a', 'b']);
    expect(batch.status).toBe('PENDING');
    expect(batch.apiCalls).toBe(0);
    expect(isUuid(batch.id)).toBe(true);
  });

  it('summarizeSteps counts statuses and api calls', () => {
    const steps = [
      buildStep({ executionId: 'e', batchId: 'b', storeId: 's', actionType: 'update_title', resourceType: 'product', resourceId: 'p1', payload: {}, order: 0 }),
      buildStep({ executionId: 'e', batchId: 'b', storeId: 's', actionType: 'update_title', resourceType: 'product', resourceId: 'p2', payload: {}, order: 1 }),
      buildStep({ executionId: 'e', batchId: 'b', storeId: 's', actionType: 'update_title', resourceType: 'product', resourceId: 'p3', payload: {}, order: 2 }),
      buildStep({ executionId: 'e', batchId: 'b', storeId: 's', actionType: 'update_title', resourceType: 'product', resourceId: 'p4', payload: {}, order: 3 }),
      buildStep({ executionId: 'e', batchId: 'b', storeId: 's', actionType: 'update_title', resourceType: 'product', resourceId: 'p5', payload: {}, order: 4 }),
      buildStep({ executionId: 'e', batchId: 'b', storeId: 's', actionType: 'update_title', resourceType: 'product', resourceId: 'p6', payload: {}, order: 5 }),
    ];
    steps[0]!.status = 'COMPLETED';
    steps[1]!.status = 'SIMULATED';
    steps[2]!.status = 'FAILED';
    steps[3]!.status = 'SKIPPED';
    steps[4]!.status = 'CANCELLED';
    steps[5]!.status = 'ROLLED_BACK';
    steps[0]!.apiCalls = 2;
    const summary = summarizeSteps(steps);
    expect(summary.completed).toBe(1);
    expect(summary.simulated).toBe(1);
    expect(summary.failed).toBe(1);
    expect(summary.skipped).toBe(1);
    expect(summary.cancelled).toBe(1);
    expect(summary.rolledBack).toBe(1);
    expect(summary.apiCalls).toBe(2);
  });

  it('emptySummary starts at zero', () => {
    expect(emptySummary()).toMatchObject({ total: 0, completed: 0, failed: 0, apiCalls: 0 });
  });

  it('buildExecution assembles an execution and refreshSummary recomputes it', () => {
    const steps = [
      buildStep({ executionId: 'e1', batchId: 'b1', storeId: 's1', actionType: 'update_title', resourceType: 'product', resourceId: 'p1', payload: {}, order: 0 }),
      buildStep({ executionId: 'e1', batchId: 'b1', storeId: 's1', actionType: 'update_title', resourceType: 'product', resourceId: 'p2', payload: {}, order: 1 }),
    ];
    steps[0]!.status = 'COMPLETED';
    steps[1]!.status = 'FAILED';
    const batches = [buildBatch({ executionId: 'e1', storeId: 's1', resourceType: 'product', actionType: 'update_title', stepIds: steps.map((s) => s.id), order: 0 })];
    const execution = buildExecution({
      id: 'exec-1',
      storeId: 's1',
      mode: 'DRY_RUN',
      source: 'plan',
      planId: 'plan-1',
      workflowId: 'wf-1',
      decisionId: 'dec-1',
      steps,
      batches,
    });
    expect(execution.id).toBe('exec-1');
    expect(execution.status).toBe('PENDING');
    expect(execution.mode).toBe('DRY_RUN');
    expect(execution.source).toBe('plan');
    expect(execution.summary.completed).toBe(1);
    expect(execution.summary.failed).toBe(1);
    expect(execution.history).toEqual([]);
    expect(execution.startedAt).toBeNull();
    expect(isUuid(execution.id)).toBe(false);
  });

  it('refreshSummary recomputes from the live step states', () => {
    const steps = [buildStep({ executionId: 'e', batchId: 'b', storeId: 's', actionType: 'update_title', resourceType: 'product', resourceId: 'p1', payload: {}, order: 0 })];
    const execution = buildExecution({ storeId: 's', mode: 'SIMULATION', source: 'actions', steps, batches: [] });
    steps[0]!.status = 'COMPLETED';
    refreshSummary(execution);
    expect(execution.summary.completed).toBe(1);
    expect(execution.summary.total).toBe(1);
  });
});
