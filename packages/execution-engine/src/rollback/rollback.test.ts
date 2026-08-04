import { describe, expect, it, vi } from 'vitest';
import type { RollbackPlan as DecisionRollbackPlan } from '@seogod/decision-engine';
import type { ExecutionStep } from '../types/execution.js';
import type { RollbackPlan } from '../types/rollback.js';
import { buildStep } from '../models/execution.js';
import { OperationPublisher } from '../publisher/publisher.js';
import { MemoryShopifyWriter } from '../publisher/shopify-writer.js';
import { RollbackEngine } from './engine.js';
import { RollbackPlanner } from './planner.js';
import { validateRollbackCapability } from './validator.js';

function decisionPlan(overrides: Partial<DecisionRollbackPlan>): DecisionRollbackPlan {
  return {
    taskId: 't1',
    storeId: 's1',
    planId: 'p1',
    actionType: 'update_title',
    resourceType: 'product',
    resourceId: 'p1',
    available: true,
    reason: 'reason',
    steps: [],
    ...overrides,
  };
}

function step(overrides: Partial<ExecutionStep> = {}): ExecutionStep {
  const built = buildStep({
    executionId: 'e1',
    batchId: 'b1',
    storeId: 's1',
    actionType: 'update_title',
    resourceType: 'product',
    resourceId: 'p1',
    payload: { title: 'New' },
    order: 0,
  });
  return { ...built, ...overrides };
}

function availablePlan(before: Record<string, unknown>): RollbackPlan {
  return {
    available: true,
    reason: undefined,
    steps: [
      { action: 'restore_field', resourceType: 'product', resourceId: 'p1', payload: { field: 'title', value: before.title } },
    ],
  };
}

describe('RollbackPlanner', () => {
  const planner = new RollbackPlanner();

  it('returns null for a null decision plan', () => {
    expect(planner.planFromDecision(null)).toBeNull();
  });

  it('converts an available decision plan into execution rollback steps', () => {
    const decision = decisionPlan({
      reason: 'from decision',
      steps: [{ action: 'restore_field', resourceType: 'product', resourceId: 'p1', payload: { title: 'Old' } }],
    });
    const plan = planner.planFromDecision(decision);
    expect(plan?.available).toBe(true);
    expect(plan?.steps).toEqual([
      { action: 'restore_field', resourceType: 'product', resourceId: 'p1', payload: { title: 'Old' } },
    ]);
  });

  it('marks an unavailable decision plan with the decision reason', () => {
    const plan = planner.planFromDecision(decisionPlan({ available: false, reason: 'no snapshot' }));
    expect(plan?.available).toBe(false);
    expect(plan?.reason).toBe('no snapshot');
  });

  it('falls back to a generic reason for an unavailable decision with none', () => {
    const plan = planner.planFromDecision(decisionPlan({ available: false, reason: undefined }));
    expect(plan?.available).toBe(false);
    expect(plan?.reason).toBe('decision plan marked unavailable');
  });

  it('maps unknown decision actions to revert', () => {
    const plan = planner.planFromDecision(
      decisionPlan({
        steps: [{ action: 'made_up_action' as DecisionRollbackPlan['steps'][number]['action'], resourceType: 'product', resourceId: 'p1', payload: {} }],
      }),
    );
    expect(plan?.steps[0]?.action).toBe('revert');
  });

  it('is unavailable when forceUnavailableReason is set', () => {
    const forced = new RollbackPlanner({ forceUnavailableReason: 'writer cannot restore' });
    const plan = forced.planFromDecision(decisionPlan({ reason: undefined }));
    expect(plan?.available).toBe(false);
    expect(plan?.reason).toBe('writer cannot restore');
  });

  it('derives field-level restore steps from a step before-state', () => {
    const plan = planner.planForStep(step({ before: { title: 'Old', seo: { title: 'Old SEO' } } }));
    expect(plan?.available).toBe(true);
    expect(plan?.steps).toHaveLength(2);
    expect(plan?.steps[0]).toEqual({
      action: 'restore_field',
      resourceType: 'unknown',
      resourceId: '',
      payload: { field: 'title', value: 'Old' },
    });
  });

  it('returns an empty available plan for read-only steps', () => {
    const plan = planner.planForStep(step({ isMutating: false }));
    expect(plan?.available).toBe(true);
    expect(plan?.steps).toHaveLength(0);
  });

  it('returns a restore plan for primitive before-state', () => {
    const plan = planner.planForStep(step({ before: 'abc' as unknown as Record<string, unknown> }));
    expect(plan?.steps[0]?.action).toBe('restore');
    expect(plan?.steps[0]?.payload).toEqual({ before: 'abc' });
  });

  it('is unavailable for mutating steps with no before-state', () => {
    const plan = planner.planForStep(step({ before: null }));
    expect(plan?.available).toBe(true);
    expect(plan?.reason).toBe('nothing was modified');
  });
});

describe('validateRollbackCapability', () => {
  it('fails when there is no rollback plan', () => {
    expect(validateRollbackCapability(step({ rollbackPlan: null })).valid).toBe(false);
  });

  it('fails when the plan is unavailable', () => {
    const result = validateRollbackCapability(step({ rollbackPlan: { available: false, reason: 'nope', steps: [] } }));
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('nope');
  });

  it('uses a default reason for an unavailable plan', () => {
    const result = validateRollbackCapability(step({ rollbackPlan: { available: false, reason: undefined, steps: [] } }));
    expect(result.reason).toBe('rollback plan is not available');
  });

  it('fails for a mutating step without a recorded before-state', () => {
    const result = validateRollbackCapability(step({ rollbackPlan: availablePlan({ title: 'Old' }), before: null }));
    expect(result.valid).toBe(false);
  });

  it('passes when a plan exists, is available, and the state was recorded', () => {
    const result = validateRollbackCapability(step({ rollbackPlan: availablePlan({ title: 'Old' }), before: { title: 'Old' } }));
    expect(result.valid).toBe(true);
  });
});

describe('RollbackEngine', () => {
  it('rolls back a step through the publisher and counts api calls', async () => {
    const writer = new MemoryShopifyWriter();
    const publisher = new OperationPublisher({ writer });
    const engine = new RollbackEngine({ publisher });
    const theStep = step({ before: { title: 'Old' }, rollbackPlan: availablePlan({ title: 'Old' }) });
    const result = await engine.rollbackStep(theStep, 'shop');
    expect(result.status).toBe('COMPLETED');
    expect(result.apiCalls).toBe(1);
    expect(result.error).toBeNull();
    expect(writer.calls).toHaveLength(1);
  });

  it('performs one restore call per rollback plan step', async () => {
    const writer = new MemoryShopifyWriter();
    const publisher = new OperationPublisher({ writer });
    const engine = new RollbackEngine({ publisher });
    const theStep = step({
      before: { title: 'Old' },
      rollbackPlan: {
        available: true,
        reason: undefined,
        steps: [
          { action: 'restore_field', resourceType: 'product', resourceId: 'p1', payload: { field: 'title', value: 'Old' } },
          { action: 'restore_field', resourceType: 'product', resourceId: 'p1', payload: { field: 'body', value: 'Old body' } },
        ],
      },
    });
    const result = await engine.rollbackStep(theStep, 'shop');
    expect(result.apiCalls).toBe(2);
    expect(writer.calls).toHaveLength(2);
  });

  it('returns FAILED when the step cannot be rolled back', async () => {
    const publisher = new OperationPublisher({ writer: new MemoryShopifyWriter() });
    const engine = new RollbackEngine({ publisher });
    const result = await engine.rollbackStep(step({ rollbackPlan: null }), 'shop');
    expect(result.status).toBe('FAILED');
    expect(result.error).toContain('no rollback plan');
  });

  it('returns FAILED with the error message when the publisher throws', async () => {
    const writer = new MemoryShopifyWriter();
    const publisher = new OperationPublisher({ writer });
    const engine = new RollbackEngine({ publisher });
    const restoreSpy = vi.spyOn(publisher, 'restore').mockRejectedValue(new Error('write exploded'));
    const result = await engine.rollbackStep(
      step({ before: { title: 'Old' }, rollbackPlan: availablePlan({ title: 'Old' }) }),
      'shop',
    );
    expect(result.status).toBe('FAILED');
    expect(result.error).toBe('write exploded');
    restoreSpy.mockRestore();
  });

  it('stringifies a non-Error publisher failure', async () => {
    const writer = new MemoryShopifyWriter();
    const publisher = new OperationPublisher({ writer });
    const engine = new RollbackEngine({ publisher });
    const restoreSpy = vi.spyOn(publisher, 'restore').mockRejectedValue('plain string');
    const result = await engine.rollbackStep(
      step({ before: { title: 'Old' }, rollbackPlan: availablePlan({ title: 'Old' }) }),
      'shop',
    );
    expect(result.status).toBe('FAILED');
    expect(result.error).toBe('plain string');
    restoreSpy.mockRestore();
  });

  it('does not call the publisher in dry-run mode', async () => {
    const writer = new MemoryShopifyWriter();
    const publisher = new OperationPublisher({ writer });
    const engine = new RollbackEngine({ publisher, dryRun: true });
    const theStep = step({ before: { title: 'Old' }, rollbackPlan: availablePlan({ title: 'Old' }) });
    const result = await engine.rollbackStep(theStep, 'shop');
    expect(result.status).toBe('COMPLETED');
    expect(result.apiCalls).toBe(0);
    expect(writer.calls).toHaveLength(0);
  });
});
