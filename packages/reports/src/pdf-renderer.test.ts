import { describe, expect, it } from 'vitest';
import { renderReportToPdf } from './pdf-renderer.js';
import type { Report } from './types.js';

function makeReport(overrides: Partial<Report> = {}): Report {
  return {
    id: 'rep_1',
    templateId: 'executive-dashboard',
    name: 'Executive Dashboard',
    kind: 'executive-dashboard',
    storeId: 'store-a',
    period: { startDate: '2024-01-01', endDate: '2024-01-07' },
    previousPeriod: { startDate: '2023-12-25', endDate: '2023-12-31' },
    generatedAt: '2024-01-08T00:00:00.000Z',
    sections: [],
    kpis: [],
    trends: [],
    alerts: null,
    ...overrides,
  };
}

const points = Array.from({ length: 10 }, (_, index) => ({
  date: `2024-01-${String(index + 1).padStart(2, '0')}`,
  value: index + 1,
}));

describe('renderReportToPdf', () => {
  it('renders a full report with all layout primitives', () => {
    const report = makeReport({
      sections: [
        {
          kind: 'summary',
          title: 'Summary',
          description: 'A short overview paragraph for the report.',
          metrics: [
            { label: 'Period', value: '2024-01-01 → 2024-01-07' },
            { label: 'SEO Score', value: 88, delta: 2.5 },
            { label: 'Clicks', value: 15, delta: -3 },
          ],
        },
        {
          kind: 'trends',
          title: 'Clicks',
          unit: 'clicks',
          points,
        },
        {
          kind: 'trends',
          title: 'Sessions',
          points,
        },
        {
          kind: 'execution',
          title: 'Execution',
          header: ['Rule', 'Attempts', 'Success Rate'],
          rows: [
            ['title-optimization', 12, '58.3'],
            ['meta-description', 8, '75.0'],
          ],
        },
        {
          kind: 'learning',
          title: 'Learning',
          body: ['line one', 'line two'],
        },
      ],
    });
    const bytes = renderReportToPdf(report);
    const text = new TextDecoder().decode(bytes);
    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text).toContain('BT /F2 18 Tf'); // title (bold 18)
    expect(text).toContain('/BaseFont /Helvetica');
    expect(text).toContain('re f'); // shaded table rows + bars + header
    expect(text).toContain('re B'); // table header fill
  });

  it('renders without a store id or previous period', () => {
    const report = makeReport({ storeId: undefined, previousPeriod: undefined });
    const bytes = renderReportToPdf(report, { showGeneratedAt: false });
    expect(new TextDecoder().decode(bytes).startsWith('%PDF-1.4')).toBe(true);
  });

  it('uses custom title and subtitle', () => {
    const report = makeReport();
    const bytes = renderReportToPdf(report, {
      title: 'Custom Title',
      subtitle: 'Custom subtitle',
      showGeneratedAt: false,
    });
    expect(new TextDecoder().decode(bytes)).toContain('/BaseFont /Helvetica-Bold');
  });

  it('wraps long paragraphs across pages', () => {
    const longBody = 'word '.repeat(600);
    const report = makeReport({
      storeId: undefined,
      sections: [{ kind: 'learning', title: 'Learning', body: [longBody] }],
    });
    const bytes = renderReportToPdf(report);
    expect(bytes.length).toBeGreaterThan(1000);
  });

  it('renders bars with many points and skips value labels', () => {
    const manyPoints = Array.from({ length: 15 }, (_, index) => ({
      date: `2024-01-${String(index + 1).padStart(2, '0')}`,
      value: index + 1,
    }));
    const report = makeReport({
      sections: [{ kind: 'trends', title: 'Clicks', unit: '', points: manyPoints }],
    });
    expect(new TextDecoder().decode(renderReportToPdf(report)).startsWith('%PDF-1.4')).toBe(true);
  });

  it('renders an empty trend section as a no-data paragraph', () => {
    const report = makeReport({
      sections: [{ kind: 'trends', title: 'Clicks', unit: '', points: [] }],
    });
    expect(new TextDecoder().decode(renderReportToPdf(report)).startsWith('%PDF-1.4')).toBe(true);
  });

  it('renders very wide tables by truncating long cells', () => {
    const header = Array.from({ length: 40 }, (_, index) => `Col${index}`);
    const report = makeReport({
      sections: [
        {
          kind: 'execution',
          title: 'Execution',
          header,
          rows: [
            ['x'.repeat(120), ...header.slice(1).map((_, index) => `cell${index}`)],
            ['short'],
          ],
        },
      ],
    });
    expect(new TextDecoder().decode(renderReportToPdf(report)).startsWith('%PDF-1.4')).toBe(true);
  });

  it('renders medium tables by truncating long cells with ellipses', () => {
    const report = makeReport({
      sections: [
        {
          kind: 'execution',
          title: 'Execution',
          header: ['Rule', 'Attempts', 'Success Rate'],
          rows: [['a'.repeat(200), 12, '58.3']],
        },
      ],
    });
    expect(new TextDecoder().decode(renderReportToPdf(report)).startsWith('%PDF-1.4')).toBe(true);
  });

  it('renders a section with only a body', () => {
    const report = makeReport({
      storeId: undefined,
      previousPeriod: undefined,
      sections: [{ kind: 'alerts', title: 'Alerts', body: ['nothing to report'] }],
    });
    expect(new TextDecoder().decode(renderReportToPdf(report)).startsWith('%PDF-1.4')).toBe(true);
  });
});
