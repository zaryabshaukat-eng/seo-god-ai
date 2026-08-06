import { describe, expect, it } from 'vitest';
import { ReportValidationError } from './errors.js';
import { getTemplate, TEMPLATES } from './templates.js';
import { buildTrendSeries } from './aggregation.js';
import { aggregateAlerts } from './aggregation.js';
import type { ReportSourceData, TrendSeries } from './types.js';

const period = { startDate: '2024-01-01', endDate: '2024-01-07' };
const previousPeriod = { startDate: '2023-12-25', endDate: '2023-12-31' };

function fixture(): ReportSourceData {
  return {
    period,
    executions: [
      { executionId: 'e1', storeId: 's1', status: 'COMPLETED', startedAt: '2024-01-02T10:00:00Z', durationMs: 100, operation: 'title-optimization' },
      { executionId: 'e2', storeId: 's1', status: 'COMPLETED', startedAt: '2024-01-03T10:00:00Z', durationMs: 200, operation: 'title-optimization' },
      { executionId: 'e3', storeId: 's1', status: 'FAILED', startedAt: '2024-01-04T10:00:00Z' },
    ],
    snapshots: [
      { snapshotId: 's1', storeId: 's1', capturedAt: '2024-01-03T10:00:00Z', overallScore: 80, totalIssues: 12, pagesCrawled: 300, brokenLinks: 2 },
    ],
    alerts: [
      { alertId: 'a1', type: 'crawl', severity: 'critical', message: 'site down', triggeredAt: '2024-01-03T10:00:00Z', context: {} },
      { alertId: 'a2', type: 'crawl', severity: 'warning', message: 'slow', triggeredAt: '2024-01-04T10:00:00Z', context: {} },
    ],
    changes: [
      { changeId: 'c1', kind: 'apply', executionId: 'e1', storeId: 's1', entityId: 'p1', appliedAt: '2024-01-02T11:00:00Z', changedFields: ['title'] },
    ],
    analysis: {
      rules: [{ rule: 'r1', attempts: 2, successes: 1, failures: 1, skipped: 0, rolledBack: 0, successRate: 0.5, averageImpact: 3 }],
      summary: { totalOutcomes: 2, rulesAnalyzed: 1, overallSuccessRate: 0.5, overallAverageImpact: 3 },
    },
    feedback: { total: 1, positive: 1, neutral: 0, negative: 0, netScore: 1 },
    historicalOutcomes: [{ rule: 'r1', attempts: 2, successes: 1, averageImpact: 3 }],
    recommendations: [
      {
        id: 'rec-1',
        rule: 'title-optimization',
        title: 'Rewrite titles',
        category: 'on-page',
        priority: 'high',
        score: 0.9,
        impact: 'HIGH',
        effort: 'LOW',
        confidence: 0.8,
        affectedUrls: ['/a'],
        pageCount: 1,
      },
    ],
    plans: [],
    search: [
      { date: '2024-01-02', clicks: 10, impressions: 100, ctr: 0.1, position: 3 },
      { date: '2024-01-03', clicks: 15, impressions: 150, ctr: 0.1, position: 4 },
    ],
    traffic: [
      { date: '2024-01-02', sessions: 100, users: 80, pageviews: 300 },
    ],
  };
}

function sectionKinds(data: ReportSourceData, kind: 'executive-dashboard' | 'seo' | 'kpi' | 'trends' | 'alerts'): string[] {
  const template = getTemplate(kind);
  const trends = buildTrendSeries(data, period);
  const alerts = aggregateAlerts(data.alerts, period);
  return template.buildSections(data, { previousPeriod, trends, alerts }).map((section) => section.kind);
}

describe('getTemplate', () => {
  it('defaults to the executive dashboard', () => {
    expect(getTemplate(undefined).kind).toBe('executive-dashboard');
    expect(getTemplate(null).kind).toBe('executive-dashboard');
  });
  it('resolves known templates', () => {
    expect(getTemplate('seo').kind).toBe('seo');
    expect(getTemplate('kpi').kind).toBe('kpi');
    expect(getTemplate('trends').kind).toBe('trends');
    expect(getTemplate('alerts').kind).toBe('alerts');
  });
  it('throws for unknown templates', () => {
    expect(() => getTemplate('bogus' as never)).toThrow(ReportValidationError);
  });
  it('exposes a registry for every kind', () => {
    expect(Object.keys(TEMPLATES)).toHaveLength(5);
  });
});

describe('template section composition', () => {
  const data = fixture();

  it('executive-dashboard composes summary/kpis/alerts/execution/learning/trends/opportunities', () => {
    expect(sectionKinds(data, 'executive-dashboard')).toEqual([
      'summary',
      'kpis',
      'alerts',
      'execution',
      'learning',
      'trends',
      'trends',
      'trends',
      'trends',
      'opportunities',
    ]);
  });

  it('seo composes summary/seo/trends for search metrics', () => {
    expect(sectionKinds(data, 'seo')).toEqual(['summary', 'seo', 'trends', 'trends', 'trends', 'trends', 'trends']);
  });

  it('kpi composes summary/kpis/learning', () => {
    expect(sectionKinds(data, 'kpi')).toEqual(['summary', 'kpis', 'learning']);
  });

  it('trends includes every series', () => {
    expect(sectionKinds(data, 'trends')).toEqual([
      'summary',
      'trends',
      'trends',
      'trends',
      'trends',
      'trends',
      'trends',
      'trends',
      'trends',
      'trends',
      'trends',
    ]);
  });

  it('orders unknown trend series after known ones and ties by label', () => {
    const custom: TrendSeries[] = [
      { key: 'custom_b', label: 'Beta', period, points: [{ date: '2024-01-01', value: 1 }] },
      { key: 'custom_a', label: 'Alpha', period, points: [{ date: '2024-01-01', value: 1 }] },
    ];
    const sections = getTemplate('trends').buildSections(data, { trends: custom });
    const titles = sections.filter((section) => section.kind === 'trends').map((section) => section.title);
    expect(titles).toEqual(['Alpha', 'Beta']);
  });

  it('alerts composes summary/alerts/execution', () => {
    expect(sectionKinds(data, 'alerts')).toEqual(['summary', 'alerts', 'execution']);
  });
});

describe('section content', () => {
  it('summary reports SEO score, execution and alerts', () => {
    const data = fixture();
    const sections = getTemplate('executive-dashboard').buildSections(data);
    const summary = sections.find((section) => section.kind === 'summary');
    expect(summary?.metrics?.map((metric) => metric.label)).toContain('SEO Score');
    expect(summary?.body).toHaveLength(3);
  });

  it('seo section reports health metrics', () => {
    const data = fixture();
    const sections = getTemplate('seo').buildSections(data);
    const seo = sections.find((section) => section.kind === 'seo');
    expect(seo?.metrics?.find((metric) => metric.label === 'Broken Links')?.value).toBe(2);
  });

  it('execution section lists plans when present', () => {
    const data = fixture();
    data.plans = [
      {
        planId: 'plan-1',
        status: 'ACTIVE',
        risk: 'LOW',
        taskCount: 3,
        totalImpact: 12,
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-02T00:00:00Z',
      },
    ];
    const sections = getTemplate('executive-dashboard').buildSections(data);
    const execution = sections.find((section) => section.kind === 'execution');
    expect(execution?.header?.[0]).toBe('Plan');
    expect(execution?.rows?.[0]).toEqual(['plan-1', 'ACTIVE', 'LOW', 3, 12, '2024-01-01T00:00:00Z', '2024-01-02T00:00:00Z']);
  });

  it('execution section lists rule performance without plans', () => {
    const data = fixture();
    const sections = getTemplate('executive-dashboard').buildSections(data);
    const execution = sections.find((section) => section.kind === 'execution');
    expect(execution?.header?.[0]).toBe('Rule');
    expect(execution?.rows?.[0]?.[0]).toBe('title-optimization');
  });

  it('kpi section includes deltas when previous period given', () => {
    const data = fixture();
    const sections = getTemplate('executive-dashboard').buildSections(data, { previousPeriod });
    const kpis = sections.find((section) => section.kind === 'kpis');
    const clicks = kpis?.metrics?.find((metric) => metric.label === 'Clicks');
    expect(clicks?.delta).toBeNull(); // no previous-period data → no delta
    expect(kpis?.body?.[0]).toContain('improved');
  });

  it('learning section lists top rules', () => {
    const data = fixture();
    const sections = getTemplate('kpi').buildSections(data);
    const learning = sections.find((section) => section.kind === 'learning');
    expect(learning?.rows?.[0]?.[0]).toBe('r1');
    expect(learning?.metrics?.find((metric) => metric.label === 'Net Score')?.value).toBe(1);
  });

  it('learning section tolerates rules without a success rate', () => {
    const data = fixture();
    data.analysis = {
      rules: [
        { rule: 'r1', attempts: 2, successes: 1, failures: 1, skipped: 0, rolledBack: 0, successRate: 0.5, averageImpact: 3 },
        { rule: 'r-none', attempts: 1, successes: 1, failures: 0, skipped: 0, rolledBack: 0, successRate: null as never, averageImpact: null as never },
      ],
      summary: { totalOutcomes: 2, rulesAnalyzed: 1, overallSuccessRate: 0.5, overallAverageImpact: 3 },
    };
    const sections = getTemplate('kpi').buildSections(data);
    const learning = sections.find((section) => section.kind === 'learning');
    const row = learning?.rows?.find((cells) => cells[0] === 'r-none');
    expect(row?.[3]).toBe(0);
  });

  it('opportunities section is empty without recommendations', () => {
    const data = fixture();
    data.recommendations = [];
    const sections = getTemplate('executive-dashboard').buildSections(data);
    const opportunities = sections.find((section) => section.kind === 'opportunities');
    expect(opportunities?.rows).toEqual([]);
    expect(opportunities?.body?.[0]).toContain('No recommendations');
  });

  it('trends section reports no data when empty', () => {
    const data = fixture();
    data.search = [];
    data.snapshots = [];
    data.executions = [];
    data.alerts = [];
    data.traffic = [];
    const sections = getTemplate('trends').buildSections(data);
    const trends = sections.filter((section) => section.kind === 'trends');
    expect(trends).toHaveLength(1);
    expect(trends[0]?.body?.[0]).toContain('No trend data');
  });

  it('alerts section summarizes severity counts', () => {
    const data = fixture();
    const sections = getTemplate('alerts').buildSections(data);
    const alerts = sections.find((section) => section.kind === 'alerts');
    expect(alerts?.metrics?.find((metric) => metric.label === 'Critical')?.value).toBe(1);
    expect(alerts?.body?.[1]).toContain('CRITICAL: site down');
  });
});
