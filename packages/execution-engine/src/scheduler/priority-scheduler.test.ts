import { describe, expect, it } from 'vitest';
import { buildExecution, buildStep } from '../models/execution.js';
import { PriorityScheduler } from './priority-scheduler.js';

describe('PriorityScheduler', () => {
  it('returns the highest priority item first', () => {
    const scheduler = new PriorityScheduler();
    scheduler.add({ executionId: 'low', priority: 1, submittedAt: 1 });
    scheduler.add({ executionId: 'high', priority: 10, submittedAt: 2 });
    expect(scheduler.next()?.executionId).toBe('high');
    expect(scheduler.next()?.executionId).toBe('low');
  });

  it('breaks priority ties by submission order', () => {
    const scheduler = new PriorityScheduler();
    scheduler.add({ executionId: 'first', priority: 5, submittedAt: 1 });
    scheduler.add({ executionId: 'second', priority: 5, submittedAt: 2 });
    expect(scheduler.peek()?.executionId).toBe('first');
  });

  it('schedules an execution using the sum of its step priorities', () => {
    const scheduler = new PriorityScheduler();
    const step1 = buildStep({
      executionId: 'e1', batchId: 'b1', storeId: 's1', actionType: 'update_title',
      resourceType: 'product', resourceId: 'p1', payload: { title: 'x' }, order: 0, priority: 3,
    });
    const step2 = buildStep({
      executionId: 'e1', batchId: 'b1', storeId: 's1', actionType: 'update_meta_description',
      resourceType: 'product', resourceId: 'p1', payload: { description: 'x' }, order: 1, priority: 7,
    });
    const execution = buildExecution({
      id: 'e1', storeId: 's1', mode: 'STAGING', source: 'plan', steps: [step1, step2], batches: [],
    });
    scheduler.schedule(execution, 100);
    expect(scheduler.peek()).toEqual({ executionId: 'e1', priority: 10, submittedAt: 100 });
  });

  it('removes an item by execution id', () => {
    const scheduler = new PriorityScheduler();
    scheduler.add({ executionId: 'e1', priority: 1, submittedAt: 1 });
    expect(scheduler.remove('e1')).toBe(true);
    expect(scheduler.remove('e1')).toBe(false);
    expect(scheduler.size).toBe(0);
  });

  it('clears all items', () => {
    const scheduler = new PriorityScheduler();
    scheduler.add({ executionId: 'e1', priority: 1, submittedAt: 1 });
    scheduler.clear();
    expect(scheduler.size).toBe(0);
    expect(scheduler.next()).toBeNull();
    expect(scheduler.peek()).toBeNull();
  });
});
