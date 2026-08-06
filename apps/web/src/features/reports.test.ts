import { describe, expect, it } from 'vitest';
import { renderToString } from '../vdom.js';
import type { Report, ReportDraft } from '../types.js';
import { REPORT_KIND_LABELS, createReportsApi, kpiListEl, renderReportDetailPage, renderReportsPage, reportStatusTone, validateReportDraft } from './reports.js';

const REPORT: Report = {
  id: 'rep-1',
  title: 'March SEO health',
  kind: 'seo-health',
  status: 'ready',
  storeId: 'store-1',
  createdAt: 1700000000000,
  sections: [{ id: 's1', title: 'Overview', summary: 'Steady', kpis: [{ label: 'Score', value: '74', changePct: 2 }] }],
};

const DRAFT: ReportDraft = { kind: 'seo-health', storeId: 'store-1', days: 30, compare: false };

describe('REPORT_KIND_LABELS', () => {
  it('labels every report kind', () => {
    expect(Object.keys(REPORT_KIND_LABELS).sort()).toEqual(['crawl', 'execution', 'rankings', 'seo-health', 'traffic']);
  });
});

describe('reportStatusTone', () => {
  it('maps statuses', () => {
    expect(reportStatusTone('ready')).toBe('success');
    expect(reportStatusTone('generating')).toBe('info');
    expect(reportStatusTone('failed')).toBe('danger');
    expect(reportStatusTone('archived' as never)).toBe('neutral');
  });
});

describe('validateReportDraft', () => {
  it('accepts a valid draft', () => {
    expect(validateReportDraft(DRAFT)).toEqual({});
  });

  it('rejects an unknown kind', () => {
    expect(validateReportDraft({ ...DRAFT, kind: 'nope' as ReportDraft['kind'] }).kind).toBe('Choose a report type.');
  });

  it('rejects a missing store id', () => {
    expect(validateReportDraft({ ...DRAFT, storeId: ' ' }).storeId).toBe('Store ID is required.');
  });

  it('rejects days outside 1-365', () => {
    expect(validateReportDraft({ ...DRAFT, days: 0 }).days).toBe('Days must be between 1 and 365.');
    expect(validateReportDraft({ ...DRAFT, days: 1.5 }).days).toBe('Days must be between 1 and 365.');
    expect(validateReportDraft({ ...DRAFT, days: 366 }).days).toBe('Days must be between 1 and 365.');
  });
});

describe('renderReportsPage', () => {
  it('renders the table and generation form for writers', () => {
    const html = renderToString(
      renderReportsPage({ reports: [REPORT], canWrite: true, draft: DRAFT, draftErrors: { days: 'Days must be between 1 and 365.' }, error: 'Failed' }),
    );
    expect(html).toContain('id="reports-table"');
    expect(html).toContain('id="generate-report-form"');
    expect(html).toContain('>March SEO health</td>');
    expect(html).toContain('aria-invalid');
  });

  it('hides the form for readers', () => {
    const html = renderToString(renderReportsPage({ reports: [], canWrite: false, draft: DRAFT, draftErrors: {} }));
    expect(html).not.toContain('generate-report-form');
    expect(html).toContain('No reports yet.');
  });

  it('falls back to the raw kind for unknown report kinds', () => {
    const html = renderToString(
      renderReportsPage({ reports: [{ ...REPORT, kind: 'custom' as never }], canWrite: false, draft: DRAFT, draftErrors: {} }),
    );
    expect(html).toContain('>custom</span>');
  });
});

describe('kpiListEl', () => {
  it('renders KPIs with up/down changes', () => {
    const html = renderToString(kpiListEl([{ label: 'Score', value: '74', changePct: 2 }, { label: 'Traffic', value: '100', changePct: -1 }]));
    expect(html).toContain('kpi-change--up');
    expect(html).toContain('kpi-change--down');
    expect(html).toContain('>74</span>');
  });

  it('renders KPIs without a change', () => {
    const html = renderToString(kpiListEl([{ label: 'Score', value: '74' }]));
    expect(html).not.toContain('kpi-change');
  });
});

describe('renderReportDetailPage', () => {
  it('renders sections and status', () => {
    const html = renderToString(renderReportDetailPage(REPORT));
    expect(html).toContain('March SEO health');
    expect(html).toContain('badge--success');
    expect(html).toContain('report-kpis');
  });

  it('renders a placeholder without sections', () => {
    const html = renderToString(renderReportDetailPage({ ...REPORT, sections: [] }));
    expect(html).toContain('Report has no sections yet.');
  });
});

describe('createReportsApi', () => {
  it('wraps report endpoints onto the client', async () => {
    const calls: Array<{ method: string; url: string; body: unknown }> = [];
    const api = {
      request: async <T>(method: string, url: string, body: unknown): Promise<T> => {
        calls.push({ method, url, body });
        return { ok: true } as T;
      },
    } as never;
    const reportsApi = createReportsApi(api);
    await reportsApi.list();
    await reportsApi.generate(DRAFT);
    await reportsApi.get('rep-1');
    expect(calls).toEqual([
      { method: 'GET', url: '/api/v1/reports', body: undefined },
      { method: 'POST', url: '/api/v1/reports', body: DRAFT },
      { method: 'GET', url: '/api/v1/reports/rep-1', body: undefined },
    ]);
  });
});
