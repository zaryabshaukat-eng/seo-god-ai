import { describe, expect, it, vi } from 'vitest';
import { MetricsRegistry } from '@seogod/monitoring';
import { ReportEngineService } from './service.js';
import { ReportScheduler } from './scheduler.js';
import { KpiTracker } from './kpis.js';
import type { Report, ReportSources } from './types.js';

const emptySources: ReportSources = {
  observability: {
    listExecutions: async () => [],
    listSnapshots: async () => [],
    listAlerts: async () => [],
    listChanges: async () => [],
  },
};

const period = { startDate: '2024-01-01', endDate: '2024-01-07' };

describe('ReportEngineService', () => {
  it('generates reports and records metrics', async () => {
    const registry = new MetricsRegistry();
    const service = new ReportEngineService({ sources: emptySources, registry });
    const report = await service.generate({ period, storeId: 's1' });
    expect(report.kind).toBe('executive-dashboard');
    expect(registry.snapshot().counters['report_generated_executive-dashboard_s1']).toBe(1);
  });

  it('records failures and rethrows', async () => {
    const registry = new MetricsRegistry();
    const service = new ReportEngineService({ sources: emptySources, registry });
    await expect(service.generate({ kind: 'bogus' as never })).rejects.toThrow();
    expect(registry.snapshot().counters['report_failed_executive-dashboard']).toBe(1);
  });

  it('renders and records format metrics', async () => {
    const registry = new MetricsRegistry();
    const service = new ReportEngineService({ sources: emptySources, registry });
    const report = await service.generate({ period });
    await service.render(report, ['csv', 'pdf']);
    expect(typeof report.rendered?.csv).toBe('string');
    const snapshot = registry.snapshot();
    expect(snapshot.counters['report_rendered_csv']).toBe(1);
    expect(snapshot.counters['report_rendered_pdf']).toBe(1);
    expect(snapshot.histograms['report_render_csv']?.count).toBe(1);
    expect(snapshot.histograms['report_bytes_csv']?.sum).toBeGreaterThan(0);
  });

  it('tracks KPI snapshots on generateAndTrack', async () => {
    const tracker = new KpiTracker();
    const service = new ReportEngineService({ sources: emptySources, kpiTracker: tracker });
    const report = await service.generateAndTrack({ period, storeId: 's1' });
    expect(report.kpis).toHaveLength(12);
    const latest = await tracker.latest('s1');
    expect(latest?.snapshots).toHaveLength(12);
    expect(latest?.storeId).toBe('s1');

    const untracked = await service.generateAndTrack({ period, trackKpis: false });
    expect(untracked.kpis).toHaveLength(12);
    expect(await tracker.latest('s1')).not.toBeNull();
  });

  it('runs scheduled reports through the default handler', async () => {
    const registry = new MetricsRegistry();
    const onScheduleRun = vi.fn(async () => undefined);
    const service = new ReportEngineService({ sources: emptySources, registry, onScheduleRun });
    service.scheduler.add({
      id: 's-1',
      kind: 'executive-dashboard',
      cron: '30 10 * * *',
      format: 'csv',
      recipients: ['ops@example.com'],
      enabled: true,
    });
    const now = new Date('2024-01-08T10:30:00.000Z');
    const due = await service.runScheduled(now);
    expect(due).toHaveLength(1);
    expect(due[0]?.lastRun).toBe(now.toISOString());
    expect(onScheduleRun).toHaveBeenCalledTimes(1);
    const [, report] = onScheduleRun.mock.calls[0] as unknown as [never, Report];
    expect(report.period.endDate).toBe('2024-01-08');
    expect(report.rendered?.csv).toBeTypeOf('string');
    expect(registry.snapshot().counters['report_generated_executive-dashboard_unknown']).toBe(1);
  });

  it('uses an injected scheduler', async () => {
    const handler = vi.fn(async () => undefined);
    const scheduler = new ReportScheduler([], handler);
    const service = new ReportEngineService({ sources: emptySources, scheduler });
    service.scheduler.add({
      id: 's-2',
      kind: 'kpi',
      cron: '* * * * *',
      format: 'json',
      recipients: [],
      enabled: true,
    });
    await service.runScheduled(new Date('2024-01-08T10:30:00.000Z'));
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('propagates scheduled report failures', async () => {
    const sources: ReportSources = {
      observability: {
        listExecutions: async () => {
          throw new Error('store down');
        },
        listSnapshots: async () => [],
        listAlerts: async () => [],
        listChanges: async () => [],
      },
    };
    const service = new ReportEngineService({ sources });
    service.scheduler.add({
      id: 's-3',
      kind: 'alerts',
      cron: '* * * * *',
      format: 'pdf',
      recipients: [],
      enabled: true,
    });
    await expect(service.runScheduled(new Date('2024-01-08T10:30:00.000Z'))).rejects.toThrow(/store down/);
  });
});
