import { describe, expect, it } from 'vitest';
import type { ExecutionPlan, ExecutionTask } from '@seogod/decision-engine';
import { buildStep } from '../models/execution.js';
import { OperationPublisher } from '../publisher/publisher.js';
import { MemoryShopifyWriter } from '../publisher/shopify-writer.js';
import { normalizeSafetyConfig } from '../safety/config.js';
import { InvalidExecutionError } from '../utils/errors.js';
import { ExecutionPlanner } from './execution-planner.js';
import { groupStepsIntoBatches } from './grouping.js';

function registry() {
  return new OperationPublisher({ writer: new MemoryShopifyWriter() }).getRegistry();
}

function task(overrides: Partial<ExecutionTask> = {}): ExecutionTask {
  return {
    id: 't1',
    storeId: 's1',
    decisionId: 'd1',
    planId: 'p1',
    recommendationId: 'r1',
    rule: 'rule-1',
    actionType: 'update_title',
    resourceType: 'product',
    resourceId: 'p1',
    resourceRef: 'products/p1',
    payload: { title: 'New Title' },
    priority: 50,
    status: 'READY',
    dependsOn: [],
    isMutating: true,
    risk: 'LOW',
    estimatedSeconds: 2,
    rollback: null,
    result: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

function plan(tasks: ExecutionTask[], overrides: Partial<ExecutionPlan> = {}): ExecutionPlan {
  return {
    id: 'p1',
    storeId: 's1',
    decisionId: 'd1',
    status: 'APPROVED',
    version: 1,
    tasks,
    batches: [],
    orderedTaskIds: tasks.map((t) => t.id),
    dependencies: [],
    approvalRequestId: null,
    estimatedDurationMinutes: 1,
    totalEffortHours: 0.1,
    totalImpact: 50,
    risk: 'LOW',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

describe('groupStepsIntoBatches', () => {
  it('groups steps by resource and action with a per-chunk cap', () => {
    const steps = Array.from({ length: 5 }, (_, index) =>
      buildStep({
        executionId: 'e1',
        batchId: '',
        storeId: 's1',
        actionType: 'update_title',
        resourceType: 'product',
        resourceId: `p${index}`,
        payload: { title: 'x' },
        order: index,
      }),
    );
    const batches = groupStepsIntoBatches('e1', 's1', steps, 2);
    expect(batches).toHaveLength(3);
    expect(batches[0]?.stepIds).toHaveLength(2);
    expect(batches[2]?.stepIds).toHaveLength(1);
    expect(batches[0]?.resourceType).toBe('product');
  });

  it('creates separate batches for different action types', () => {
    const a = buildStep({
      executionId: 'e1', batchId: '', storeId: 's1', actionType: 'update_title',
      resourceType: 'product', resourceId: 'p1', payload: { title: 'x' }, order: 0,
    });
    const b = buildStep({
      executionId: 'e1', batchId: '', storeId: 's1', actionType: 'update_meta_description',
      resourceType: 'product', resourceId: 'p1', payload: { description: 'x' }, order: 1,
    });
    const batches = groupStepsIntoBatches('e1', 's1', [a, b], 10);
    expect(batches).toHaveLength(2);
  });

  it('treats non-positive maxBatchSize as unlimited', () => {
    const steps = Array.from({ length: 3 }, (_, index) =>
      buildStep({
        executionId: 'e1', batchId: '', storeId: 's1', actionType: 'update_title',
        resourceType: 'product', resourceId: `p${index}`, payload: { title: 'x' }, order: index,
      }),
    );
    const batches = groupStepsIntoBatches('e1', 's1', steps, 0);
    expect(batches).toHaveLength(1);
  });
});

describe('ExecutionPlanner', () => {
  const planner = new ExecutionPlanner({ registry: registry() });

  it('plans a decision-engine plan into an execution with steps and batches', () => {
    const execution = planner.plan({
      storeId: 's1',
      mode: 'STAGING',
      plan: plan([task()]),
    });
    expect(execution.source).toBe('plan');
    expect(execution.planId).toBe('p1');
    expect(execution.steps).toHaveLength(1);
    expect(execution.steps[0]?.actionType).toBe('update_title');
    expect(execution.steps[0]?.isMutating).toBe(true);
    expect(execution.steps[0]?.taskId).toBe('t1');
    expect(execution.batches).toHaveLength(1);
  });

  it('plans approved actions into an execution with derived task ids', () => {
    const execution = planner.plan({
      storeId: 's1',
      mode: 'PRODUCTION',
      actions: [
        {
          actionType: 'update_title',
          resourceType: 'product',
          resourceId: 'p1',
          resourceRef: 'products/p1',
          payload: { title: 'New' },
          approval: { approved: true, requestId: 'req-1' },
        },
      ],
    });
    expect(execution.source).toBe('actions');
    expect(execution.steps[0]?.taskId).toBe('update_title:product:p1');
    expect(execution.steps[0]?.approved).toBe(true);
    expect(execution.steps[0]?.approvalRequestId).toBe('req-1');
  });

  it('rejects an empty task list', () => {
    expect(() => planner.plan({ storeId: 's1', mode: 'DRY_RUN', actions: [] })).toThrow(InvalidExecutionError);
  });

  it('orders steps topologically by dependsOn', () => {
    const second = task({ id: 't2', actionType: 'update_meta_description', resourceId: 'p1', payload: { description: 'x' }, dependsOn: ['t1'] });
    const execution = planner.plan({
      storeId: 's1',
      mode: 'STAGING',
      plan: plan([second, task({ id: 't1' })]),
    });
    expect(execution.steps.map((s) => s.taskId)).toEqual(['t1', 't2']);
  });

  it('remaps dependency task ids to step ids', () => {
    const plannerSteps = plan([
      task({ id: 't2', actionType: 'update_meta_description', resourceId: 'p1', payload: { description: 'x' }, dependsOn: ['t1'] }),
      task({ id: 't1' }),
    ]);
    const execution = planner.plan({ storeId: 's1', mode: 'STAGING', plan: plannerSteps });
    const second = execution.steps.find((s) => s.taskId === 't2');
    const first = execution.steps.find((s) => s.taskId === 't1');
    expect(second?.dependsOn).toEqual([first?.id]);
  });

  it('throws when the dependency graph contains a cycle', () => {
    expect(() =>
      planner.plan({
        storeId: 's1',
        mode: 'STAGING',
        plan: plan([
          task({ id: 't1', dependsOn: ['t2'] }),
          task({ id: 't2', dependsOn: ['t1'] }),
        ]),
      }),
    ).toThrow(/cycle/);
  });

  it('requires approval for mutating steps when config demands it', () => {
    const plannerWithApproval = new ExecutionPlanner({
      registry: registry(),
      config: normalizeSafetyConfig({ requireApproval: true }),
    });
    const execution = plannerWithApproval.plan({
      storeId: 's1',
      mode: 'STAGING',
      plan: plan([task()]),
    });
    expect(execution.steps[0]?.requiresApproval).toBe(true);
    expect(execution.steps[0]?.approved).toBe(false);
  });

  it('ignores self-referencing dependencies', () => {
    const execution = planner.plan({
      storeId: 's1',
      mode: 'STAGING',
      plan: plan([task({ id: 't1', dependsOn: ['t1'] })]),
    });
    expect(execution.steps).toHaveLength(1);
  });

  it('falls back through decision/input ids to null', () => {
    const execution = planner.plan({
      storeId: 's1',
      mode: 'STAGING',
      plan: plan([
        task({ decisionId: undefined as unknown as string, recommendationId: undefined as unknown as string }),
      ]),
    });
    expect(execution.steps[0]?.decisionId).toBeNull();
    expect(execution.steps[0]?.recommendationId).toBeNull();
  });

  it('keeps dependency references that do not resolve to a step', () => {
    const execution = planner.plan({
      storeId: 's1',
      mode: 'STAGING',
      plan: plan([task({ dependsOn: ['external-task'] })]),
    });
    expect(execution.steps[0]?.dependsOn).toEqual(['external-task']);
  });

  it('falls back to task mutability for unknown operations', () => {
    const execution = planner.plan({
      storeId: 's1',
      mode: 'STAGING',
      plan: plan([task({ actionType: 'made_up_action' as ExecutionTask['actionType'], resourceType: 'product' })]),
    });
    expect(execution.steps[0]?.isMutating).toBe(true);
  });

  it('honours a non-mutating task when the operation is unknown', () => {
    const execution = planner.plan({
      storeId: 's1',
      mode: 'STAGING',
      plan: plan([task({ actionType: 'made_up_action' as ExecutionTask['actionType'], resourceType: 'product', isMutating: false })]),
    });
    expect(execution.steps[0]?.isMutating).toBe(false);
  });

  it('orders a diamond dependency graph', () => {
    const execution = planner.plan({
      storeId: 's1',
      mode: 'STAGING',
      plan: plan([
        task({ id: 't1' }),
        task({ id: 't2', actionType: 'update_meta_description', resourceId: 'p1', payload: { description: 'x' }, dependsOn: ['t1'] }),
        task({ id: 't3', actionType: 'update_description', resourceId: 'p1', payload: { description: 'x' }, dependsOn: ['t1'] }),
        task({ id: 't4', actionType: 'update_url', resourceId: 'p1', payload: { url: 'x' }, dependsOn: ['t2', 't3'] }),
      ]),
    });
    const ids = execution.steps.map((s) => s.taskId);
    expect(ids[0]).toBe('t1');
    expect(ids[3]).toBe('t4');
  });

  it('rejects input without a plan or actions', () => {
    expect(() => planner.plan({ storeId: 's1', mode: 'DRY_RUN' })).toThrow(InvalidExecutionError);
  });

  it('uses the approval input to mark steps approved', () => {
    const execution = planner.plan({
      storeId: 's1',
      mode: 'STAGING',
      plan: plan([task()]),
      approval: { approvedIds: ['t1'], requestIds: { t1: 'req-9' } },
    });
    expect(execution.steps[0]?.approved).toBe(true);
    expect(execution.steps[0]?.approvalRequestId).toBe('req-9');
  });

  it('treats approved actions with unknown operations as mutating', () => {
    const execution = planner.plan({
      storeId: 's1',
      mode: 'STAGING',
      actions: [{ actionType: 'made_up_action', resourceType: 'product', resourceId: 'p1', payload: {} }],
    });
    expect(execution.steps[0]?.isMutating).toBe(true);
  });
});
