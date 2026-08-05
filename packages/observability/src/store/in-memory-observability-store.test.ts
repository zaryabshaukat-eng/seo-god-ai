import { describe, expect, it, beforeEach } from 'vitest';
import { InMemoryObservabilityStore } from './in-memory-observability-store.js';
import type { ExecutionRecord } from '../types/models.js';
import type { ObservabilityEvent, StoredEvent } from '../types/events.js';

function record(overrides: Partial<ExecutionRecord> = {}): ExecutionRecord {
  return {
    executionId: 'exec-1',
    storeId: 'store-1',
    status: 'COMPLETED',
    startedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function storedEvent(overrides: Partial<StoredEvent> = {}): StoredEvent {
  return {
    id: 'evt-1',
    type: 'execution.completed',
    storeId: 'store-1',
    occurredAt: '2026-01-01T00:00:00.000Z',
    event: {
      type: 'execution.completed',
      executionId: 'exec-1',
      storeId: 'store-1',
    } as ObservabilityEvent,
    ...overrides,
  };
}

describe('InMemoryObservabilityStore', () => {
  let store: InMemoryObservabilityStore;

  beforeEach(() => {
    store = new InMemoryObservabilityStore();
  });

  it('upserts executions and finds them by id', async () => {
    await store.upsertExecution(record());
    expect(await store.findExecution('exec-1')).toMatchObject({ executionId: 'exec-1', status: 'COMPLETED' });
    expect(await store.findExecution('missing')).toBeNull();
  });

  it('merges fields when upserting an existing execution', async () => {
    await store.upsertExecution(record());
    await store.upsertExecution(record({ status: 'FAILED', error: 'boom' }));
    const found = await store.findExecution('exec-1');
    expect(found?.status).toBe('FAILED');
    expect(found?.error).toBe('boom');
    expect(found?.storeId).toBe('store-1');
  });

  it('lists executions newest-first with store/status/since filters and limit', async () => {
    await store.upsertExecution(record({ executionId: 'a', storeId: 'store-1', status: 'COMPLETED', startedAt: '2026-01-01T00:00:00.000Z' }));
    await store.upsertExecution(record({ executionId: 'b', storeId: 'store-1', status: 'FAILED', startedAt: '2026-01-01T00:01:00.000Z' }));
    await store.upsertExecution(record({ executionId: 'c', storeId: 'store-2', status: 'QUEUED', startedAt: '2026-01-01T00:02:00.000Z' }));

    expect((await store.listExecutions()).map((e) => e.executionId)).toEqual(['c', 'b', 'a']);
    expect((await store.listExecutions({ storeId: 'store-1' })).map((e) => e.executionId)).toEqual(['b', 'a']);
    expect((await store.listExecutions({ status: 'FAILED' })).map((e) => e.executionId)).toEqual(['b']);
    expect((await store.listExecutions({ since: '2026-01-01T00:01:00.000Z' })).map((e) => e.executionId)).toEqual(['c', 'b']);
    expect((await store.listExecutions({ storeId: 'store-1', limit: 1 })).map((e) => e.executionId)).toEqual(['b']);
    expect((await store.listExecutions({ executionId: 'b' })).map((e) => e.executionId)).toEqual(['b']);
  });

  it('appends change history immutably and dedupes by changeId', async () => {
    const change = {
      changeId: 'change-1',
      kind: 'apply' as const,
      executionId: 'exec-1',
      storeId: 'store-1',
      entityId: 'page-1',
      changedFields: ['title'],
      before: { title: 'Old' },
      after: { title: 'New' },
      appliedAt: '2026-01-01T00:00:00.000Z',
    };
    await store.appendChange(change);
    await store.appendChange({ ...change, changeId: 'change-2', appliedAt: '2026-01-02T00:00:00.000Z' });
    await store.appendChange({ ...change });
    const changes = await store.listChanges();
    expect(changes).toHaveLength(2);
    expect(changes[0]?.changeId).toBe('change-2');
    expect(await store.listChanges({ storeId: 'other' })).toHaveLength(0);
    expect(await store.listChanges({ executionId: 'exec-1' })).toHaveLength(2);
    expect(await store.listChanges({ since: '2026-01-02T00:00:00.000Z' })).toHaveLength(1);
    expect(await store.listChanges({ since: '2027-01-01T00:00:00.000Z' })).toHaveLength(0);
  });

  it('appends snapshots and alerts with dedupe and filtering', async () => {
    const snapshot = {
      snapshotId: 'snap-1',
      storeId: 'store-1',
      capturedAt: '2026-01-01T00:00:00.000Z',
      overallScore: 80,
    };
    await store.appendSnapshot(snapshot);
    await store.appendSnapshot({ ...snapshot, snapshotId: 'snap-2', overallScore: 90, capturedAt: '2026-01-02T00:00:00.000Z' });
    await store.appendSnapshot(snapshot);
    expect(await store.listSnapshots()).toHaveLength(2);
    expect((await store.listSnapshots())[0]?.overallScore).toBe(90);
    expect(await store.listSnapshots({ since: '2026-01-02T00:00:00.000Z' })).toHaveLength(1);
    expect(await store.listSnapshots({ since: '2027-01-01T00:00:00.000Z' })).toHaveLength(0);

    const alert = {
      alertId: 'alert-1',
      type: 'execution_failure' as const,
      severity: 'warning' as const,
      message: 'x',
      triggeredAt: '2026-01-01T00:00:00.000Z',
      context: {},
    };
    await store.appendAlert(alert);
    await store.appendAlert(alert);
    expect(await store.listAlerts()).toHaveLength(1);
    expect(await store.listAlerts({ storeId: 'nope' })).toHaveLength(0);
    expect(await store.listAlerts({ since: '2026-01-01T00:00:00.000Z' })).toHaveLength(1);
    expect(await store.listAlerts({ since: '2027-01-01T00:00:00.000Z' })).toHaveLength(0);
  });

  it('appends events immutably with dedupe and filters', async () => {
    await store.appendEvent(storedEvent());
    await store.appendEvent(storedEvent());
    await store.appendEvent(storedEvent({ id: 'evt-2', occurredAt: '2026-01-02T00:00:00.000Z', storeId: 'store-2' }));
    const events = await store.listEvents();
    expect(events).toHaveLength(2);
    expect(events[0]?.id).toBe('evt-2');
    expect(await store.listEvents({ storeId: 'store-1' })).toHaveLength(1);
    expect(await store.listEvents({ since: '2026-01-02T00:00:00.000Z' })).toHaveLength(1);
  });

  it('reset clears every collection', async () => {
    await store.upsertExecution(record());
    await store.appendChange({ changeId: 'c', executionId: 'exec-1', storeId: 'store-1', entityId: 'p', changedFields: [], before: null, after: null, appliedAt: 't', kind: 'apply' });
    await store.appendEvent(storedEvent());
    await store.reset();
    expect(await store.listExecutions()).toHaveLength(0);
    expect(await store.listChanges()).toHaveLength(0);
    expect(await store.listEvents()).toHaveLength(0);
  });
});
