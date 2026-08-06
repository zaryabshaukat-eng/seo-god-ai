import { describe, expect, it } from 'vitest';
import {
  aggregateAlerts,
  buildExecutionSummary,
  buildLearningSummary,
  buildSeoSummary,
  buildTrendSeries,
  deriveRulePerformance,
  limitTrendPoints,
  normalizeSeries,
  seoSeriesDate,
} from './aggregation.js';
import type { ReportSourceData } from './types.js';

const period = { startDate: '2024-01-01', endDate: '2024-01-07' };

function fixture(): ReportSourceData {
  return {
    period,
    executions: [
      { executionId: 'e1', storeId: 's1', status: 'COMPLETED', startedAt: '2024-01-02T10:00:00Z', durationMs: 100, operation: 'title-optimization' },
      { executionId: 'e2', storeId: 's1', status: 'COMPLETED', startedAt: '2024-01-03T10:00:00Z', durationMs: 200, operation: 'title-optimization' },
      { executionId: 'e3', storeId: 's1', status: 'FAILED', startedAt: '2024-01-04T10:00:00Z', operation: 'meta-description' },
      { executionId: 'e4', storeId: 's1', status: 'ROLLED_BACK', startedAt: '2024-01-05T10:00:00Z', operation: 'title-optimization' },
      { executionId: 'e5', storeId: 's1', status: 'CANCELLED', startedAt: '2024-01-06T10:00:00Z' },
      { executionId: 'eOld', storeId: 's1', status: 'COMPLETED', startedAt: '2023-12-01T10:00:00Z' },
    ],
    snapshots: [
      { snapshotId: 's1', storeId: 's1', capturedAt: '2024-01-03T10:00:00Z', overallScore: 80, totalIssues: 12, pagesCrawled: 300, brokenLinks: 2 },
      { snapshotId: 's2', storeId: 's1', capturedAt: '2024-01-05T10:00:00Z', overallScore: 85, totalIssues: 10, pagesCrawled: 320, brokenLinks: 1 },
      { snapshotId: 'sOld', storeId: 's1', capturedAt: '2023-12-01T10:00:00Z', overallScore: 60 },
    ],
    alerts: [
      { alertId: 'a1', type: 'crawl', severity: 'critical', message: 'site down', triggeredAt: '2024-01-03T10:00:00Z', context: {} },
      { alertId: 'a2', type: 'crawl', severity: 'warning', message: 'slow', triggeredAt: '2024-01-04T10:00:00Z', context: {} },
      { alertId: 'a3', type: 'links', severity: 'info', message: 'ok', triggeredAt: '2024-01-05T10:00:00Z', context: {} },
      { alertId: 'aOld', type: 'crawl', severity: 'critical', message: 'old', triggeredAt: '2023-11-01T10:00:00Z', context: {} },
    ],
    changes: [
      { changeId: 'c1', kind: 'apply', executionId: 'e1', storeId: 's1', entityId: 'p1', appliedAt: '2024-01-02T11:00:00Z', changedFields: ['title'] },
      { changeId: 'c2', kind: 'apply', executionId: 'e2', storeId: 's1', entityId: 'p2', appliedAt: '2024-01-03T11:00:00Z', changedFields: ['title'] },
      { changeId: 'c3', kind: 'revert', executionId: 'e4', storeId: 's1', entityId: 'p3', appliedAt: '2024-01-05T11:00:00Z', changedFields: ['title'] },
      { changeId: 'cOld', kind: 'apply', executionId: 'eOld', storeId: 's1', entityId: 'p0', appliedAt: '2023-12-01T11:00:00Z', changedFields: [] },
    ],
    analysis: {
      rules: [
        { rule: 'r2', attempts: 4, successes: 3, failures: 1, skipped: 0, rolledBack: 0, successRate: 0.75, averageImpact: 5 },
        { rule: 'r1', attempts: 10, successes: 6, failures: 4, skipped: 1, rolledBack: 1, successRate: 0.6, averageImpact: 8 },
      ],
      summary: { totalOutcomes: 14, rulesAnalyzed: 2, overallSuccessRate: 0.64, overallAverageImpact: 7 },
    },
    feedback: { total: 5, positive: 3, neutral: 1, negative: 1, netScore: 2 },
    historicalOutcomes: [{ rule: 'r1', attempts: 10, successes: 6, averageImpact: 8 }],
    recommendations: [],
    plans: [],
    search: [
      { date: '2024-01-02', clicks: 10, impressions: 100, ctr: 0.1, position: 3 },
      { date: '2024-01-02', clicks: 5, impressions: 50, ctr: 0.1, position: 5 },
      { date: '2024-01-03', clicks: 15, impressions: 150, ctr: 0.1, position: 4 },
      { date: '2023-12-30', clicks: 99, impressions: 99, ctr: 0.1, position: 1 },
    ],
    traffic: [
      { date: '2024-01-02', sessions: 100, users: 80, pageviews: 300 },
      { date: '2024-01-03', sessions: 120, users: 90, pageviews: 350 },
      { date: '2023-12-30', sessions: 999, users: 999, pageviews: 999 },
    ],
  };
}

describe('buildSeoSummary', () => {
  it('picks latest/previous scores within the period', () => {
    const summary = buildSeoSummary(fixture().snapshots, period);
    expect(summary.latestScore).toBe(85);
    expect(summary.previousScore).toBe(80);
    expect(summary.delta).toBe(5);
    expect(summary.totalIssues).toBe(10);
    expect(summary.pagesCrawled).toBe(320);
    expect(summary.brokenLinks).toBe(1);
    expect(summary.snapshots).toBe(2);
  });

  it('handles a single snapshot', () => {
    const summary = buildSeoSummary([{ snapshotId: 's', storeId: 's', capturedAt: '2024-01-02T00:00:00Z', overallScore: 90 }], period);
    expect(summary.latestScore).toBe(90);
    expect(summary.previousScore).toBeNull();
    expect(summary.delta).toBeNull();
    expect(summary.totalIssues).toBeNull();
  });

  it('handles no snapshots', () => {
    const summary = buildSeoSummary([], period);
    expect(summary.latestScore).toBeNull();
    expect(summary.snapshots).toBe(0);
  });
});

describe('buildExecutionSummary', () => {
  it('rolls up executions and changes in the period', () => {
    const data = fixture();
    const summary = buildExecutionSummary(data.executions, data.changes, period);
    expect(summary.totalExecutions).toBe(5);
    expect(summary.completed).toBe(2);
    expect(summary.failed).toBe(1);
    expect(summary.cancelled).toBe(1);
    expect(summary.rolledBack).toBe(1);
    expect(summary.byStatus).toEqual({ COMPLETED: 2, FAILED: 1, ROLLED_BACK: 1, CANCELLED: 1 });
    expect(summary.successRate).toBeCloseTo(0.4);
    expect(summary.averageDurationMs).toBe(150);
    expect(summary.p95DurationMs).toBe(200);
    expect(summary.changesApplied).toBe(2);
    expect(summary.changesReverted).toBe(1);
  });

  it('handles no completed executions', () => {
    const data = fixture();
    data.executions = [{ executionId: 'e', storeId: 's', status: 'FAILED', startedAt: '2024-01-02T00:00:00Z' }];
    const summary = buildExecutionSummary(data.executions, [], period);
    expect(summary.successRate).toBeNull();
    expect(summary.averageDurationMs).toBeNull();
    expect(summary.p95DurationMs).toBeNull();
  });
});

describe('deriveRulePerformance', () => {
  it('groups by operation and defaults unnamed rules to execution', () => {
    const data = fixture();
    const rules = deriveRulePerformance(data.executions);
    const title = rules.find((rule) => rule.rule === 'title-optimization');
    expect(title?.attempts).toBe(3);
    expect(title?.successes).toBe(2);
    expect(title?.failures).toBe(0);
    expect(title?.rolledBack).toBe(1);
    expect(title?.successRate).toBeCloseTo(0.6666666666666666);
    const unnamed = rules.find((rule) => rule.rule === 'execution');
    expect(unnamed?.attempts).toBe(1);
    expect(unnamed?.failures).toBe(0);
    expect(rules[0]?.attempts).toBe(3); // sorted by attempts desc
  });

  it('handles empty input', () => {
    expect(deriveRulePerformance([])).toEqual([]);
  });
});

describe('buildLearningSummary', () => {
  it('builds a learning summary from analysis + feedback', () => {
    const data = fixture();
    const summary = buildLearningSummary(data.analysis, data.feedback, data.historicalOutcomes);
    expect(summary.outcomes).toBe(14);
    expect(summary.rules).toBe(2);
    expect(summary.overallSuccessRate).toBeCloseTo(0.64);
    expect(summary.overallAverageImpact).toBe(7);
    expect(summary.feedback.netScore).toBe(2);
    expect(summary.topRules[0]?.rule).toBe('r1'); // sorted by attempts desc
    expect(summary.historicalOutcomes[0]?.rule).toBe('r1');
  });

  it('handles null analysis and feedback', () => {
    const summary = buildLearningSummary(null, null, []);
    expect(summary.outcomes).toBe(0);
    expect(summary.overallSuccessRate).toBeNull();
    expect(summary.feedback.total).toBe(0);
    expect(summary.topRules).toEqual([]);
    expect(summary.historicalOutcomes).toEqual([]);
  });

  it('breaks attempt ties by rule name', () => {
    const data = fixture();
    data.analysis = {
      rules: [
        { rule: 'zeta', attempts: 3, successes: 2, failures: 1, skipped: 0, rolledBack: 0, successRate: 0.67, averageImpact: 2 },
        { rule: 'alpha', attempts: 3, successes: 2, failures: 1, skipped: 0, rolledBack: 0, successRate: 0.67, averageImpact: 2 },
      ],
      summary: { totalOutcomes: 6, rulesAnalyzed: 2, overallSuccessRate: 0.67, overallAverageImpact: 2 },
    };
    const summary = buildLearningSummary(data.analysis, data.feedback, []);
    expect(summary.topRules.map((rule) => rule.rule)).toEqual(['alpha', 'zeta']);
  });
});

describe('aggregateAlerts', () => {
  it('counts alerts by severity and type', () => {
    const summary = aggregateAlerts(fixture().alerts, period);
    expect(summary.total).toBe(3);
    expect(summary.critical).toBe(1);
    expect(summary.warning).toBe(1);
    expect(summary.info).toBe(1);
    expect(summary.byType).toEqual({ crawl: 2, links: 1 });
    expect(summary.items[0]?.severity).toBe('critical');
  });

  it('handles empty alerts', () => {
    const summary = aggregateAlerts([], period);
    expect(summary.total).toBe(0);
    expect(summary.byType).toEqual({});
    expect(summary.items).toEqual([]);
  });
});

describe('buildTrendSeries', () => {
  it('builds ordered series for each metric present', () => {
    const data = fixture();
    const series = buildTrendSeries(data, period);
    const keys = series.map((entry) => entry.key);
    expect(keys).toEqual(['seo_score', 'clicks', 'impressions', 'ctr', 'position', 'sessions', 'users', 'pageviews', 'executions', 'alerts']);
    const clicks = series.find((entry) => entry.key === 'clicks');
    expect(clicks?.points).toEqual([
      { date: '2024-01-02', value: 15 },
      { date: '2024-01-03', value: 15 },
    ]);
    const ctr = series.find((entry) => entry.key === 'ctr');
    expect(ctr?.points).toEqual([
      { date: '2024-01-02', value: 0.1 },
      { date: '2024-01-03', value: 0.1 },
    ]);
    const position = series.find((entry) => entry.key === 'position');
    expect(position?.points).toEqual([
      { date: '2024-01-02', value: 3.67 },
      { date: '2024-01-03', value: 4 },
    ]);
    const seo = series.find((entry) => entry.key === 'seo_score');
    expect(seo?.unit).toBe('/100');
  });

  it('handles series with zero weights', () => {
    const data = fixture();
    data.search = [
      { date: '2024-01-02', clicks: 0, impressions: 0, ctr: 0, position: 0 },
    ];
    const series = buildTrendSeries(data, period);
    const ctr = series.find((entry) => entry.key === 'ctr');
    expect(ctr?.points[0]?.value).toBe(0);
    const position = series.find((entry) => entry.key === 'position');
    expect(position?.points[0]?.value).toBe(0);
  });

  it('returns an empty array for empty data', () => {
    const data = fixture();
    data.executions = [];
    data.snapshots = [];
    data.alerts = [];
    data.search = [];
    data.traffic = [];
    expect(buildTrendSeries(data, period)).toEqual([]);
  });

  it('skips rows whose dates are not ISO timestamps', () => {
    const data = fixture();
    data.snapshots = [{ snapshotId: 'x', storeId: 's1', capturedAt: 'x', overallScore: 90 }];
    const series = buildTrendSeries(data, period);
    expect(series.find((entry) => entry.key === 'seo_score')).toBeUndefined();
  });
});

describe('limitTrendPoints', () => {
  it('returns a copy when under the limit', () => {
    const points = [{ date: 'a', value: 1 }];
    expect(limitTrendPoints(points, 5)).toEqual(points);
  });
  it('keeps the tail when over the limit', () => {
    const points = Array.from({ length: 10 }, (_, index) => ({ date: `d${index}`, value: index }));
    expect(limitTrendPoints(points, 3)).toEqual(points.slice(7));
  });
});

describe('normalizeSeries', () => {
  it('scales into 0..1', () => {
    expect(normalizeSeries([{ date: 'a', value: 0 }, { date: 'b', value: 100 }])).toEqual([
      { date: 'a', value: 0 },
      { date: 'b', value: 1 },
    ]);
    expect(normalizeSeries([{ date: 'a', value: 50 }])).toEqual([{ date: 'a', value: 0.5 }]);
    expect(normalizeSeries([])).toEqual([]);
  });
});

describe('seoSeriesDate', () => {
  it('formats a value date', () => {
    expect(seoSeriesDate('2024-01-05T10:00:00Z')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
