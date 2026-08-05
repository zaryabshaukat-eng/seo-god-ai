import { describe, expect, it, beforeEach } from 'vitest';
import { LearningSignalService, toHistoricalOutcome } from './learning-signal-service.js';
import { InMemoryObservabilityStore } from '../store/in-memory-observability-store.js';
import type { ExecutionRecord } from '../types/models.js';

function record(overrides: Partial<ExecutionRecord> = {}): ExecutionRecord {
  return {
    executionId: 'exec-1',
    storeId: 'store-1',
    operation: 'seo.update_title',
    status: 'COMPLETED',
    startedAt: '2026-01-01T00:00:00.000Z',
    durationMs: 500,
    ...overrides,
  };
}

describe('LearningSignalService', () => {
  let store: InMemoryObservabilityStore;
  let signals: LearningSignalService;

  beforeEach(() => {
    store = new InMemoryObservabilityStore();
    signals = new LearningSignalService(store);
  });

  it('returns no signals for an empty store', async () => {
    expect(await signals.compute()).toEqual([]);
  });

  it('groups executions by operation and computes attempts, successes, rates', async () => {
    await store.upsertExecution(record({ executionId: 'a', status: 'COMPLETED', durationMs: 100 }));
    await store.upsertExecution(record({ executionId: 'b', status: 'COMPLETED', durationMs: 200 }));
    await store.upsertExecution(record({ executionId: 'c', status: 'ROLLED_BACK', durationMs: 50 }));
    await store.upsertExecution(record({ executionId: 'd', operation: 'seo.update_meta_description', status: 'FAILED' }));

    const result = await signals.compute();
    expect(result).toHaveLength(2);
    const title = result.find((signal) => signal.rule === 'seo.update_title');
    const description = result.find((signal) => signal.rule === 'seo.update_meta_description');

    expect(title?.attempts).toBe(3);
    expect(title?.successes).toBe(2);
    expect(title?.successRate).toBeCloseTo(2 / 3);
    expect(title?.rollbackRate).toBeCloseTo(1 / 3);
    expect(title?.averageDurationMs).toBeCloseTo(350 / 3);
    expect(title?.lastExecutedAt).toBe('2026-01-01T00:00:00.000Z');

    expect(description?.attempts).toBe(1);
    expect(description?.successes).toBe(0);

    expect(result[0]?.rule).toBe('seo.update_title');
  });

  it('falls back to entityType when operation is missing', async () => {
    await store.upsertExecution(record({ executionId: 'a', operation: undefined, entityType: 'page', status: 'COMPLETED' }));
    const result = await signals.compute();
    expect(result[0]?.rule).toBe('page');
  });

  it('falls back to the literal rule when operation and entityType are missing', async () => {
    await store.upsertExecution(record({ executionId: 'a', operation: undefined, entityType: undefined, status: 'COMPLETED' }));
    const result = await signals.compute();
    expect(result[0]?.rule).toBe('execution');
  });

  it('measures average impact from BEFORE/AFTER snapshots', async () => {
    await store.upsertExecution(record({ executionId: 'a' }));
    await store.upsertExecution(record({ executionId: 'b' }));
    await store.appendSnapshot({ snapshotId: 'before-a', storeId: 'store-1', executionId: 'a', capturedAt: '2026-01-01T00:00:00.000Z', overallScore: 60, reference: 'BEFORE' });
    await store.appendSnapshot({ snapshotId: 'after-a', storeId: 'store-1', executionId: 'a', capturedAt: '2026-01-01T01:00:00.000Z', overallScore: 80, reference: 'AFTER' });
    await store.appendSnapshot({ snapshotId: 'after-b', storeId: 'store-1', executionId: 'b', capturedAt: '2026-01-02T00:00:00.000Z', overallScore: 55, reference: 'AFTER' });
    await store.appendSnapshot({ snapshotId: 'before-b', storeId: 'store-1', executionId: 'b', capturedAt: '2026-01-01T02:00:00.000Z', overallScore: 70, reference: 'BEFORE' });

    const result = await signals.compute();
    const title = result[0];
    // a: 80-60 = 20; b: 55-70 = -15 (kept as measured impact)
    expect(title?.averageImpact).toBeCloseTo(2.5);
  });

  it('returns zero impact when no paired snapshots exist', async () => {
    await store.upsertExecution(record({ executionId: 'a' }));
    await store.appendSnapshot({ snapshotId: 'solo', storeId: 'store-1', executionId: 'a', capturedAt: 't', overallScore: 80, reference: 'AFTER' });
    await store.appendSnapshot({ snapshotId: 'orphan', storeId: 'store-1', capturedAt: 't2', overallScore: 90, reference: 'AFTER' });
    const result = await signals.compute();
    expect(result[0]?.averageImpact).toBe(0);
  });

  it('scopes computation to a store', async () => {
    await store.upsertExecution(record({ executionId: 'a', storeId: 'store-1', status: 'COMPLETED' }));
    await store.upsertExecution(record({ executionId: 'b', storeId: 'store-2', status: 'COMPLETED' }));
    const result = await signals.compute({ storeId: 'store-1' });
    expect(result).toHaveLength(1);
    expect(result[0]?.storeId).toBe('store-1');
  });

  it('computes average duration of zero when no durations recorded', async () => {
    await store.upsertExecution(record({ executionId: 'a', durationMs: undefined }));
    const result = await signals.compute();
    expect(result[0]?.averageDurationMs).toBe(0);
  });
});

describe('toHistoricalOutcome', () => {
  it('projects a learning signal into the HistoricalOutcome shape', () => {
    const outcome = toHistoricalOutcome({
      rule: 'missing-title',
      actionType: 'missing-title',
      attempts: 4,
      successes: 3,
      averageImpact: 12,
      successRate: 0.75,
      rollbackRate: 0,
      averageDurationMs: 100,
    });
    expect(outcome).toEqual({ rule: 'missing-title', attempts: 4, successes: 3, averageImpact: 12 });
  });
});
