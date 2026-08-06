import { describe, expect, it } from 'vitest';
import { aggregateKpis, DEFAULT_KPIS, getKpiDefinitions, KpiTracker } from './kpis.js';
import type { ReportSourceData } from './types.js';

const period = { startDate: '2024-01-08', endDate: '2024-01-14' };
const previousPeriod = { startDate: '2024-01-01', endDate: '2024-01-07' };

function fixture(): ReportSourceData {
  return {
    period,
    executions: [
      { executionId: 'e1', storeId: 's1', status: 'COMPLETED', startedAt: '2024-01-10T10:00:00Z', durationMs: 100 },
      { executionId: 'e2', storeId: 's1', status: 'COMPLETED', startedAt: '2024-01-11T10:00:00Z' },
      { executionId: 'e3', storeId: 's1', status: 'COMPLETED', startedAt: '2024-01-12T10:00:00Z' },
      { executionId: 'e4', storeId: 's1', status: 'FAILED', startedAt: '2024-01-13T10:00:00Z' },
      { executionId: 'e5', storeId: 's1', status: 'COMPLETED', startedAt: '2024-01-03T10:00:00Z' },
      { executionId: 'e6', storeId: 's1', status: 'FAILED', startedAt: '2024-01-04T10:00:00Z' },
      { executionId: 'e7', storeId: 's1', status: 'ROLLED_BACK', startedAt: '2024-01-05T10:00:00Z' },
    ],
    snapshots: [
      { snapshotId: 'sCur', storeId: 's1', capturedAt: '2024-01-10T10:00:00Z', overallScore: 90 },
      { snapshotId: 'sPrev', storeId: 's1', capturedAt: '2024-01-03T10:00:00Z', overallScore: 80 },
    ],
    alerts: [
      { alertId: 'a1', type: 'crawl', severity: 'critical', message: 'm', triggeredAt: '2024-01-10T10:00:00Z', context: {} },
      { alertId: 'a2', type: 'crawl', severity: 'warning', message: 'm', triggeredAt: '2024-01-11T10:00:00Z', context: {} },
      { alertId: 'a3', type: 'links', severity: 'info', message: 'm', triggeredAt: '2024-01-03T10:00:00Z', context: {} },
    ],
    changes: [],
    analysis: { rules: [], summary: { totalOutcomes: 0, rulesAnalyzed: 0, overallSuccessRate: 0.8, overallAverageImpact: 0 } },
    feedback: { total: 0, positive: 0, neutral: 0, negative: 0, netScore: 0 },
    historicalOutcomes: [],
    recommendations: [],
    plans: [],
    search: [
      { date: '2024-01-10', clicks: 10, impressions: 100, ctr: 0.1, position: 3 },
      { date: '2024-01-11', clicks: 5, impressions: 50, ctr: 0.1, position: 5 },
      { date: '2024-01-03', clicks: 20, impressions: 200, ctr: 0.1, position: 2 },
    ],
    traffic: [
      { date: '2024-01-10', sessions: 100, users: 80, pageviews: 300 },
      { date: '2024-01-03', sessions: 50, users: 40, pageviews: 150 },
    ],
  };
}

describe('getKpiDefinitions', () => {
  it('returns all definitions by default', () => {
    expect(getKpiDefinitions()).toHaveLength(DEFAULT_KPIS.length);
    expect(getKpiDefinitions()).not.toBe(DEFAULT_KPIS);
  });
  it('filters by keys and ignores unknown keys', () => {
    const defs = getKpiDefinitions(['clicks', 'position', 'not-a-kpi']);
    expect(defs.map((definition) => definition.key)).toEqual(['clicks', 'position']);
  });
  it('returns all definitions for an empty key list', () => {
    expect(getKpiDefinitions([])).toHaveLength(DEFAULT_KPIS.length);
  });
});

describe('aggregateKpis', () => {
  it('computes deltas against the previous period', () => {
    const kpis = aggregateKpis(fixture(), period, previousPeriod);
    const byKey = Object.fromEntries(kpis.map((kpi) => [kpi.key, kpi]));

    expect(byKey['seo_score']?.value).toBe(90);
    expect(byKey['seo_score']?.previousValue).toBe(80);
    expect(byKey['seo_score']?.change).toBe(10);
    expect(byKey['seo_score']?.changePercent).toBeCloseTo(12.5);
    expect(byKey['seo_score']?.status).toBe('improved');

    expect(byKey['clicks']?.value).toBe(15);
    expect(byKey['clicks']?.change).toBe(-5);
    expect(byKey['clicks']?.status).toBe('declined');

    expect(byKey['impressions']?.value).toBe(150);
    expect(byKey['ctr']?.value).toBeCloseTo(10);
    expect(byKey['ctr']?.status).toBe('neutral');

    expect(byKey['position']?.value).toBeCloseTo(3.67);
    expect(byKey['position']?.status).toBe('declined');

    expect(byKey['sessions']?.value).toBe(100);
    expect(byKey['sessions']?.status).toBe('improved');
    expect(byKey['users']?.value).toBe(80);
    expect(byKey['pageviews']?.value).toBe(300);

    expect(byKey['success_rate']?.value).toBeCloseTo(75);
    expect(byKey['success_rate']?.status).toBe('improved');
    expect(byKey['rollback_rate']?.value).toBeCloseTo(0);
    expect(byKey['rollback_rate']?.status).toBe('improved');

    expect(byKey['alerts']?.value).toBe(2);
    expect(byKey['alerts']?.status).toBe('declined');

    expect(byKey['learning_success_rate']?.value).toBeCloseTo(80);
    expect(byKey['learning_success_rate']?.status).toBe('neutral');
  });

  it('returns null deltas without a previous period', () => {
    const kpis = aggregateKpis(fixture(), period);
    for (const kpi of kpis) {
      expect(kpi.previousValue).toBeNull();
      expect(kpi.change).toBeNull();
      expect(kpi.changePercent).toBeNull();
      expect(kpi.status).toBe('no-data');
    }
  });

  it('respects a key filter', () => {
    const kpis = aggregateKpis(fixture(), period, previousPeriod, ['clicks']);
    expect(kpis).toHaveLength(1);
    expect(kpis[0]?.key).toBe('clicks');
  });

  it('returns null previous values when a KPI cannot be computed', () => {
    const data = fixture();
    data.search = [
      { date: '2024-01-10', clicks: 5, impressions: 50, ctr: 0.1, position: 3 },
      { date: '2024-01-02', clicks: 0, impressions: 0, ctr: 0, position: 0 },
    ];
    const kpis = aggregateKpis(data, period, previousPeriod);
    const byKey = Object.fromEntries(kpis.map((kpi) => [kpi.key, kpi]));
    expect(byKey['ctr']?.previousValue).toBeNull();
    expect(byKey['position']?.previousValue).toBeNull();
  });

  it('produces no-data snapshots for empty sources', () => {
    const empty = fixture();
    empty.executions = [];
    empty.snapshots = [];
    empty.alerts = [];
    empty.search = [];
    empty.traffic = [];
    empty.analysis = null;
    const kpis = aggregateKpis(empty, period, previousPeriod);
    const noData = kpis.filter((kpi) => kpi.value === null);
    expect(noData.map((kpi) => kpi.key)).toEqual(['seo_score', 'ctr', 'position', 'success_rate', 'rollback_rate', 'learning_success_rate']);
  });
});

describe('KpiTracker', () => {
  const snapshots = [
    {
      key: 'clicks',
      label: 'Clicks',
      value: 100,
      previousValue: 80,
      change: 20,
      changePercent: 25,
      higherIsBetter: true,
      status: 'improved' as const,
    },
  ];

  it('records, lists and returns the latest record', async () => {
    const tracker = new KpiTracker();
    let clock = '2024-01-01T00:00:00.000Z';
    await tracker.record('s1', period, snapshots, () => clock);
    clock = '2024-01-02T00:00:00.000Z';
    await tracker.record('s2', previousPeriod, snapshots, () => clock);

    const all = await tracker.list();
    expect(all).toHaveLength(2);
    expect((await tracker.list('s1'))[0]?.storeId).toBe('s1');
    expect(await tracker.list('nope')).toEqual([]);
    expect((await tracker.latest())?.storeId).toBe('s2');
    expect(await tracker.latest('s1')).not.toBeNull();
    expect(await tracker.latest('nope')).toBeNull();
  });

  it('returns KPI history newest-first', async () => {
    const tracker = new KpiTracker();
    await tracker.record(undefined, { startDate: '2024-01-01', endDate: '2024-01-07' }, snapshots);
    await tracker.record(undefined, { startDate: '2024-01-08', endDate: '2024-01-14' }, snapshots);
    const history = await tracker.history(undefined, 'clicks');
    expect(history).toHaveLength(2);
    expect(history[0]?.key).toBe('clicks');
    expect(history[0]).toHaveProperty('period');
    expect(await tracker.history(undefined, 'other')).toEqual([]);
  });

  it('resets all records', async () => {
    const tracker = new KpiTracker();
    await tracker.record('s1', period, snapshots);
    await tracker.reset();
    expect(await tracker.list()).toEqual([]);
    expect(await tracker.latest()).toBeNull();
  });
});
