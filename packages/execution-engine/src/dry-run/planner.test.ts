import { describe, expect, it } from 'vitest';
import type { Execution } from '../types/execution.js';
import { buildExecution, buildStep } from '../models/execution.js';
import { OperationPublisher } from '../publisher/publisher.js';
import { MemoryShopifyWriter } from '../publisher/shopify-writer.js';
import { DryRunPlanner } from './planner.js';

function makeExecution(): Execution {
  const step = buildStep({
    executionId: 'e1',
    batchId: 'b1',
    storeId: 's1',
    actionType: 'update_title',
    resourceType: 'product',
    resourceId: 'p1',
    payload: { title: 'New Title' },
    order: 0,
  });
  return buildExecution({
    id: 'e1',
    storeId: 's1',
    mode: 'DRY_RUN',
    source: 'plan',
    steps: [step],
    batches: [],
  });
}

describe('DryRunPlanner', () => {
  it('fills expectedAfter from the matching operation', () => {
    const planner = new DryRunPlanner(new OperationPublisher({ writer: new MemoryShopifyWriter() }).getRegistry());
    const execution = makeExecution();
    planner.plan(execution);
    expect(execution.steps[0]?.expectedAfter).not.toBeNull();
  });

  it('leaves expectedAfter null for unknown operations', () => {
    const registry = new OperationPublisher({ writer: new MemoryShopifyWriter() }).getRegistry();
    const planner = new DryRunPlanner(registry);
    const execution = makeExecution();
    execution.steps[0]!.actionType = 'custom';
    planner.plan(execution);
    expect(execution.steps[0]?.expectedAfter).toBeNull();
  });

  it('only plans PENDING and READY steps', () => {
    const planner = new DryRunPlanner(new OperationPublisher({ writer: new MemoryShopifyWriter() }).getRegistry());
    const execution = makeExecution();
    execution.steps[0]!.status = 'COMPLETED';
    planner.plan(execution);
    expect(execution.steps[0]?.expectedAfter).toBeNull();
  });

  it('estimates counts for real and dry-run modes', () => {
    const planner = new DryRunPlanner(new OperationPublisher({ writer: new MemoryShopifyWriter() }).getRegistry());
    const execution = makeExecution();
    const estimate = planner.estimate(execution, 'PRODUCTION');
    expect(estimate.total).toBe(1);
    expect(estimate.mutating).toBe(1);
    expect(estimate.readOnly).toBe(0);
    expect(estimate.apiCalls).toBe(1);
    expect(estimate.byAction).toEqual({ update_title: 1 });
  });

  it('does not count api calls for mutating writes in non-real modes', () => {
    const planner = new DryRunPlanner(new OperationPublisher({ writer: new MemoryShopifyWriter() }).getRegistry());
    const execution = makeExecution();
    const estimate = planner.estimate(execution, 'DRY_RUN');
    expect(estimate.apiCalls).toBe(0);
  });

  it('counts read-only steps without api calls', () => {
    const planner = new DryRunPlanner(new OperationPublisher({ writer: new MemoryShopifyWriter() }).getRegistry());
    const execution = makeExecution();
    execution.steps[0]!.isMutating = false;
    const estimate = planner.estimate(execution, 'PRODUCTION');
    expect(estimate.mutating).toBe(0);
    expect(estimate.readOnly).toBe(1);
    expect(estimate.apiCalls).toBe(0);
  });

  it('does not count api calls for unknown mutating operations', () => {
    const planner = new DryRunPlanner(new OperationPublisher({ writer: new MemoryShopifyWriter() }).getRegistry());
    const execution = makeExecution();
    execution.steps[0]!.actionType = 'custom';
    const estimate = planner.estimate(execution, 'PRODUCTION');
    expect(estimate.mutating).toBe(1);
    expect(estimate.readOnly).toBe(0);
    expect(estimate.apiCalls).toBe(0);
    expect(estimate.byAction).toEqual({ custom: 1 });
  });
});
