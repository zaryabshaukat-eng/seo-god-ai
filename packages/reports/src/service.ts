/**
 * `ReportEngineService`: the application-facing facade that wires the engine,
 * metrics, KPI tracking and the scheduler together. It is the single entry
 * point used by the API layer and scheduled jobs.
 */

import type { MetricsRegistry } from '@seogod/monitoring';
import { ReportEngine, type GenerateReportRequest } from './engine.js';
import { KpiTracker } from './kpis.js';
import { renderedBytes, ReportMetrics } from './metrics.js';
import {
  ReportScheduler,
  type ScheduledReportRecord,
} from './scheduler.js';
import { TEMPLATES } from './templates.js';
import type { Report, ReportFormat, ReportSources } from './types.js';
import { periodFor, type ReportPeriod, type ReportPeriodOptions } from './utils.js';

export interface ReportEngineServiceOptions {
  sources: ReportSources;
  registry?: MetricsRegistry;
  scheduler?: ReportScheduler;
  kpiTracker?: KpiTracker;
  /** Invoked after a scheduled report is generated (delivery, persistence, …). */
  onScheduleRun?: (definition: ScheduledReportRecord, report: Report) => Promise<void>;
}

export interface ScheduleRunRequest {
  storeId?: string;
  kind?: Report['kind'];
  format?: ReportFormat;
  period?: ReportPeriod;
  periodOptions?: ReportPeriodOptions;
}

export class ReportEngineService {
  readonly engine: ReportEngine;
  readonly metrics: ReportMetrics;
  readonly scheduler: ReportScheduler;
  readonly kpiTracker: KpiTracker;
  private readonly onScheduleRun: ((definition: ScheduledReportRecord, report: Report) => Promise<void>) | null;

  constructor(options: ReportEngineServiceOptions) {
    this.engine = new ReportEngine(options.sources);
    this.metrics = new ReportMetrics(options.registry);
    this.kpiTracker = options.kpiTracker ?? new KpiTracker();
    this.onScheduleRun = options.onScheduleRun ?? null;
    this.scheduler =
      options.scheduler ??
      new ReportScheduler([], (definition, now) => this.runScheduledReport(definition, now));
  }

  /** Generates a report through the engine, recording success/failure metrics. */
  async generate(request: GenerateReportRequest): Promise<Report> {
    try {
      const report = await this.engine.generate(request);
      this.metrics.reportGenerated(report);
      return report;
    } catch (error) {
      const kind =
        request.kind !== undefined && Object.prototype.hasOwnProperty.call(TEMPLATES, request.kind)
          ? request.kind
          : 'executive-dashboard';
      this.metrics.reportFailed(kind);
      throw error;
    }
  }

  /** Renders a report and records format, duration and byte-size metrics. */
  async render(report: Report, formats: readonly ReportFormat[]): Promise<void> {
    const startedAt = Date.now();
    await this.engine.render(report, formats);
    const duration = Date.now() - startedAt;
    for (const format of formats) {
      this.metrics.reportRendered(format);
      this.metrics.reportRenderTime(format, duration);
      this.metrics.reportRenderedBytes(format, renderedBytes(report.rendered?.[format]));
    }
  }

  /** Generates + renders + records a KPI snapshot for historical tracking. */
  async generateAndTrack(request: GenerateReportRequest & { trackKpis?: boolean }): Promise<Report> {
    const report = await this.generate(request);
    if (request.trackKpis !== false) {
      await this.kpiTracker.record(report.storeId, report.period, report.kpis);
    }
    return report;
  }

  /** Runs every due scheduled report and returns the definitions that fired. */
  async runScheduled(now: Date = new Date()): Promise<ScheduledReportRecord[]> {
    return this.scheduler.runDue(now);
  }

  /** Default handler for scheduled definitions: generates the configured format. */
  private async runScheduledReport(definition: ScheduledReportRecord, now: Date): Promise<void> {
    const generatedAt = now.toISOString();
    const period = periodFor({ endDate: generatedAt.slice(0, 10) }, () => now);
    const report = await this.generateAndTrack({
      storeId: definition.storeId,
      kind: definition.kind,
      period,
      generatedAt,
      renderers: [definition.format],
      trackKpis: false,
    });
    if (this.onScheduleRun !== null) {
      await this.onScheduleRun(definition, report);
    }
  }
}
