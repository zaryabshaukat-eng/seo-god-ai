import { describe, expect, it } from 'vitest';
import { buildRollbackRecord } from './rollback.js';
import { isUuid } from '../utils/ids.js';

describe('rollback model', () => {
  it('buildRollbackRecord creates a pending record with deterministic id', () => {
    const record = buildRollbackRecord({
      executionId: 'e1',
      storeId: 's1',
      scope: 'execution',
      mode: 'PRODUCTION',
      reason: 'step failed',
    });
    expect(record.status).toBe('PENDING');
    expect(record.scope).toBe('execution');
    expect(record.stepId).toBeNull();
    expect(record.batchId).toBeNull();
    expect(record.plan).toBeNull();
    expect(record.error).toBeNull();
    expect(record.apiCalls).toBe(0);
    expect(record.startedAt).toBeNull();
    expect(record.completedAt).toBeNull();
    expect(isUuid(record.id)).toBe(true);
    const again = buildRollbackRecord({
      executionId: 'e1',
      storeId: 's1',
      scope: 'execution',
      mode: 'PRODUCTION',
      reason: 'step failed',
    });
    expect(again.id).toBe(record.id);
  });

  it('buildRollbackRecord honors overrides', () => {
    const record = buildRollbackRecord({
      executionId: 'e1',
      storeId: 's1',
      scope: 'single',
      mode: 'STAGING',
      status: 'COMPLETED',
      stepId: 'step-1',
      batchId: 'batch-1',
      reason: 'rollback',
      plan: { available: true, reason: undefined, steps: [] },
    });
    expect(record.status).toBe('COMPLETED');
    expect(record.scope).toBe('single');
    expect(record.stepId).toBe('step-1');
    expect(record.batchId).toBe('batch-1');
    expect(record.plan?.available).toBe(true);
  });

  it('honors explicit createdAt', () => {
    const createdAt = new Date('2025-01-01T00:00:00Z');
    const record = buildRollbackRecord({
      executionId: 'e',
      storeId: 's',
      scope: 'single',
      mode: 'STAGING',
      reason: 'r',
      createdAt,
    });
    expect(record.createdAt).toBe(createdAt);
  });
});
