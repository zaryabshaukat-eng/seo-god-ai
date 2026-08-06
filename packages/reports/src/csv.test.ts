import { describe, expect, it } from 'vitest';
import { escapeCsvField, renderReportToCsv, searchRowsToCsv, toCsvRows, trafficRowsToCsv } from './csv.js';
import type { Report } from './types.js';

describe('escapeCsvField', () => {
  it('leaves plain fields untouched', () => {
    expect(escapeCsvField('plain')).toBe('plain');
    expect(escapeCsvField(42)).toBe('42');
  });
  it('quotes fields with commas, quotes or newlines', () => {
    expect(escapeCsvField('a,b')).toBe('"a,b"');
    expect(escapeCsvField('say "hi"')).toBe('"say ""hi"""');
    expect(escapeCsvField('line1\nline2')).toBe('"line1\nline2"');
    expect(escapeCsvField('carriage\rreturn')).toBe('"carriage\rreturn"');
  });
});

describe('toCsvRows', () => {
  it('serializes header and rows', () => {
    expect(toCsvRows(['a', 'b'], [['1', 2]])).toBe('a,b\n1,2');
  });
});

function baseReport(): Report {
  return {
    id: 'rep_1',
    templateId: 'executive-dashboard',
    name: 'Executive Dashboard',
    kind: 'executive-dashboard',
    storeId: 'store-a',
    period: { startDate: '2024-01-01', endDate: '2024-01-07' },
    generatedAt: '2024-01-08T00:00:00.000Z',
    sections: [],
    kpis: [],
    trends: [],
    alerts: null,
  };
}

describe('renderReportToCsv', () => {
  it('renders the metadata block', () => {
    const csv = renderReportToCsv(baseReport());
    expect(csv).toContain('report_id,name,template,kind,store_id,start,end,generated');
    expect(csv).toContain('rep_1,Executive Dashboard,executive-dashboard,executive-dashboard,store-a,2024-01-01,2024-01-07,2024-01-08T00:00:00.000Z');
  });

  it('renders KPI rows', () => {
    const report = baseReport();
    report.kpis = [
      {
        key: 'clicks',
        label: 'Clicks',
        value: 100,
        previousValue: 80,
        change: 20,
        changePercent: 25,
        higherIsBetter: true,
        status: 'improved',
      },
      {
        key: 'position',
        label: 'Avg Position',
        value: null,
        previousValue: null,
        change: null,
        changePercent: null,
        higherIsBetter: false,
        status: 'no-data',
      },
    ];
    const csv = renderReportToCsv(report);
    expect(csv).toContain('KPI,Current,Previous,Change,Change %,Status');
    expect(csv).toContain('Clicks,100,80,20,25,improved');
    expect(csv).toContain('Avg Position,,,,,no-data');
  });

  it('renders section points, tables, metrics and body', () => {
    const report = baseReport();
    report.sections = [
      { kind: 'trends', title: 'Clicks', unit: '', points: [{ date: '2024-01-01', value: 5 }, { date: '2024-01-02', value: 9 }] },
      { kind: 'execution', title: 'Execution', header: ['Rule', 'Att'], rows: [['r1', 3]] },
      { kind: 'summary', title: 'Summary', metrics: [{ label: 'Score', value: 88, delta: 2 }] },
      { kind: 'learning', title: 'Learning', body: ['line one'] },
      { kind: 'alerts', title: 'Empty', metrics: [] },
    ];
    const csv = renderReportToCsv(report);
    expect(csv).toContain('# Clicks');
    expect(csv).toContain('Date,Value');
    expect(csv).toContain('2024-01-02,9');
    expect(csv).toContain('# Execution');
    expect(csv).toContain('Rule,Att');
    expect(csv).toContain('r1,3');
    expect(csv).toContain('# Summary');
    expect(csv).toContain('Metric,Value,Delta');
    expect(csv).toContain('Score,88,2');
    expect(csv).toContain('# Learning');
    expect(csv).toContain('Line');
    expect(csv).toContain('line one');
  });
});

describe('searchRowsToCsv', () => {
  it('renders search rows', () => {
    const csv = searchRowsToCsv([
      { date: '2024-01-01', clicks: 1, impressions: 10, ctr: 0.1, position: 3.5 },
    ]);
    expect(csv).toBe('Date,Clicks,Impressions,CTR,Position\n2024-01-01,1,10,0.1,3.5');
  });
});

describe('trafficRowsToCsv', () => {
  it('renders traffic rows with date part', () => {
    const csv = trafficRowsToCsv([
      { date: '2024-01-01T00:00:00Z', sessions: 5, users: 3, pageviews: 20 },
    ]);
    expect(csv).toBe('Date,Sessions,Users,Page Views\n2024-01-01,5,3,20');
  });
});
