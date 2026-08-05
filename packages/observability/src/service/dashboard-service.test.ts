import { describe, expect, it, beforeEach } from 'vitest';
import { DashboardService } from './dashboard-service.js';
import { InMemoryObservabilityStore } from '../store/in-memory-observability-store.js';
import type { ExecutionRecord } from '../types/models.js';

function record(overrides: Partial<ExecutionRecord> = {}): ExecutionRecord {
  return {
    executionId: 'exec-1',
    storeId: 'store-1',
    status: 'COMPLETED',
    startedAt: '2026-01-01T00:00:00.000Z',
    completedAt: '2026-01-01T00:00:01.000Z',
    ...overrides,
  };
}

describe('DashboardService', () => {
  let store: InMemoryObservabilityStore;
  let dashboard: DashboardService;

  beforeEach(() => {
    store = new InMemoryObservabilityStore();
    dashboard = new DashboardService(store);
  });

  it('returns a zeroed overview for an empty store', async () => {
    const overview = await dashboard.getOverview();
    expect(overview).toMatchObject({
      storeCount: 0,
      executionCount: 0,
      activeExecutionCount: 0,
      completedCount: 0,
      failedCount: 0,
      rolledBackCount: 0,
      alertCount: 0,
      openAlertCount: 0,
      latestSeoScore: null,
      latestExecutionAt: null,
      successRate: 0,
    });
  });

  it('aggregates executions, alerts and SEO health', async () => {
    await store.upsertExecution(record({ executionId: 'a', status: 'COMPLETED' }));
    await store.upsertExecution(record({ executionId: 'b', status: 'FAILED' }));
    await store.upsertExecution(record({ executionId: 'c', status: 'ROLLED_BACK' }));
    await store.upsertExecution(record({ executionId: 'd', status: 'QUEUED' }));
    await store.upsertExecution(record({ executionId: 'e', status: 'EXECUTING', storeId: 'store-2' }));
    await store.appendSnapshot({ snapshotId: 's1', storeId: 'store-1', capturedAt: '2026-01-02T00:00:00.000Z', overallScore: 87 });
    await store.appendAlert({ alertId: 'al-1', type: 'execution_failure', severity: 'warning', message: 'x', triggeredAt: 't', context: {} });

    const overview = await dashboard.getOverview();
    expect(overview.storeCount).toBe(2);
    expect(overview.executionCount).toBe(5);
    expect(overview.activeExecutionCount).toBe(2);
    expect(overview.completedCount).toBe(1);
    expect(overview.failedCount).toBe(1);
    expect(overview.rolledBackCount).toBe(1);
    expect(overview.alertCount).toBe(1);
    expect(overview.latestSeoScore).toBe(87);
    expect(overview.successRate).toBeCloseTo(1 / 3);
    expect(overview.latestExecutionAt).toBe('2026-01-01T00:00:01.000Z');
  });

  it('scopes the overview to a store', async () => {
    await store.upsertExecution(record({ executionId: 'a', storeId: 'store-1', status: 'COMPLETED' }));
    await store.upsertExecution(record({ executionId: 'b', storeId: 'store-2', status: 'FAILED' }));
    await store.appendSnapshot({ snapshotId: 's1', storeId: 'store-1', capturedAt: 't', overallScore: 60 });
    const overview = await dashboard.getOverview('store-1');
    expect(overview.executionCount).toBe(1);
    expect(overview.latestSeoScore).toBe(60);
  });
});
