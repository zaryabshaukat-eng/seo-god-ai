import { describe, expect, it, beforeEach } from 'vitest';
import { MetricsRegistry } from '@seogod/monitoring';
import { ObservabilityService } from './observability-service.js';
import { InMemoryObservabilityStore } from '../store/in-memory-observability-store.js';
import { buildReport, executionEvent } from '../test/helpers.js';
import type { ObservabilityEvent } from '../types/events.js';
import { DEFAULT_ALERT_OPTIONS } from '../types/options.js';

interface Harness {
  store: InMemoryObservabilityStore;
  registry: MetricsRegistry;
  service: ObservabilityService;
  tick: (ms: number) => void;
}

function makeService(alert = {}): Harness {
  const store = new InMemoryObservabilityStore();
  const registry = new MetricsRegistry();
  let time = 0;
  const service = new ObservabilityService(store, {
    now: () => new Date(1_700_000_000_000 + time).toISOString(),
    metrics: registry,
    alert: { ...alert },
  });
  return {
    store,
    registry,
    service,
    tick: (ms) => {
      time += ms;
    },
  };
}

describe('ObservabilityService', () => {
  let h: Harness;

  beforeEach(() => {
    h = makeService();
  });

  it('records a full execution lifecycle ending completed', async () => {
    const queued = await h.service.handle(executionEvent('execution.queued'));
    h.tick(100);
    await h.service.handle(executionEvent('execution.started'));
    h.tick(200);
    const completed = await h.service.handle(executionEvent('execution.completed', { duration: 300 }));

    expect(queued.alerts).toEqual([]);
    expect(completed.alerts).toEqual([]);

    const record = await h.store.findExecution('exec-1');
    expect(record).toMatchObject({
      executionId: 'exec-1',
      storeId: 'store-1',
      operation: 'seo.update_title',
      entityType: 'page',
      entityId: 'page-1',
      batchId: 'batch-1',
      status: 'COMPLETED',
      durationMs: 300,
    });
    expect(record?.completedAt).toBeDefined();
    expect(record?.startedAt).toBeDefined();

    const events = await h.store.listEvents();
    expect(events).toHaveLength(3);
    expect(events.map((e) => e.type)).toEqual(['execution.completed', 'execution.started', 'execution.queued']);
  });

  it('computes duration from timestamps when the event omits it', async () => {
    await h.service.handle(executionEvent('execution.started'));
    h.tick(500);
    await h.service.handle(executionEvent('execution.completed'));
    const record = await h.store.findExecution('exec-1');
    expect(record?.durationMs).toBe(500);
  });

  it('records failures, cancellations, publisher failures and safety violations', async () => {
    await h.service.handle(executionEvent('execution.started'));
    const failed = await h.service.handle(executionEvent('execution.failed', { error: 'boom' }));
    expect(failed.alerts[0]?.type).toBe('execution_failure');
    expect((await h.store.findExecution('exec-1'))?.status).toBe('FAILED');
    expect((await h.store.findExecution('exec-1'))?.error).toBe('boom');

    await h.service.handle(executionEvent('execution.cancelled', { executionId: 'exec-2', reason: 'user cancelled' }));
    expect((await h.store.findExecution('exec-2'))?.status).toBe('CANCELLED');

    await h.service.handle(executionEvent('execution.publisher_failed', { executionId: 'exec-3', error: 'net down' }));
    expect((await h.store.findExecution('exec-3'))?.status).toBe('FAILED');

    const safety = await h.service.handle(executionEvent('execution.safety_violation', { executionId: 'exec-4', violation: 'delete blocked' }));
    const exec4 = await h.store.findExecution('exec-4');
    expect(exec4?.status).toBe('FAILED');
    expect(exec4?.error).toBe('delete blocked');
    expect(safety.alerts[0]?.severity).toBe('critical');
  });

  it('moves a completed execution to ROLLED_BACK on rollback completion', async () => {
    await h.service.handle(executionEvent('execution.completed'));
    await h.service.handle(executionEvent('execution.rollback_started', { rollbackId: 'rb-1' }));
    await h.service.handle(executionEvent('execution.rollback_completed', { rollbackId: 'rb-1' }));
    const record = await h.store.findExecution('exec-1');
    expect(record?.status).toBe('ROLLED_BACK');
    expect(record?.rollbackId).toBe('rb-1');
  });

  it('annotates a completed execution when its rollback fails', async () => {
    await h.service.handle(executionEvent('execution.completed'));
    const result = await h.service.handle(executionEvent('execution.rollback_failed', { rollbackId: 'rb-1', error: 'undo failed' }));
    const record = await h.store.findExecution('exec-1');
    expect(record?.status).toBe('COMPLETED');
    expect(record?.error).toBe('undo failed');
    expect(record?.rollbackId).toBe('rb-1');
    expect(result.alerts[0]?.severity).toBe('critical');
  });

  it('creates a FAILED record for a rollback failure with no prior record', async () => {
    await h.service.handle(executionEvent('execution.rollback_failed', { rollbackId: 'rb-1', error: 'undo failed' }));
    const record = await h.store.findExecution('exec-1');
    expect(record?.status).toBe('FAILED');
    expect(record?.error).toBe('undo failed');
  });

  it('is idempotent: duplicate deliveries do not create duplicate records or events', async () => {
    const first = await h.service.handle(executionEvent('execution.completed', { duration: 100 }));
    const second = await h.service.handle(executionEvent('execution.completed', { duration: 100 }));
    expect(first.stored.id).toBe(second.stored.id);
    expect(await h.store.listEvents()).toHaveLength(1);
    expect(await h.store.listExecutions()).toHaveLength(1);
  });

  it('never regresses: a later failed event does not override COMPLETED', async () => {
    await h.service.handle(executionEvent('execution.completed'));
    await h.service.handle(executionEvent('execution.failed', { error: 'late' }));
    expect((await h.store.findExecution('exec-1'))?.status).toBe('COMPLETED');
  });

  it('keeps a terminal record sticky when a started event arrives out of order', async () => {
    await h.service.handle(executionEvent('execution.completed'));
    await h.service.handle(executionEvent('execution.started'));
    expect((await h.store.findExecution('exec-1'))?.status).toBe('COMPLETED');
  });

  it('merges context fields across queued and started events', async () => {
    await h.service.handle(executionEvent('execution.queued', { batchId: undefined, workflowId: undefined, entityType: undefined, entityId: undefined, operation: undefined, retryCount: undefined }));
    await h.service.handle(executionEvent('execution.started'));
    const record = await h.store.findExecution('exec-1');
    expect(record?.operation).toBe('seo.update_title');
    expect(record?.batchId).toBe('batch-1');
  });

  it('records crawl and validation events into the log and registry', async () => {
    await h.service.handle({ type: 'crawl.completed', storeId: 'store-1', statistics: { pagesCrawled: 10, pagesFailed: 0, pagesBlocked: 0, totalIssues: 0, brokenLinks: 0, averageResponseTimeMs: 100, totalBytes: 0, durationMs: 100 } });
    await h.service.handle({ type: 'crawl.failed', storeId: 'store-1', error: 'timeout' });
    await h.service.handle({ type: 'validation.failed', executionId: 'exec-1', codes: ['schema'] });

    const events = await h.store.listEvents();
    expect(events.map((e) => e.type)).toEqual(['crawl.completed', 'crawl.failed', 'validation.failed']);
    const snapshot = h.registry.snapshot();
    expect(snapshot.counters['crawl_completed_total']).toBe(1);
    expect(snapshot.counters['crawl_failed_total']).toBe(1);
    expect(snapshot.counters['validation_failed_total']).toBe(1);
  });

  it('fires a validation spike alert through handle()', async () => {
    h = makeService();
    for (let i = 0; i < DEFAULT_ALERT_OPTIONS.validationSpikeThreshold; i += 1) {
      h.tick(1);
      await h.service.handle({ type: 'validation.failed', executionId: `exec-${i}`, storeId: 'store-1', codes: ['schema'] });
    }
    const alerts = await h.service.getAlerts();
    expect(alerts.filter((alert) => alert.type === 'validation_spike')).toHaveLength(1);
  });

  it('records SEO analysis snapshots and fires regression alerts', async () => {
    await h.service.recordAnalysis({ storeId: 'store-1', overallScore: 80, scores: { title: 80 } });
    h.tick(60_000);
    const snapshot = await h.service.recordAnalysis({ storeId: 'store-1', overallScore: 70, reference: 'AFTER', executionId: 'exec-9' });
    expect(snapshot.overallScore).toBe(70);

    const snapshots = await h.store.listSnapshots();
    expect(snapshots).toHaveLength(2);

    const alerts = await h.service.getAlerts();
    expect(alerts.filter((alert) => alert.type === 'seo_regression')).toHaveLength(1);
  });

  it('records an analysis event through handle()', async () => {
    await h.service.handle({ type: 'seo.analysis.completed', storeId: 'store-1', overallScore: 75 });
    const snapshots = await h.store.listSnapshots();
    expect(snapshots[0]?.overallScore).toBe(75);
  });

  it('recordReport stores a rich execution record and immutable changes', async () => {
    const record = await h.service.recordReport(buildReport());
    expect(record).toMatchObject({
      executionId: 'exec-1',
      storeId: 'store-1',
      status: 'COMPLETED',
      simulation: false,
      totalSteps: 2,
      completedSteps: 1,
      simulatedSteps: 1,
      apiCalls: 3,
      batchSize: 1,
      averageStepTimeMs: 500,
      writeRate: 1.5,
    });

    const changes = await h.store.listChanges();
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ kind: 'apply', entityId: 'page-1', changedFields: ['title'] });
  });

  it('recordReport records revert changes for completed rollbacks', async () => {
    await h.service.recordReport(buildReport({ rollbackCompleted: true }));
    const changes = await h.store.listChanges();
    expect(changes).toHaveLength(2);
    const revert = changes.find((change) => change.kind === 'revert');
    expect(revert?.rollbackId).toBe('rollback-1');
    expect(revert?.after).toEqual({ title: 'Old Title' });
  });

  it('recordReport skips diffs without changes and incomplete rollbacks', async () => {
    await h.service.recordReport(buildReport({ hasChanges: false, rollbackCompleted: false }));
    expect(await h.store.listChanges()).toHaveLength(0);
    await h.service.recordReport(buildReport({ hasChanges: false, rollbackStatus: 'FAILED' }));
    expect(await h.store.listChanges()).toHaveLength(0);
  });

  it('recordReport handles null metrics and dry-run reports', async () => {
    const report = buildReport({ rollbackCompleted: true });
    report.metrics = null;
    report.execution.status = 'COMPLETED';
    report.execution.mode = 'DRY_RUN';
    const record = await h.service.recordReport(report);
    expect(record.simulation).toBe(true);
    expect(record.batchSize).toBeUndefined();
  });

  it('recordReport maps engine statuses into the observability vocabulary', async () => {
    const rejected = await h.service.recordReport(buildReport({ status: 'REJECTED' }));
    expect(rejected.status).toBe('FAILED');
    const rolledBack = await h.service.recordReport(buildReport({ status: 'ROLLED_BACK' }));
    expect(rolledBack.status).toBe('ROLLED_BACK');
    const cancelled = await h.service.recordReport(buildReport({ status: 'CANCELLED' }));
    expect(cancelled.status).toBe('CANCELLED');
    const executing = await h.service.recordReport(buildReport({ status: 'EXECUTING' }));
    expect(executing.status).toBe('EXECUTING');
    const validating = await h.service.recordReport(buildReport({ status: 'VALIDATING' }));
    expect(validating.status).toBe('EXECUTING');
    const queued = await h.service.recordReport(buildReport({ status: 'QUEUED' }));
    expect(queued.status).toBe('QUEUED');
    const completed = await h.service.recordReport(buildReport({ status: 'COMPLETED' }));
    expect(completed.status).toBe('COMPLETED');
    const unknown = await h.service.recordReport(buildReport({ status: 'BOGUS' }));
    expect(unknown.status).toBe('QUEUED');
  });

  it('runs a full lifecycle without a metrics registry', async () => {
    const bare = new ObservabilityService(new InMemoryObservabilityStore(), {
      now: () => '2026-01-01T00:00:00.000Z',
    });
    await bare.handle(executionEvent('execution.queued'));
    await bare.handle(executionEvent('execution.started'));
    await bare.handle(executionEvent('execution.completed', { duration: 100 }));
    await bare.handle(executionEvent('execution.rollback_failed', { rollbackId: 'rb-1', error: 'x' }));
    await bare.handle({
      type: 'crawl.completed',
      storeId: 'store-1',
      statistics: { pagesCrawled: 1, pagesFailed: 0, pagesBlocked: 0, totalIssues: 0, brokenLinks: 0, averageResponseTimeMs: 0, totalBytes: 0, durationMs: 0 },
    });
    await bare.handle({ type: 'crawl.failed', storeId: 'store-1', error: 'x' });
    await bare.handle({ type: 'validation.failed', storeId: 'store-1', codes: ['a'] });
    await bare.recordAnalysis({ storeId: 'store-1', overallScore: 90 });
    await bare.recordReport(buildReport());
    await bare.reset();
    expect(bare.metricsSnapshot()).toBeNull();
  });

  it('exposes the dashboard API', async () => {
    await h.service.handle(executionEvent('execution.completed', { duration: 100 }));
    await h.service.recordAnalysis({ storeId: 'store-1', overallScore: 90 });

    const overview = await h.service.getOverview();
    expect(overview.executionCount).toBe(1);
    expect(overview.latestSeoScore).toBe(90);

    const metrics = await h.service.getExecutionMetrics();
    expect(metrics.completed).toBe(1);
    expect(metrics.successRate).toBe(1);

    const history = await h.service.getHistory({ storeId: 'store-1' });
    expect(history.executions).toHaveLength(1);
    expect(history.snapshots).toHaveLength(1);

    const timeline = await h.service.getSeoTimeline({ storeId: 'store-1' });
    expect(timeline.points[0]?.overallScore).toBe(90);

    const executionTimeline = await h.service.getExecutionTimeline({ storeId: 'store-1' });
    expect(executionTimeline[0]?.executionId).toBe('exec-1');

    const performance = await h.service.getPerformanceTimeline({ storeId: 'store-1' });
    expect(performance.points[0]?.executions).toBe(1);

    const signals = await h.service.getLearningSignals();
    expect(signals[0]?.attempts).toBe(1);

    const changes = await h.service.getChanges('store-1');
    expect(changes).toEqual([]);
  });

  it('returns null metrics snapshot when no registry is wired', async () => {
    const bare = new ObservabilityService(new InMemoryObservabilityStore());
    expect(bare.metricsSnapshot()).toBeNull();
  });

  it('reports registry counters and gauges for recorded events', async () => {
    await h.service.handle(executionEvent('execution.completed', { duration: 250 }));
    await h.service.recordAnalysis({ storeId: 'store-1', overallScore: 88 });
    const snapshot = h.registry.snapshot();
    expect(snapshot.counters['execution_completed_total']).toBe(1);
    expect(snapshot.histograms['execution_duration_milliseconds']?.avg).toBe(250);
    expect(snapshot.gauges['seo_overall_score_store-1']).toBe(88);
    expect(h.service.metricsSnapshot()?.counters['execution_completed_total']).toBe(1);
  });

  it('reset clears store and registry', async () => {
    await h.service.handle(executionEvent('execution.completed'));
    await h.service.reset();
    expect(await h.store.listExecutions()).toHaveLength(0);
    expect(h.registry.snapshot().counters).toEqual({});
  });

  it('surfaces a rejected unknown event type by not matching any case', async () => {
    const result = await h.service.handle({ type: 'store.installed', storeId: 'store-1' } as unknown as ObservabilityEvent);
    expect(result.stored.type).toBe('store.installed');
    expect(await h.store.listExecutions()).toHaveLength(0);
  });
});
