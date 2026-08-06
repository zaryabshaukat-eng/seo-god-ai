import { describe, expect, it } from 'vitest';
import { MetricsRegistry } from '@seogod/monitoring';
import { renderedBytes, ReportMetrics } from './metrics.js';
import type { Report } from './types.js';

function report(kind: Report['kind'] = 'executive-dashboard', storeId = 's1'): Report {
  return {
    id: 'rep_1',
    templateId: kind,
    name: kind,
    kind,
    storeId,
    period: { startDate: '2024-01-01', endDate: '2024-01-07' },
    generatedAt: '2024-01-08T00:00:00.000Z',
    sections: [],
    kpis: [],
    trends: [],
    alerts: null,
  };
}

describe('ReportMetrics', () => {
  it('records generated, rendered, timing, bytes and failures', () => {
    const registry = new MetricsRegistry();
    const metrics = new ReportMetrics(registry);
    metrics.reportGenerated(report());
    metrics.reportGenerated({ ...report('seo'), storeId: undefined });
    metrics.reportRendered('pdf');
    metrics.reportRenderTime('pdf', 12.5);
    metrics.reportRenderedBytes('pdf', 2048);
    metrics.reportFailed('kpi');

    const snapshot = registry.snapshot();
    expect(snapshot.counters['report_generated_executive-dashboard_s1']).toBe(1);
    expect(snapshot.counters['report_generated_seo_unknown']).toBe(1);
    expect(snapshot.counters['report_rendered_pdf']).toBe(1);
    expect(snapshot.counters['report_failed_kpi']).toBe(1);
    expect(snapshot.histograms['report_render_pdf']?.avg).toBeCloseTo(12.5);
    expect(snapshot.histograms['report_bytes_pdf']?.sum).toBe(2048);
  });

  it('no-ops without a registry', () => {
    const metrics = new ReportMetrics();
    expect(() => {
      metrics.reportGenerated(report());
      metrics.reportRendered('csv');
      metrics.reportRenderTime('csv', 1);
      metrics.reportRenderedBytes('csv', 1);
      metrics.reportFailed('seo');
    }).not.toThrow();
  });
});

describe('renderedBytes', () => {
  it('measures strings and binary buffers', () => {
    expect(renderedBytes('abc')).toBe(3);
    expect(renderedBytes(new Uint8Array([1, 2, 3, 4]))).toBe(4);
    expect(renderedBytes(null)).toBe(0);
    expect(renderedBytes(undefined)).toBe(0);
    expect(renderedBytes({})).toBe(0);
  });
});
