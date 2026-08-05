import { describe, expect, it, beforeEach } from 'vitest';
import { MetricsService, percentile } from './metrics-service.js';
import { InMemoryObservabilityStore } from '../store/in-memory-observability-store.js';
import type { ExecutionRecord } from '../types/models.js';
import type { ObservabilityEvent } from '../types/events.js';
import { executionEvent } from '../test/helpers.js';

function record(overrides: Partial<ExecutionRecord> = {}): ExecutionRecord {
  return {
    executionId: 'exec-1',
    storeId: 'store-1',
    status: 'COMPLETED',
    startedAt: '2026-01-01T00:00:00.000Z',
    durationMs: 1000,
    ...overrides,
  };
}

function stored(type: ObservabilityEvent['type'], id: string): Parameters<InMemoryObservabilityStore['appendEvent']>[0] {
  return {
    id,
    type,
    storeId: 'store-1',
    occurredAt: '2026-01-01T00:00:00.000Z',
    event: { type } as unknown as ObservabilityEvent,
  };
}

describe('percentile', () => {
  it('returns 0 for empty input', () => {
    expect(percentile([], 95)).toBe(0);
  });

  it('computes the p-th percentile', () => {
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 95)).toBe(10);
    expect(percentile([100], 95)).toBe(100);
  });
});

describe('MetricsService', () => {
  let store: InMemoryObservabilityStore;
  let metrics: MetricsService;

  beforeEach(() => {
    store = new InMemoryObservabilityStore();
    metrics = new MetricsService(store);
  });

  it('returns zeroed metrics for an empty store', async () => {
    const result = await metrics.compute();
    expect(result.totalExecutions).toBe(0);
    expect(result.successRate).toBe(0);
    expect(result.failureRate).toBe(0);
    expect(result.rollbackRate).toBe(0);
    expect(result.averageExecutionTimeMs).toBe(0);
    expect(result.p95ExecutionTimeMs).toBe(0);
    expect(result.crawlSuccessRate).toBe(0);
  });

  it('computes rates, averages and counters from records and events', async () => {
    await store.upsertExecution(record({ executionId: 'a', status: 'COMPLETED', durationMs: 100 }));
    await store.upsertExecution(record({ executionId: 'b', status: 'COMPLETED', durationMs: 300 }));
    await store.upsertExecution(record({ executionId: 'c', status: 'FAILED', durationMs: 50 }));
    await store.upsertExecution(record({ executionId: 'd', status: 'ROLLED_BACK', durationMs: 40 }));
    await store.upsertExecution(record({ executionId: 'e', status: 'CANCELLED' }));
    await store.upsertExecution(record({ executionId: 'f', status: 'QUEUED' }));
    await store.upsertExecution(record({ executionId: 'g', status: 'EXECUTING' }));
    await store.upsertExecution(record({ executionId: 'h', storeId: 'store-1', status: 'COMPLETED', simulation: true, durationMs: 10 }));

    await store.appendEvent(stored('validation.failed', 'v1'));
    await store.appendEvent(stored('validation.failed', 'v2'));
    await store.appendEvent({
      id: 's1',
      type: 'execution.safety_violation',
      storeId: 'store-1',
      occurredAt: 't',
      event: executionEvent('execution.safety_violation'),
    });
    await store.appendEvent({
      id: 'r1',
      type: 'execution.rollback_completed',
      storeId: 'store-1',
      occurredAt: 't',
      event: executionEvent('execution.rollback_completed'),
    });
    await store.appendEvent(stored('crawl.completed', 'c1'));
    await store.appendEvent(stored('crawl.failed', 'c2'));

    const result = await metrics.compute();
    expect(result.totalExecutions).toBe(8);
    expect(result.queued).toBe(1);
    expect(result.executing).toBe(1);
    expect(result.completed).toBe(3);
    expect(result.failed).toBe(1);
    expect(result.cancelled).toBe(1);
    expect(result.rolledBack).toBe(1);
    expect(result.successRate).toBeCloseTo(3 / 6);
    expect(result.failureRate).toBeCloseTo(1 / 6);
    expect(result.rollbackRate).toBeCloseTo(1 / 6);
    expect(result.averageExecutionTimeMs).toBeCloseTo(410 / 3);
    expect(result.p95ExecutionTimeMs).toBe(300);
    expect(result.validationFailures).toBe(2);
    expect(result.safetyViolations).toBe(1);
    expect(result.totalRollbacks).toBe(1);
    expect(result.crawlSuccessRate).toBeCloseTo(0.5);
    expect(result.simulated).toBe(1);
  });

  it('scopes computation to a store', async () => {
    await store.upsertExecution(record({ executionId: 'a', storeId: 'store-1', status: 'COMPLETED' }));
    await store.upsertExecution(record({ executionId: 'b', storeId: 'store-2', status: 'FAILED' }));
    const result = await metrics.compute('store-1');
    expect(result.totalExecutions).toBe(1);
    expect(result.completed).toBe(1);
    expect(result.failed).toBe(0);
  });

  it('treats records without duration as excluded from averages', async () => {
    await store.upsertExecution(record({ executionId: 'a', status: 'COMPLETED', durationMs: 100 }));
    await store.upsertExecution(record({ executionId: 'b', status: 'COMPLETED', durationMs: undefined }));
    const result = await metrics.compute();
    expect(result.averageExecutionTimeMs).toBe(100);
  });
});
