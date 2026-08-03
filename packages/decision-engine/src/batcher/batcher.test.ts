import { describe, expect, it } from 'vitest';
import { task } from '../test/fixtures.js';
import { Batcher } from './batcher.js';

describe('Batcher', () => {
  it('groups tasks by resource type and action type', () => {
    const batcher = new Batcher();
    const tasks = [
      task({ id: 't1', resourceType: 'page', actionType: 'update_title', priority: 90, estimatedSeconds: 10 }),
      task({ id: 't2', resourceType: 'page', actionType: 'update_title', priority: 80, estimatedSeconds: 20 }),
      task({ id: 't3', resourceType: 'product', actionType: 'update_title', priority: 70, estimatedSeconds: 5 }),
    ];
    const orderOf = new Map([
      ['t1', 0],
      ['t2', 1],
      ['t3', 2],
    ]);
    const batches = batcher.group(tasks, { planId: 'plan-1', storeId: 'store-1', orderOf });
    expect(batches).toHaveLength(2);

    const pageBatch = batches.find((batch) => batch.resourceType === 'page')!;
    expect(pageBatch.taskIds).toEqual(['t1', 't2']);
    expect(pageBatch.order).toBe(0);
    expect(pageBatch.estimatedSeconds).toBe(30);
    expect(pageBatch.apiCalls).toBe(2);
    expect(pageBatch.status).toBe('PENDING');

    const productBatch = batches.find((batch) => batch.resourceType === 'product')!;
    expect(productBatch.order).toBe(2);
    expect(batches.map((batch) => batch.resourceType)).toEqual(['page', 'product']);
  });

  it('splits large groups by the configured batch size', () => {
    const batcher = new Batcher({ maxBatchSize: 2 });
    const tasks = Array.from({ length: 5 }, (_, index) =>
      task({
        id: `t${index}`,
        resourceType: 'page',
        actionType: 'update_title',
        priority: 100 - index,
        estimatedSeconds: 1,
      }),
    );
    const orderOf = new Map(tasks.map((entry, index) => [entry.id, index]));
    const batches = batcher.group(tasks, { planId: 'plan-1', storeId: 'store-1', orderOf });
    expect(batches).toHaveLength(3);
    expect(batches[0]!.taskIds).toHaveLength(2);
    expect(batches[1]!.taskIds).toHaveLength(2);
    expect(batches[2]!.taskIds).toHaveLength(1);
  });

  it('honors a per-call batch size override', () => {
    const batcher = new Batcher();
    const tasks = [task({ id: 't1' }), task({ id: 't2', resourceId: `${'x'}` })];
    tasks[1]!.resourceId = `${tasks[1]!.resourceId}-2`;
    const orderOf = new Map([
      ['t1', 0],
      ['t2', 1],
    ]);
    const batches = batcher.group(tasks, {
      planId: 'plan-1',
      storeId: 'store-1',
      orderOf,
      maxBatchSize: 1,
    });
    expect(batches).toHaveLength(2);
  });

  it('is deterministic across calls', () => {
    const batcher = new Batcher();
    const tasks = [task({ id: 't1' }), task({ id: 't2' })];
    const orderOf = new Map([
      ['t1', 0],
      ['t2', 1],
    ]);
    const input = { planId: 'plan-1', storeId: 'store-1', orderOf };
    const first = batcher.group(tasks, input);
    const second = batcher.group(tasks, input);
    expect(first.map((batch) => batch.id)).toEqual(second.map((batch) => batch.id));
  });

  it('sorts ties by resource type and action type when order is missing', () => {
    const batcher = new Batcher();
    const tasks = [
      task({ id: 't1', resourceType: 'product', actionType: 'update_title' }),
      task({ id: 't2', resourceType: 'page', actionType: 'update_body' }),
      task({ id: 't3', resourceType: 'page', actionType: 'update_title' }),
    ];
    const batches = batcher.group(tasks, {
      planId: 'plan-1',
      storeId: 'store-1',
      orderOf: new Map(),
    });
    expect(batches.map((batch) => batch.order)).toEqual([0, 0, 0]);
    expect(batches.map((batch) => batch.resourceType)).toEqual(['page', 'page', 'product']);
    expect(batches.map((batch) => batch.actionType)).toEqual(['update_body', 'update_title', 'update_title']);
  });
});
