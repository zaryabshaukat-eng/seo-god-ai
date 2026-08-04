import { describe, expect, it, vi } from 'vitest';
import type { Execution, ExecutionBatch, ExecutionStep } from '../types/execution.js';
import { buildExecution, buildStep } from '../models/execution.js';
import { BatchSaga } from './saga.js';
import type { RollbackEngine } from '../rollback/engine.js';

function step(id: string, order: number): ExecutionStep {
  return buildStep({
    executionId: 'e1',
    batchId: 'b1',
    storeId: 's1',
    actionType: 'update_title',
    resourceType: 'product',
    resourceId: `p${order}`,
    payload: { title: 'x' },
    order,
  });
}

function makeExecution(steps: ExecutionStep[]): Execution {
  return buildExecution({
    id: 'e1',
    storeId: 's1',
    mode: 'STAGING',
    source: 'plan',
    steps,
    batches: [],
  });
}

function makeBatch(stepIds: string[]): ExecutionBatch {
  return {
    id: 'b1',
    executionId: 'e1',
    storeId: 's1',
    resourceType: 'product',
    actionType: 'update_title',
    stepIds,
    order: 0,
    status: 'PENDING',
    apiCalls: 0,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
  };
}

function rollbackEngine(): RollbackEngine {
  return {
    async rollbackStep() {
      return { status: 'COMPLETED', apiCalls: 1, durationMs: 1, error: null };
    },
  } as unknown as RollbackEngine;
}

describe('BatchSaga', () => {
  it('completes a batch when every step succeeds', async () => {
    const s1 = step('s1', 0);
    const s2 = step('s2', 1);
    const execution = makeExecution([s1, s2]);
    const saga = new BatchSaga({ rollback: rollbackEngine() });
    const result = await saga.runBatch(makeBatch([s1.id, s2.id]), execution, async (s) => {
      s.status = 'COMPLETED';
      return { apiCalls: 1, after: null, responses: [] };
    });
    expect(result.status).toBe('COMPLETED');
    expect(result.executed).toEqual([s1.id, s2.id]);
    expect(result.rolledBack).toEqual([]);
    expect(s1.apiCalls).toBe(1);
  });

  it('rolls back executed steps in reverse order when a step fails', async () => {
    const s1 = step('s1', 0);
    const s2 = step('s2', 1);
    const s3 = step('s3', 2);
    const execution = makeExecution([s1, s2, s3]);
    const rolledBackOrder: string[] = [];
    const rollback = {
      async rollbackStep(s: ExecutionStep) {
        rolledBackOrder.push(s.id);
        return { status: 'COMPLETED', apiCalls: 1, durationMs: 1, error: null };
      },
    } as unknown as RollbackEngine;
    const saga = new BatchSaga({ rollback });
    const result = await saga.runBatch(makeBatch([s1.id, s2.id, s3.id]), execution, async (s) => {
      if (s.id === s3.id) throw new Error('boom');
      s.status = 'COMPLETED';
      return { apiCalls: 1, after: null, responses: [] };
    });
    expect(result.status).toBe('ROLLED_BACK');
    expect(result.executed).toEqual([s1.id, s2.id]);
    expect(result.rolledBack).toEqual([s1.id, s2.id]);
    expect(rolledBackOrder).toEqual([s2.id, s1.id]);
    expect(s3.status).toBe('FAILED');
    expect(s1.status).toBe('ROLLED_BACK');
  });

  it('returns FAILED without compensation when autoRollback is disabled', async () => {
    const s1 = step('s1', 0);
    const s2 = step('s2', 1);
    const execution = makeExecution([s1, s2]);
    const rollbackSpy = vi.fn();
    const rollback = {
      async rollbackStep() {
        rollbackSpy();
        return { status: 'COMPLETED', apiCalls: 1, durationMs: 1, error: null };
      },
    } as unknown as RollbackEngine;
    const saga = new BatchSaga({ rollback, autoRollback: false });
    const result = await saga.runBatch(makeBatch([s1.id, s2.id]), execution, async (s) => {
      if (s.id === s2.id) throw new Error('boom');
      return { apiCalls: 1, after: null, responses: [] };
    });
    expect(result.status).toBe('FAILED');
    expect(result.rolledBack).toEqual([]);
    expect(rollbackSpy).not.toHaveBeenCalled();
    expect(s2.status).toBe('FAILED');
  });

  it('skips step ids that do not exist in the execution', async () => {
    const s1 = step('s1', 0);
    const execution = makeExecution([s1]);
    const saga = new BatchSaga({ rollback: rollbackEngine() });
    const result = await saga.runBatch(makeBatch([s1.id, 'ghost']), execution, async () => ({
      apiCalls: 1,
      after: null,
      responses: [],
    }));
    expect(result.status).toBe('COMPLETED');
    expect(result.executed).toEqual([s1.id]);
  });

  it('marks failed rollback attempts as FAILED on the step', async () => {
    const s1 = step('s1', 0);
    const s2 = step('s2', 1);
    const execution = makeExecution([s1, s2]);
    const rollback = {
      async rollbackStep() {
        return { status: 'FAILED', apiCalls: 0, durationMs: 1, error: 'restore exploded' };
      },
    } as unknown as RollbackEngine;
    const saga = new BatchSaga({ rollback });
    const result = await saga.runBatch(makeBatch([s1.id, s2.id]), execution, async (s) => {
      if (s.id === s2.id) throw new Error('boom');
      return { apiCalls: 1, after: null, responses: [] };
    });
    expect(result.status).toBe('ROLLED_BACK');
    expect(s1.status).toBe('FAILED');
    expect(s1.error).toBe('restore exploded');
  });

  it('stringifies non-Error failures from the step runner', async () => {
    const s1 = step('s1', 0);
    const execution = makeExecution([s1]);
    const saga = new BatchSaga({ rollback: rollbackEngine() });
    const result = await saga.runBatch(makeBatch([s1.id]), execution, async () => {
      throw 'boom-string';
    });
    expect(result.status).toBe('ROLLED_BACK');
    expect(s1.error).toBe('boom-string');
  });
});
