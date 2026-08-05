/**
 * Observability engine facade. Records execution, crawl, SEO analysis and
 * validation events into an immutable store; derives metrics, alerts,
 * timelines, dashboard overviews and learning signals. Implements the
 * execution engine's {@link ExecutionSink} shape via the adapter and can be
 * wired to the outbox {@link EventBus} via the consumer.
 */

import { deterministicUuid } from '@seogod/execution-engine';
import type { ExecutionEvent, ExecutionReport } from '@seogod/execution-engine';
import type { MetricSnapshot, MetricsRegistry } from '@seogod/monitoring';
import { AlertService } from './alert-service.js';
import { DashboardService } from './dashboard-service.js';
import { LearningSignalService } from './learning-signal-service.js';
import { MetricsService } from './metrics-service.js';
import { TimelineService } from './timeline-service.js';
import type { PerformanceTimelineOptions, TimelineOptions } from './timeline-service.js';
import type { ObservabilityStore } from '../store/observability-store.js';
import type {
  ObservabilityEvent,
  SeoAnalysisEvent,
  SeoAnalysisInput,
  StoredEvent,
} from '../types/events.js';
import type {
  AlertRecord,
  ChangeRecord,
  ExecutionRecord,
  ExecutionStatus,
  SeoSnapshot,
  TimelinePoint,
} from '../types/models.js';
import { TERMINAL_STATUSES } from '../types/models.js';
import type { ObservabilityServiceOptions } from '../types/options.js';
import { DEFAULT_ALERT_OPTIONS } from '../types/options.js';
import type { ExecutionMetricsSummary, LearningSignal, ObservabilityOverview } from '../types/signals.js';
import type { ObservabilityHistory, PerformanceTimeline, SeoTimeline } from '../types/models.js';

export interface RecordResult {
  stored: StoredEvent;
  alerts: AlertRecord[];
}

const STATUS_RANK: Record<ExecutionStatus, number> = {
  QUEUED: 0,
  EXECUTING: 1,
  COMPLETED: 2,
  FAILED: 2,
  CANCELLED: 2,
  ROLLED_BACK: 3,
};

function storeIdOf(event: ObservabilityEvent): string | undefined {
  return event.storeId;
}

function isTerminal(status: ExecutionStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

function elapsedMs(startedAt: string, completedAt: string): number {
  return Math.max(0, Date.parse(completedAt) - Date.parse(startedAt));
}

/** Context fields shared by every execution event. */
const CONTEXT_KEYS = ['batchId', 'workflowId', 'entityType', 'entityId', 'operation', 'retryCount'] as const;

function contextOf(event: ExecutionEvent): Partial<ExecutionRecord> {
  const context: Partial<ExecutionRecord> = {};
  for (const key of CONTEXT_KEYS) {
    const value = event[key];
    if (value !== undefined) {
      (context as Record<string, unknown>)[key] = value;
    }
  }
  return context;
}

export class ObservabilityService {
  private readonly store: ObservabilityStore;
  private readonly now: () => string;
  private readonly registry?: MetricsRegistry;
  private readonly alertService: AlertService;
  private readonly metricsService: MetricsService;
  private readonly timelineService: TimelineService;
  private readonly dashboardService: DashboardService;
  private readonly learningSignalService: LearningSignalService;

  constructor(store: ObservabilityStore, options: ObservabilityServiceOptions = {}) {
    this.store = store;
    this.now = options.now ?? (() => new Date().toISOString());
    this.registry = options.metrics;
    this.alertService = new AlertService(store, { ...DEFAULT_ALERT_OPTIONS, ...options.alert });
    this.metricsService = new MetricsService(store);
    this.timelineService = new TimelineService(store);
    this.dashboardService = new DashboardService(store);
    this.learningSignalService = new LearningSignalService(store);
  }

  /** Consumes a single observability event. */
  async handle(event: ObservabilityEvent): Promise<RecordResult> {
    const at = this.now();
    const stored: StoredEvent = {
      id: deterministicUuid(`event:${JSON.stringify(event)}`),
      type: event.type,
      storeId: storeIdOf(event),
      occurredAt: at,
      event,
    };
    await this.store.appendEvent(stored);
    await this.applyEvent(event, at);
    const alerts = await this.alertService.evaluate(event, at);
    for (const alert of alerts) {
      await this.store.appendAlert(alert);
    }
    if (alerts.length > 0) {
      this.registry?.increment('alert_generated_total', alerts.length);
    }
    return { stored, alerts };
  }

  /** Records a full execution report (rich source: steps, diffs, rollbacks). */
  async recordReport(report: ExecutionReport): Promise<ExecutionRecord> {
    const { execution } = report;
    const at = this.now();
    const startedAt = execution.startedAt?.toISOString() ?? execution.createdAt.toISOString();
    const completedAt = execution.completedAt?.toISOString();
    const status = mapEngineStatus(execution.status);
    const firstStep = execution.steps[0];

    const record: ExecutionRecord = {
      executionId: execution.id,
      storeId: execution.storeId,
      workflowId: execution.workflowId ?? undefined,
      operation: firstStep?.actionType,
      entityType: firstStep?.resourceType,
      entityId: firstStep?.resourceId,
      status,
      startedAt,
      completedAt,
      durationMs:
        execution.summary.durationMs ??
        (completedAt === undefined ? undefined : elapsedMs(startedAt, completedAt)),
      simulation: execution.mode === 'DRY_RUN' || execution.mode === 'SIMULATION',
      totalSteps: execution.summary.total,
      completedSteps: execution.summary.completed,
      simulatedSteps: execution.summary.simulated,
      failedSteps: execution.summary.failed,
      skippedSteps: execution.summary.skipped,
      cancelledSteps: execution.summary.cancelled,
      rolledBackSteps: execution.summary.rolledBack,
      apiCalls: execution.summary.apiCalls,
      batchSize: report.metrics?.batchSize,
      averageStepTimeMs: report.metrics?.averageStepTimeMs,
      writeRate: report.metrics?.writeRate,
      rollbackId: report.rollbacks[0]?.id,
    };
    await this.store.upsertExecution(record);

    for (const diff of report.diffs) {
      if (!diff.hasChanges) continue;
      await this.store.appendChange({
        changeId: deterministicUuid(`change:${diff.id}`),
        kind: 'apply',
        executionId: diff.executionId,
        storeId: diff.storeId,
        entityType: diff.resourceType,
        entityId: diff.entityId,
        operation: diff.actionType,
        appliedAt: at,
        changedFields: diff.changedFields,
        before: diff.before,
        after: diff.after,
      });
    }

    for (const rollback of report.rollbacks) {
      if (rollback.status !== 'COMPLETED') continue;
      for (const step of rollback.plan?.steps ?? []) {
        await this.store.appendChange({
          changeId: deterministicUuid(`revert:${rollback.id}:${step.resourceId}`),
          kind: 'revert',
          executionId: rollback.executionId,
          storeId: rollback.storeId,
          entityType: step.resourceType,
          entityId: step.resourceId,
          appliedAt: rollback.completedAt?.toISOString() ?? at,
          changedFields: Object.keys(step.payload),
          before: null,
          after: step.payload,
          rollbackId: rollback.id,
        });
      }
    }

    this.registry?.increment(`execution_${status.toLowerCase()}_total`, 1);
    if (record.durationMs !== undefined) {
      this.registry?.observe('execution_duration_milliseconds', record.durationMs);
    }
    return record;
  }

  /** Records an SEO analysis snapshot (adapter for `seo.analysis.completed`). */
  async recordAnalysis(input: SeoAnalysisInput): Promise<SeoSnapshot> {
    const at = this.now();
    const event: SeoAnalysisEvent = { ...input, type: 'seo.analysis.completed' };
    const snapshot = await this.applySeoAnalysis(event, at);
    const alerts = await this.alertService.evaluate(event, at);
    for (const alert of alerts) {
      await this.store.appendAlert(alert);
    }
    if (alerts.length > 0) {
      this.registry?.increment('alert_generated_total', alerts.length);
    }
    return snapshot;
  }

  // ---------------------------------------------------------------------
  // Dashboard API.
  // ---------------------------------------------------------------------

  getOverview(storeId?: string): Promise<ObservabilityOverview> {
    return this.dashboardService.getOverview(storeId);
  }

  getExecutionMetrics(storeId?: string): Promise<ExecutionMetricsSummary> {
    return this.metricsService.compute(storeId);
  }

  getHistory(options: TimelineOptions = {}): Promise<ObservabilityHistory> {
    return this.timelineService.getHistory(options);
  }

  getAlerts(storeId?: string, limit?: number): Promise<AlertRecord[]> {
    return this.store.listAlerts(storeId === undefined ? { limit } : { storeId, limit });
  }

  getChanges(storeId?: string, limit?: number): Promise<ChangeRecord[]> {
    return this.store.listChanges(storeId === undefined ? { limit } : { storeId, limit });
  }

  getSeoTimeline(options: TimelineOptions = {}): Promise<SeoTimeline> {
    return this.timelineService.getSeoTimeline(options);
  }

  getExecutionTimeline(options: TimelineOptions = {}): Promise<TimelinePoint[]> {
    return this.timelineService.getExecutionTimeline(options);
  }

  getPerformanceTimeline(options: PerformanceTimelineOptions = {}): Promise<PerformanceTimeline> {
    return this.timelineService.getPerformanceTimeline(options);
  }

  getLearningSignals(storeId?: string): Promise<LearningSignal[]> {
    return this.learningSignalService.compute(storeId === undefined ? {} : { storeId });
  }

  /** Snapshot of the optional metrics registry, or null when none is wired. */
  metricsSnapshot(): MetricSnapshot | null {
    return this.registry?.snapshot() ?? null;
  }

  async reset(): Promise<void> {
    await this.store.reset();
    this.registry?.reset();
  }

  // ---------------------------------------------------------------------
  // Recording internals.
  // ---------------------------------------------------------------------

  private async applyEvent(event: ObservabilityEvent, at: string): Promise<void> {
    switch (event.type) {
      case 'execution.queued':
        return this.applyQueued(event, at);
      case 'execution.started':
        return this.transition(event, 'EXECUTING', at);
      case 'execution.completed':
        return this.transition(event, 'COMPLETED', at);
      case 'execution.failed':
        return this.transition(event, 'FAILED', at, { error: event.error });
      case 'execution.cancelled':
        return this.transition(event, 'CANCELLED', at, { reason: event.reason });
      case 'execution.rollback_started':
        return this.transition(event, 'EXECUTING', at, { rollbackId: event.rollbackId });
      case 'execution.rollback_completed':
        return this.transition(event, 'ROLLED_BACK', at, { rollbackId: event.rollbackId });
      case 'execution.rollback_failed':
        return this.annotateRollbackFailure(event);
      case 'execution.publisher_failed':
        return this.transition(event, 'FAILED', at, { error: event.error });
      case 'execution.safety_violation':
        return this.transition(event, 'FAILED', at, { error: event.violation });
      case 'crawl.completed':
        this.registry?.increment('crawl_completed_total', 1);
        return;
      case 'crawl.failed':
        this.registry?.increment('crawl_failed_total', 1);
        return;
      case 'seo.analysis.completed':
        await this.applySeoAnalysis(event, at);
        return;
      case 'validation.failed':
        this.registry?.increment('validation_failed_total', 1);
        return;
    }
  }

  private async applyQueued(event: ExecutionEvent, at: string): Promise<void> {
    const existing = await this.store.findExecution(event.executionId);
    if (existing !== null) return;
    await this.store.upsertExecution({
      executionId: event.executionId,
      storeId: event.storeId,
      ...contextOf(event),
      status: 'QUEUED',
      startedAt: at,
    });
    this.registry?.increment('execution_queued_total', 1);
  }

  /**
   * A failed rollback does not regress a terminal execution state; the error
   * and rollback id are annotated onto the existing record instead (and the
   * alert engine raises a critical alert for the failed rollback).
   */
  private async annotateRollbackFailure(event: Extract<ExecutionEvent, { type: 'execution.rollback_failed' }>): Promise<void> {
    const existing = await this.store.findExecution(event.executionId);
    if (existing !== null) {
      await this.store.upsertExecution({ ...existing, error: event.error, rollbackId: event.rollbackId });
      return;
    }
    await this.store.upsertExecution({
      executionId: event.executionId,
      storeId: event.storeId,
      ...contextOf(event),
      status: 'FAILED',
      error: event.error,
      rollbackId: event.rollbackId,
      startedAt: this.now(),
    });
    this.registry?.increment('execution_failed_total', 1);
  }

  /**
   * Moves an execution toward a new status. Never regresses: terminal states
   * are sticky, `ROLLED_BACK` wins over other terminal states, and duplicate
   * deliveries are no-ops.
   */
  private async transition(
    event: ExecutionEvent,
    next: ExecutionStatus,
    at: string,
    extra: Partial<ExecutionRecord> = {},
  ): Promise<void> {
    const existing = await this.store.findExecution(event.executionId);
    if (existing !== null) {
      const currentRank = STATUS_RANK[existing.status];
      const nextRank = STATUS_RANK[next];
      if (nextRank < currentRank) return;
      if (nextRank === currentRank) return;
    }

    const startedAt = existing?.startedAt ?? at;
    const completedAt = isTerminal(next) ? (existing?.completedAt ?? at) : existing?.completedAt;
    const durationMs =
      event.duration ??
      (isTerminal(next) ? elapsedMs(startedAt, completedAt ?? at) : existing?.durationMs);

    await this.store.upsertExecution({
      ...(existing ?? {}),
      executionId: event.executionId,
      storeId: event.storeId,
      ...contextOf(event),
      status: next,
      startedAt,
      ...(completedAt !== undefined && { completedAt }),
      ...(durationMs !== undefined && { durationMs }),
      ...extra,
    });

    this.registry?.increment(`execution_${next.toLowerCase()}_total`, 1);
    if (event.duration !== undefined) {
      this.registry?.observe('execution_duration_milliseconds', event.duration);
    }
  }

  private async applySeoAnalysis(event: SeoAnalysisEvent, at: string): Promise<SeoSnapshot> {
    const snapshot: SeoSnapshot = {
      snapshotId: deterministicUuid(
        `seo:${event.storeId}:${event.crawlJobId ?? ''}:${event.executionId ?? ''}:${event.analyzedAt ?? at}`,
      ),
      storeId: event.storeId,
      crawlJobId: event.crawlJobId,
      executionId: event.executionId,
      capturedAt: event.analyzedAt ?? at,
      reference: event.reference,
      overallScore: event.overallScore,
      scores: event.scores,
      recommendationsCount: event.recommendationsCount,
      issues: event.issues,
    };
    await this.store.appendSnapshot(snapshot);
    this.registry?.setGauge(`seo_overall_score_${event.storeId}`, event.overallScore);
    return snapshot;
  }
}

/** Maps an execution engine status to the observability status vocabulary. */
export function mapEngineStatus(status: string): ExecutionStatus {
  switch (status) {
    case 'COMPLETED':
      return 'COMPLETED';
    case 'FAILED':
    case 'REJECTED':
      return 'FAILED';
    case 'CANCELLED':
      return 'CANCELLED';
    case 'ROLLED_BACK':
      return 'ROLLED_BACK';
    case 'EXECUTING':
    case 'VALIDATING':
      return 'EXECUTING';
    case 'QUEUED':
      return 'QUEUED';
    default:
      return 'QUEUED';
  }
}
