import { describe, expect, it, vi } from 'vitest';
import { ReportEngine } from './engine.js';
import { ReportValidationError } from './errors.js';
import * as pdfRenderer from './pdf-renderer.js';
import type { ReportSources } from './types.js';

const emptySources: ReportSources = {
  observability: {
    listExecutions: async () => [],
    listSnapshots: async () => [],
    listAlerts: async () => [],
    listChanges: async () => [],
  },
};

const withDataSources: ReportSources = {
  observability: {
    listExecutions: async () => [
      { executionId: 'e1', storeId: 's1', status: 'COMPLETED', startedAt: '2024-01-02T10:00:00Z', durationMs: 100, operation: 'title-optimization' },
    ],
    listSnapshots: async () => [
      { snapshotId: 's1', storeId: 's1', capturedAt: '2024-01-02T10:00:00Z', overallScore: 88 },
    ],
    listAlerts: async () => [
      { alertId: 'a1', type: 'crawl', severity: 'warning', message: 'slow', triggeredAt: '2024-01-02T10:00:00Z', context: {} },
    ],
    listChanges: async () => [
      { changeId: 'c1', kind: 'apply', executionId: 'e1', storeId: 's1', entityId: 'p1', appliedAt: '2024-01-02T11:00:00Z', changedFields: ['title'] },
    ],
  },
};

const period = { startDate: '2024-01-01', endDate: '2024-01-07' };

describe('ReportEngine', () => {
  it('generates an executive dashboard with defaults', async () => {
    const engine = new ReportEngine(emptySources);
    const report = await engine.generate({ period, storeId: 's1', id: 'rep-x', generatedAt: '2024-01-08T00:00:00.000Z' });
    expect(report.id).toBe('rep-x');
    expect(report.kind).toBe('executive-dashboard');
    expect(report.templateId).toBe('executive-dashboard');
    expect(report.name).toBe('Executive Dashboard');
    expect(report.storeId).toBe('s1');
    expect(report.period).toEqual(period);
    expect(report.generatedAt).toBe('2024-01-08T00:00:00.000Z');
    expect(report.sections.length).toBeGreaterThan(0);
    expect(report.kpis).toHaveLength(12);
    expect(report.trends).toEqual([]);
    expect(report.alerts).toEqual({
      total: 0,
      critical: 0,
      warning: 0,
      info: 0,
      byType: {},
      items: [],
    });
  });

  it('honors explicit name and template overrides', async () => {
    const engine = new ReportEngine(emptySources);
    const report = await engine.generate({
      period,
      name: 'Weekly Board',
      templateId: 'weekly-board',
      kind: 'seo',
    });
    expect(report.name).toBe('Weekly Board');
    expect(report.templateId).toBe('weekly-board');
    expect(report.kind).toBe('seo');
  });

  it('resolves the period from a date and days', async () => {
    const engine = new ReportEngine(emptySources);
    const report = await engine.generate({ date: '2024-01-10', days: 7 });
    expect(report.period).toEqual({ startDate: '2024-01-04', endDate: '2024-01-10' });
  });

  it('resolves the period from periodOptions', async () => {
    const engine = new ReportEngine(emptySources);
    const report = await engine.generate({ periodOptions: { startDate: '2024-02-01', endDate: '2024-02-10', days: 5 } });
    expect(report.period).toEqual({ startDate: '2024-02-01', endDate: '2024-02-10' });
  });

  it('computes a previous period when compare is requested', async () => {
    const engine = new ReportEngine(emptySources);
    const report = await engine.generate({ period: { startDate: '2024-01-10', endDate: '2024-01-20' }, compare: true });
    expect(report.previousPeriod).toEqual({ startDate: '2023-12-30', endDate: '2024-01-09' });
  });

  it('rejects an inverted period', async () => {
    const engine = new ReportEngine(emptySources);
    await expect(
      engine.generate({ period: { startDate: '2024-01-20', endDate: '2024-01-10' } }),
    ).rejects.toThrow(ReportValidationError);
  });

  it('rejects an unknown template kind', async () => {
    const engine = new ReportEngine(emptySources);
    await expect(engine.generate({ kind: 'bogus' as never })).rejects.toThrow(ReportValidationError);
  });

  it('filters KPIs by key', async () => {
    const engine = new ReportEngine(emptySources);
    const report = await engine.generate({ period, kpiKeys: ['clicks', 'position'] });
    expect(report.kpis.map((kpi) => kpi.key)).toEqual(['clicks', 'position']);
  });

  it('builds trends and sections from source data', async () => {
    const engine = new ReportEngine(withDataSources);
    const report = await engine.generate({ period, storeId: 's1' });
    expect(report.trends.map((series) => series.key)).toContain('seo_score');
    expect(report.trends.map((series) => series.key)).toContain('executions');
    expect(report.alerts?.total).toBe(1);
    const execution = report.sections.find((section) => section.kind === 'execution');
    expect(execution?.metrics?.find((metric) => metric.label === 'Total')?.value).toBe(1);
  });

  it('renders JSON, CSV and PDF into report.rendered', async () => {
    const engine = new ReportEngine(withDataSources);
    const report = await engine.generate({ period, renderers: ['json', 'csv', 'pdf'] });
    expect(report.rendered?.json).toBe(report);
    expect(typeof report.rendered?.csv).toBe('string');
    expect(report.rendered?.csv).toContain('report_id');
    expect(report.rendered?.pdf).toBeInstanceOf(Uint8Array);
  });

  it('renders standalone formats on demand', async () => {
    const engine = new ReportEngine(withDataSources);
    const report = await engine.generate({ period });
    await engine.render(report, ['csv', 'pdf']);
    expect(typeof report.rendered?.csv).toBe('string');
    expect(report.rendered?.pdf).toBeInstanceOf(Uint8Array);
  });

  it('wraps renderer failures in a ReportRenderError', async () => {
    const spy = vi.spyOn(pdfRenderer, 'renderReportToPdf').mockImplementation(() => {
      throw new Error('boom');
    });
    try {
      const engine = new ReportEngine(withDataSources);
      const report = await engine.generate({ period });
      await expect(engine.render(report, ['pdf'])).rejects.toThrow('Failed to render report');
    } finally {
      spy.mockRestore();
    }
  });

  it('wraps non-Error renderer failures', async () => {
    const spy = vi.spyOn(pdfRenderer, 'renderReportToPdf').mockImplementation(() => {
      throw 'render boom';
    });
    try {
      const engine = new ReportEngine(withDataSources);
      const report = await engine.generate({ period });
      await expect(engine.render(report, ['pdf'])).rejects.toThrow(/render boom/);
    } finally {
      spy.mockRestore();
    }
  });
});
