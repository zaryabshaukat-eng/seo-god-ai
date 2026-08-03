import { describe, expect, it } from 'vitest';
import { fixedClock, task } from '../test/fixtures.js';
import { ExecutionTaskModel } from './execution-task.js';

describe('ExecutionTaskModel', () => {
  it('copies a task from a record', () => {
    const source = task({ id: 't1' });
    const copy = ExecutionTaskModel.fromRecord(source);
    expect(copy).toEqual(source);
    expect(copy).not.toBe(source);
  });

  it('updates status and timestamp', () => {
    const source = task({ id: 't1' });
    const updated = ExecutionTaskModel.setStatus(source, 'COMPLETED', fixedClock);
    expect(updated.status).toBe('COMPLETED');
    expect(updated.updatedAt).toEqual(fixedClock());
    expect(source.status).toBe('PENDING');
  });

  it('attaches a rollback plan', () => {
    const source = task({ id: 't1' });
    const updated = ExecutionTaskModel.attachRollback(source, { available: true } as never);
    expect(updated.rollback).toEqual({ available: true });
  });

  it('attaches a result with its completion time', () => {
    const source = task({ id: 't1' });
    const result = {
      id: 'r',
      taskId: 't1',
      planId: 'plan-1',
      storeId: 'store-1',
      status: 'SUCCESS' as const,
      durationMs: 1,
      message: 'ok',
      apiResponses: [],
      startedAt: fixedClock(),
      completedAt: fixedClock(),
    };
    const updated = ExecutionTaskModel.attachResult(source, result);
    expect(updated.result?.status).toBe('SUCCESS');
    expect(updated.updatedAt).toEqual(fixedClock());
  });
});
