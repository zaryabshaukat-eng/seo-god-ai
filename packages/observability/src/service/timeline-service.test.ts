import { describe, expect, it, beforeEach } from 'vitest';
import { TimelineService } from './timeline-service.js';
import { InMemoryObservabilityStore } from '../store/in-memory-observability-store.js';
import type { ExecutionRecord } from '../types/models.js';

function record(overrides: Partial<ExecutionRecord> = {}): ExecutionRecord {
  return {
    executionId: 'exec-1',
    storeId: 'store-1',
    status: 'COMPLETED',
    startedAt: '2026-01-01T00:00:00.000Z',
    completedAt: '2026-01-01T00:00:01.000Z',
    durationMs: 1000,
    ...overrides,
  };
}

describe('TimelineService', () => {
  let store: InMemoryObservabilityStore;
  let timeline: TimelineService;

  beforeEach(() => {
    store = new InMemoryObservabilityStore();
    timeline = new TimelineService(store);
  });

  it('returns an empty history for an empty store', async () => {
    const history = await timeline.getHistory();
    expect(history.executions).toEqual([]);
    expect(history.snapshots).toEqual([]);
    expect(history.changes).toEqual([]);
    expect(history.alerts).toEqual([]);
    expect(history.events).toEqual([]);
  });

  it('returns history filtered and limited, mapping events to wire shape', async () => {
    await store.upsertExecution(record({ executionId: 'a' }));
    await store.upsertExecution(record({ executionId: 'b', storeId: 'store-2' }));
    await store.appendEvent({
      id: 'evt-1',
      type: 'execution.completed',
      storeId: 'store-1',
      occurredAt: '2026-01-01T00:00:00.000Z',
      event: { type: 'execution.completed', executionId: 'a', storeId: 'store-1' },
    });
    await store.appendEvent({
      id: 'evt-2',
      type: 'execution.started',
      storeId: 'store-2',
      occurredAt: '2026-01-01T00:00:00.000Z',
      event: { type: 'execution.started', executionId: 'b', storeId: 'store-2' },
    });

    const scoped = await timeline.getHistory({ storeId: 'store-1' });
    expect(scoped.executions.map((e) => e.executionId)).toEqual(['a']);
    expect(scoped.events[0]?.type).toBe('execution.completed');
    expect(scoped.events[0]).not.toHaveProperty('event');

    const limited = await timeline.getHistory({ storeId: 'store-1', limit: 1 });
    expect(limited.executions).toHaveLength(1);
  });

  it('builds an SEO timeline from snapshots', async () => {
    await store.appendSnapshot({ snapshotId: 's1', storeId: 'store-1', capturedAt: '2026-01-01T00:00:00.000Z', overallScore: 70, pagesCrawled: 10, totalIssues: 4, reference: 'BEFORE' });
    await store.appendSnapshot({ snapshotId: 's2', storeId: 'store-1', capturedAt: '2026-01-02T00:00:00.000Z', overallScore: 90, reference: 'AFTER' });
    await store.appendSnapshot({ snapshotId: 's3', storeId: 'store-2', capturedAt: '2026-01-02T00:00:00.000Z', overallScore: 50 });

    const scoped = await timeline.getSeoTimeline({ storeId: 'store-1' });
    expect(scoped.storeId).toBe('store-1');
    expect(scoped.points).toHaveLength(2);
    expect(scoped.points[0]?.overallScore).toBe(90);
    expect(scoped.points[0]?.reference).toBe('AFTER');

    const limited = await timeline.getSeoTimeline({ storeId: 'store-1', limit: 1 });
    expect(limited.points).toHaveLength(1);
  });

  it('builds an execution timeline using completedAt or startedAt', async () => {
    await store.upsertExecution(record({ executionId: 'a', status: 'EXECUTING', completedAt: undefined }));
    await store.upsertExecution(record({ executionId: 'b', status: 'FAILED', completedAt: undefined, durationMs: undefined }));
    const points = await timeline.getExecutionTimeline({ storeId: 'store-1' });
    expect(points).toHaveLength(2);
    expect(points[0]?.type).toBe('execution');
    expect(points[0]?.label).toBe('EXECUTING');
    expect(points[0]?.timestamp).toBe('2026-01-01T00:00:00.000Z');
    const failed = points.find((point) => point.executionId === 'b');
    expect(failed?.value).toBe(0);
  });

  it('buckets executions into a performance timeline', async () => {
    await store.upsertExecution(record({ executionId: 'a', completedAt: '2026-01-01T00:00:30.000Z', durationMs: 100 }));
    await store.upsertExecution(record({ executionId: 'b', completedAt: '2026-01-01T00:00:45.000Z', durationMs: 200 }));
    await store.upsertExecution(record({ executionId: 'c', completedAt: '2026-01-01T01:00:00.000Z', durationMs: 400, status: 'FAILED' }));
    await store.upsertExecution(record({ executionId: 'd', status: 'QUEUED' }));
    await store.upsertExecution(record({ executionId: 'e', status: 'CANCELLED', completedAt: undefined, durationMs: undefined }));

    const result = await timeline.getPerformanceTimeline({ bucketMs: 3600 * 1000 });
    expect(result.points).toHaveLength(2);
    expect(result.points[0]?.executions).toBe(3);
    expect(result.points[0]?.averageDurationMs).toBe(150);
    expect(result.points[0]?.failures).toBe(0);
    expect(result.points[1]?.executions).toBe(1);
    expect(result.points[1]?.failures).toBe(1);
  });

  it('applies a limit to the performance timeline', async () => {
    await store.upsertExecution(record({ executionId: 'a', completedAt: '2026-01-01T00:00:00.000Z', durationMs: 100 }));
    await store.upsertExecution(record({ executionId: 'b', completedAt: '2026-01-02T00:00:00.000Z', durationMs: 100 }));
    const result = await timeline.getPerformanceTimeline({ bucketMs: 3600 * 1000, limit: 1 });
    expect(result.points).toHaveLength(1);
  });

  it('handles executions without duration in performance buckets', async () => {
    await store.upsertExecution(record({ executionId: 'a', completedAt: '2026-01-01T00:00:00.000Z', durationMs: undefined }));
    const result = await timeline.getPerformanceTimeline({ bucketMs: 3600 * 1000 });
    expect(result.points[0]?.averageDurationMs).toBe(0);
    expect(result.points[0]?.executions).toBe(1);
  });
});
