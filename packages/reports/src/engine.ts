/**
 * Report engine: orchestrates source collection, template section building,
 * KPI/trend/alert aggregation and rendering into a `Report`. Pure of any
 * transport or persistence concerns; `ReportEngineService` layers on metrics
 * and scheduling.
 */

import { aggregateAlerts, buildTrendSeries } from './aggregation.js';
import { renderReportToCsv } from './csv.js';
import { ReportRenderError, ReportValidationError } from './errors.js';
import { aggregateKpis } from './kpis.js';
import { renderReportToPdf } from './pdf-renderer.js';
import { collectSourceData } from './sources.js';
import { getTemplate } from './templates.js';
import type {
  Report,
  ReportFormat,
  ReportKind,
  ReportSources,
} from './types.js';
import {
  daysIn,
  newReportId,
  periodFor,
  previousPeriod as previousPeriodOf,
  type ReportPeriod,
  type ReportPeriodOptions,
} from './utils.js';

export interface GenerateReportRequest {
  /** Template id (defaults to `kind`). */
  templateId?: string;
  name?: string;
  kind?: ReportKind;
  storeId?: string;
  /** Explicit period; takes precedence over `periodOptions`/`date`/`days`. */
  period?: ReportPeriod;
  periodOptions?: ReportPeriodOptions;
  /** "As of" date (YYYY-MM-DD); used as the period end when no period given. */
  date?: string;
  days?: number;
  /** Compute the previous-period KPI deltas automatically. */
  compare?: boolean;
  previousPeriod?: ReportPeriod;
  kpiKeys?: string[];
  /** Render formats to attach to `report.rendered` after generation. */
  renderers?: ReportFormat[];
  id?: string;
  generatedAt?: string;
}

export class ReportEngine {
  constructor(private readonly sources: ReportSources) {}

  /** Generates a report, optionally rendering JSON/CSV/PDF into `rendered`. */
  async generate(request: GenerateReportRequest): Promise<Report> {
    const kind = request.kind ?? 'executive-dashboard';
    const template = getTemplate(kind);
    const now = () => new Date(request.generatedAt ?? request.date ?? Date.now());
    const period =
      request.period ??
      periodFor(
        {
          startDate: request.periodOptions?.startDate,
          endDate: request.periodOptions?.endDate ?? request.date,
          days: request.periodOptions?.days ?? request.days,
        },
        now,
      );
    if (daysIn(period) < 1) {
      throw new ReportValidationError(
        `Invalid report period ${period.startDate} \u2192 ${period.endDate}: end is before start.`,
      );
    }
    const previousPeriod =
      request.previousPeriod ?? (request.compare ? previousPeriodOf(period) : undefined);

    const data = await collectSourceData(this.sources, period, {
      storeId: request.storeId,
      previousPeriod,
    });

    const trends = buildTrendSeries(data, period);
    const alerts = aggregateAlerts(data.alerts, period);

    const report: Report = {
      id: request.id ?? newReportId('rpt'),
      templateId: request.templateId ?? kind,
      name: request.name ?? template.title,
      kind,
      storeId: request.storeId,
      period,
      previousPeriod,
      generatedAt: request.generatedAt ?? new Date().toISOString(),
      sections: template.buildSections(data, { previousPeriod, trends }),
      kpis: aggregateKpis(data, period, previousPeriod, request.kpiKeys),
      trends,
      alerts,
    };

    if (request.renderers !== undefined && request.renderers.length > 0) {
      await this.render(report, request.renderers);
    }
    return report;
  }

  /** Renders a generated report into `report.rendered` for the given formats. */
  async render(report: Report, formats: readonly ReportFormat[]): Promise<void> {
    const rendered: Partial<Record<ReportFormat, unknown>> = {};
    try {
      if (formats.includes('json')) rendered.json = report;
      if (formats.includes('csv')) rendered.csv = renderReportToCsv(report);
      if (formats.includes('pdf')) rendered.pdf = renderReportToPdf(report);
    } catch (error) {
      throw new ReportRenderError(
        `Failed to render report '${report.id}': ${error instanceof Error ? error.message : String(error)}`,
        { reportId: report.id },
        error,
      );
    }
    report.rendered = rendered;
  }
}
