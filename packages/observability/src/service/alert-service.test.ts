import { describe, expect, it, beforeEach } from 'vitest';
import { AlertService } from './alert-service.js';
import { InMemoryObservabilityStore } from '../store/in-memory-observability-store.js';
import type { ObservabilityEvent, StoredEvent } from '../types/events.js';
import { DEFAULT_ALERT_OPTIONS } from '../types/options.js';
import { executionEvent } from '../test/helpers.js';

const AT = '2026-01-01T00:00:00.000Z';

async function appendEvent(store: InMemoryObservabilityStore, event: ObservabilityEvent): Promise<void> {
  const stored: StoredEvent = {
    id: `evt-${Math.random()}`,
    type: event.type,
    storeId: 'storeId' in event ? event.storeId : undefined,
    occurredAt: AT,
    event,
  };
  await store.appendEvent(stored);
}

describe('AlertService', () => {
  let store: InMemoryObservabilityStore;
  let alerts: AlertService;

  beforeEach(() => {
    store = new InMemoryObservabilityStore();
    alerts = new AlertService(store, DEFAULT_ALERT_OPTIONS);
  });

  it('raises a warning failure alert for a plain execution failure', async () => {
    const result = await alerts.evaluate(executionEvent('execution.failed', { error: 'boom', retryCount: undefined }), AT);
    expect(result).toHaveLength(1);
    expect(result[0]?.type).toBe('execution_failure');
    expect(result[0]?.severity).toBe('warning');
    expect(result[0]?.context.error).toBe('boom');
  });

  it('raises a critical failure alert when retries reach the threshold', async () => {
    const result = await alerts.evaluate(
      executionEvent('execution.failed', { error: 'boom', retryCount: DEFAULT_ALERT_OPTIONS.criticalRetryCount }),
      AT,
    );
    expect(result[0]?.severity).toBe('critical');
  });

  it('raises critical alerts for publisher, rollback and safety failures', async () => {
    const publisher = await alerts.evaluate(executionEvent('execution.publisher_failed', { error: 'net' }), AT);
    const rollback = await alerts.evaluate(executionEvent('execution.rollback_failed', { error: 'undo', rollbackId: 'rb' }), AT);
    const safety = await alerts.evaluate(executionEvent('execution.safety_violation', { violation: 'blocked action' }), AT);
    const bareRollback = await alerts.evaluate(executionEvent('execution.rollback_failed', { error: 'undo', rollbackId: undefined }), AT);
    expect(publisher[0]?.severity).toBe('critical');
    expect(rollback[0]?.severity).toBe('critical');
    expect(safety[0]?.severity).toBe('critical');
    expect(safety[0]?.context.violation).toBe('blocked action');
    expect(bareRollback[0]?.context.rollbackId).toBeUndefined();
  });

  it('raises no alert for non-failure events', async () => {
    expect(await alerts.evaluate(executionEvent('execution.started'), AT)).toEqual([]);
    expect(await alerts.evaluate(executionEvent('execution.completed'), AT)).toEqual([]);
  });

  it('fires a rollback spike when the window threshold is reached', async () => {
    for (let i = 0; i < DEFAULT_ALERT_OPTIONS.rollbackSpikeThreshold; i += 1) {
      await appendEvent(store, executionEvent('execution.rollback_completed', { rollbackId: `rb-${i}` }));
    }
    const below = await alerts.evaluate(executionEvent('execution.rollback_completed', { rollbackId: 'rb-x' }), AT);
    expect(below[0]?.type).toBe('rollback_spike');
    expect(below[0]?.severity).toBe('critical');
    expect(below[0]?.context.count).toBe(DEFAULT_ALERT_OPTIONS.rollbackSpikeThreshold);
  });

  it('does not fire a rollback spike below the threshold', async () => {
    await appendEvent(store, executionEvent('execution.rollback_completed', { rollbackId: 'rb-1' }));
    const result = await alerts.evaluate(executionEvent('execution.rollback_completed', { rollbackId: 'rb-2' }), AT);
    expect(result).toEqual([]);
  });

  it('fires a rollback spike for storeless events across all stores', async () => {
    for (let i = 0; i < DEFAULT_ALERT_OPTIONS.rollbackSpikeThreshold; i += 1) {
      await appendEvent(store, executionEvent('execution.rollback_completed', { storeId: undefined, rollbackId: `rb-${i}` }));
    }
    const result = await alerts.evaluate(
      executionEvent('execution.rollback_completed', { storeId: undefined, rollbackId: 'rb-x' }),
      AT,
    );
    expect(result[0]?.type).toBe('rollback_spike');
    expect(result[0]?.storeId).toBeUndefined();
  });

  it('fires a validation spike when the window threshold is reached', async () => {
    for (let i = 0; i < DEFAULT_ALERT_OPTIONS.validationSpikeThreshold; i += 1) {
      await appendEvent(store, { type: 'validation.failed', codes: ['schema'] });
    }
    const result = await alerts.evaluate({ type: 'validation.failed', codes: ['schema'] }, AT);
    expect(result[0]?.type).toBe('validation_spike');
    expect(result[0]?.severity).toBe('warning');
  });

  it('does not fire a validation spike below the threshold', async () => {
    await appendEvent(store, { type: 'validation.failed', codes: ['schema'] });
    const result = await alerts.evaluate({ type: 'validation.failed', codes: ['schema'] }, AT);
    expect(result).toEqual([]);
  });

  it('fires an SEO regression when the score drops past the delta', async () => {
    await store.appendSnapshot({
      snapshotId: 'snap-before',
      storeId: 'store-1',
      capturedAt: '2026-01-01T00:00:00.000Z',
      overallScore: 80,
    });
    await store.appendSnapshot({
      snapshotId: 'snap-current',
      storeId: 'store-1',
      capturedAt: '2026-01-01T01:00:00.000Z',
      overallScore: 70,
    });
    const result = await alerts.evaluate(
      { type: 'seo.analysis.completed', storeId: 'store-1', overallScore: 70 },
      AT,
    );
    expect(result[0]?.type).toBe('seo_regression');
    expect(result[0]?.context.drop).toBe(10);
    expect(result[0]?.context.previousScore).toBe(80);
  });

  it('does not fire a regression for a small or positive delta', async () => {
    await store.appendSnapshot({
      snapshotId: 'snap-before',
      storeId: 'store-1',
      capturedAt: '2026-01-01T00:00:00.000Z',
      overallScore: 80,
    });
    await store.appendSnapshot({
      snapshotId: 'snap-small',
      storeId: 'store-1',
      capturedAt: '2026-01-01T01:00:00.000Z',
      overallScore: 76,
    });
    await store.appendSnapshot({
      snapshotId: 'snap-up',
      storeId: 'store-1',
      capturedAt: '2026-01-01T02:00:00.000Z',
      overallScore: 90,
    });
    const smallDrop = await alerts.evaluate({ type: 'seo.analysis.completed', storeId: 'store-1', overallScore: 76 }, AT);
    const improvement = await alerts.evaluate({ type: 'seo.analysis.completed', storeId: 'store-1', overallScore: 90 }, AT);
    expect(smallDrop).toEqual([]);
    expect(improvement).toEqual([]);
  });

  it('does not fire a regression without a previous snapshot', async () => {
    const result = await alerts.evaluate({ type: 'seo.analysis.completed', storeId: 'store-1', overallScore: 50 }, AT);
    expect(result).toEqual([]);
  });

  it('scopes spike counts to a store', async () => {
    for (let i = 0; i < DEFAULT_ALERT_OPTIONS.rollbackSpikeThreshold; i += 1) {
      await appendEvent(store, executionEvent('execution.rollback_completed', { storeId: 'store-2', rollbackId: `rb-${i}` }));
    }
    const result = await alerts.evaluate(
      executionEvent('execution.rollback_completed', { storeId: 'store-1', rollbackId: 'rb-x' }),
      AT,
    );
    expect(result).toEqual([]);
  });
});
