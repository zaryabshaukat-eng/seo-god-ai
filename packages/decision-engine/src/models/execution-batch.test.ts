import { describe, expect, it } from 'vitest';
import { STORE_ID } from '../test/fixtures.js';
import { ExecutionBatchModel } from './execution-batch.js';
import type { ExecutionBatch } from '../types/plan.js';

function batch(): ExecutionBatch {
  return {
    id: 'batch-1',
    storeId: STORE_ID,
    planId: 'plan-1',
    resourceType: 'page',
    actionType: 'update_title',
    taskIds: ['t1'],
    order: 0,
    status: 'PENDING',
    estimatedSeconds: 10,
    apiCalls: 1,
  };
}

describe('ExecutionBatchModel', () => {
  it('copies a batch from a record', () => {
    const source = batch();
    const copy = ExecutionBatchModel.fromRecord(source);
    expect(copy).toEqual(source);
    expect(copy).not.toBe(source);
  });

  it('sets the batch status', () => {
    const updated = ExecutionBatchModel.setStatus(batch(), 'COMPLETED');
    expect(updated.status).toBe('COMPLETED');
  });
});
