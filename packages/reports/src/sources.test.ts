import { describe, expect, it, vi } from 'vitest';
import { collectSourceData, fromGa4Report, fromSearchAnalyticsResponse } from './sources.js';
import type {
  AlertRecordLike,
  ChangeRecordLike,
  DecisionReaderLike,
  ExecutionRecordLike,
  Ga4RunReportResponseLike,
  LearningReaderLike,
  ObservabilityStoreLike,
  SearchAnalyticsResponseLike,
} from './types.js';

const period = { startDate: '2024-01-08', endDate: '2024-01-14' };
const previousPeriod = { startDate: '2024-01-01', endDate: '2024-01-07' };

describe('fromSearchAnalyticsResponse', () => {
  it('maps rows to date-indexed search rows', () => {
    const response: SearchAnalyticsResponseLike = {
      rows: [
        { keys: ['2024-01-08'], clicks: 10, impressions: 100, ctr: 0.1, position: 3 },
        { keys: [], clicks: 5, impressions: 50, ctr: 0.1, position: 4 },
      ],
      totalClicks: 15,
      totalImpressions: 150,
      totalCtr: 0.1,
      totalPosition: 3.5,
    };
    expect(fromSearchAnalyticsResponse(response)).toEqual([
      { date: '2024-01-08', clicks: 10, impressions: 100, ctr: 0.1, position: 3 },
      { date: '', clicks: 5, impressions: 50, ctr: 0.1, position: 4 },
    ]);
  });
});

describe('fromGa4Report', () => {
  it('maps metric values by header name', () => {
    const response: Ga4RunReportResponseLike = {
      dimensionHeaders: ['date'],
      metricHeaders: ['sessions', 'totalUsers', 'screenPageViews'],
      rows: [
        { dimensionValues: ['2024-01-08'], metricValues: ['10', '8', '30'] },
        { dimensionValues: [], metricValues: ['', 'not-a-number', '50'] },
        { dimensionValues: ['2024-01-09'], metricValues: ['10'] },
      ],
      rowCount: 3,
    };
    expect(fromGa4Report(response)).toEqual([
      { date: '2024-01-08', sessions: 10, users: 8, pageviews: 30 },
      { date: '', sessions: 0, users: 0, pageviews: 50 },
      { date: '2024-01-09', sessions: 10, users: 0, pageviews: 0 },
    ]);
  });

  it('defaults metrics that are absent from headers', () => {
    const response: Ga4RunReportResponseLike = {
      dimensionHeaders: [],
      metricHeaders: [],
      rows: [{ dimensionValues: ['2024-01-08'], metricValues: [] }],
      rowCount: 1,
    };
    expect(fromGa4Report(response)).toEqual([{ date: '2024-01-08', sessions: 0, users: 0, pageviews: 0 }]);
  });
});

function makeObservability(overrides: Partial<ObservabilityStoreLike> = {}): ObservabilityStoreLike {
  return {
    listExecutions: vi.fn(async (): Promise<ExecutionRecordLike[]> => [
      { executionId: 'e1', storeId: 's1', status: 'COMPLETED', startedAt: '2024-01-10T00:00:00Z' },
    ]),
    listSnapshots: vi.fn(async () => [
      { snapshotId: 's1', storeId: 's1', capturedAt: '2024-01-10T00:00:00Z', overallScore: 88 },
    ]),
    listAlerts: vi.fn(async (): Promise<AlertRecordLike[]> => [
      { alertId: 'a1', type: 'crawl', severity: 'warning', message: 'slow', triggeredAt: '2024-01-10T00:00:00Z', context: {} },
    ]),
    listChanges: vi.fn(async (): Promise<ChangeRecordLike[]> => [
      { changeId: 'c1', kind: 'apply', executionId: 'e1', storeId: 's1', entityId: 'p1', appliedAt: '2024-01-10T00:00:00Z', changedFields: ['title'] },
    ]),
    ...overrides,
  };
}

function makeLearning(overrides: Partial<LearningReaderLike> = {}): LearningReaderLike {
  return {
    analyzeOutcomes: vi.fn(async () => ({
      rules: [],
      summary: { totalOutcomes: 3, rulesAnalyzed: 1, overallSuccessRate: 0.5, overallAverageImpact: 4 },
    })),
    getHistoricalOutcomes: vi.fn(async () => [{ rule: 'r1', attempts: 3, successes: 2, averageImpact: 4 }]),
    summarizeFeedback: vi.fn(async () => ({ total: 1, positive: 1, neutral: 0, negative: 0, netScore: 1 })),
    getSignals: vi.fn(async () => []),
    ...overrides,
  };
}

function makeDecision(): DecisionReaderLike {
  return {
    listPlans: vi.fn(async () => [
      {
        id: 'plan-1',
        storeId: 's1',
        decisionId: 'dec-1',
        status: 'ACTIVE',
        risk: 'LOW',
        totalImpact: 12,
        tasks: [{ id: 't1', status: 'PENDING', risk: 'LOW' }],
        createdAt: new Date('2024-01-05T00:00:00Z'),
        updatedAt: new Date('2024-01-06T00:00:00Z'),
      },
    ]),
    getDecision: vi.fn(async (id: string) =>
      id === 'dec-1'
        ? {
            id: 'dec-1',
            storeId: 's1',
            status: 'APPROVED',
            score: 0.9,
            createdAt: new Date('2024-01-05T00:00:00Z'),
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
                affectedUrls: ['/a', '/b'],
                pageCount: 2,
              },
            ],
          }
        : null,
    ),
  };
}

describe('collectSourceData', () => {
  it('collects observability rows for the store', async () => {
    const observability = makeObservability();
    const data = await collectSourceData({ observability }, period, { storeId: 's1' });
    expect(data.executions).toHaveLength(1);
    expect(data.snapshots).toHaveLength(1);
    expect(data.alerts).toHaveLength(1);
    expect(data.changes).toHaveLength(1);
    expect(observability.listExecutions).toHaveBeenCalledWith({ storeId: 's1' });
    expect(data.analysis).toBeNull();
    expect(data.feedback).toBeNull();
    expect(data.historicalOutcomes).toEqual([]);
    expect(data.recommendations).toEqual([]);
    expect(data.plans).toEqual([]);
    expect(data.search).toEqual([]);
    expect(data.traffic).toEqual([]);
  });

  it('works without an observability store', async () => {
    const data = await collectSourceData({}, period);
    expect(data.executions).toEqual([]);
    expect(data.alerts).toEqual([]);
  });

  it('collects learning analysis and feedback', async () => {
    const learning = makeLearning();
    const data = await collectSourceData({ learning }, period, { storeId: 's1' });
    expect(data.analysis?.summary.totalOutcomes).toBe(3);
    expect(data.feedback?.netScore).toBe(1);
    expect(data.historicalOutcomes).toHaveLength(1);
    expect(learning.analyzeOutcomes).toHaveBeenCalledWith({ storeId: 's1' });
  });

  it('collects decision recommendations and plans (deduped by id)', async () => {
    const decision = makeDecision();
    const data = await collectSourceData({ decision }, period, { storeId: 's1' });
    expect(data.plans).toHaveLength(1);
    expect(data.plans[0]).toMatchObject({ planId: 'plan-1', taskCount: 1, totalImpact: 12, status: 'ACTIVE', risk: 'LOW' });
    expect(data.recommendations).toHaveLength(1);
    expect(data.recommendations[0]).toMatchObject({ id: 'rec-1', pageCount: 2, affectedUrls: ['/a', '/b'] });
    expect(decision.listPlans).toHaveBeenCalledWith('s1');
    expect(decision.getDecision).toHaveBeenCalledWith('dec-1');
  });

  it('sorts recommendations by score descending', async () => {
    const decision: DecisionReaderLike = {
      listPlans: vi.fn(async () => [
        {
          id: 'p1',
          storeId: 's1',
          decisionId: 'd1',
          status: 'ACTIVE',
          risk: 'LOW',
          totalImpact: 0,
          tasks: [],
          createdAt: new Date('2024-01-01T00:00:00Z'),
          updatedAt: new Date('2024-01-01T00:00:00Z'),
        },
      ]),
      getDecision: vi.fn(async () => ({
        id: 'd1',
        storeId: 's1',
        status: 'APPROVED',
        score: 0.9,
        createdAt: new Date('2024-01-01T00:00:00Z'),
        recommendations: [
          { id: 'r1', rule: 'a', title: 'Low', category: 'c', priority: 'low', score: 0.2, impact: 'LOW', effort: 'LOW', confidence: 0.5, affectedUrls: [], pageCount: 0 },
          { id: 'r2', rule: 'b', title: 'High', category: 'c', priority: 'high', score: 0.9, impact: 'HIGH', effort: 'LOW', confidence: 0.9, affectedUrls: [], pageCount: 1 },
        ],
      })),
    };
    const data = await collectSourceData({ decision }, period, { storeId: 's1' });
    expect(data.recommendations.map((recommendation) => recommendation.id)).toEqual(['r2', 'r1']);
  });

  it('skips decisions that no longer exist', async () => {
    const decision: DecisionReaderLike = {
      listPlans: vi.fn(async () => [
        {
          id: 'p1',
          storeId: 's1',
          decisionId: 'gone',
          status: 'ACTIVE',
          risk: 'LOW',
          totalImpact: 0,
          tasks: [],
          createdAt: new Date('2024-01-01T00:00:00Z'),
          updatedAt: new Date('2024-01-01T00:00:00Z'),
        },
        {
          id: 'p2',
          storeId: 's1',
          decisionId: 'dec-1',
          status: 'ACTIVE',
          risk: 'LOW',
          totalImpact: 0,
          tasks: [],
          createdAt: new Date('2024-01-01T00:00:00Z'),
          updatedAt: new Date('2024-01-01T00:00:00Z'),
        },
      ]),
      getDecision: vi.fn(async (id: string) =>
        id === 'gone'
          ? null
          : {
              id: 'dec-1',
              storeId: 's1',
              status: 'APPROVED',
              score: 0.9,
              createdAt: new Date('2024-01-01T00:00:00Z'),
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
            },
      ),
    };
    const data = await collectSourceData({ decision }, period, { storeId: 's1' });
    expect(data.plans).toHaveLength(2);
    expect(data.recommendations).toHaveLength(1);
    expect(decision.getDecision).toHaveBeenCalledWith('gone');
  });

  it('dedupes recommendation ids and ties by rule name', async () => {
    const makeRec = (id: string, rule: string) => ({
      id,
      rule,
      title: id,
      category: 'c',
      priority: 'low',
      score: 0.5,
      impact: 'LOW',
      effort: 'LOW',
      confidence: 0.5,
      affectedUrls: [],
      pageCount: 0,
    });
    const decision: DecisionReaderLike = {
      listPlans: vi.fn(async () => [
        {
          id: 'p1',
          storeId: 's1',
          decisionId: 'd1',
          status: 'ACTIVE',
          risk: 'LOW',
          totalImpact: 0,
          tasks: [],
          createdAt: new Date('2024-01-01T00:00:00Z'),
          updatedAt: new Date('2024-01-01T00:00:00Z'),
        },
        {
          id: 'p2',
          storeId: 's1',
          decisionId: 'd2',
          status: 'ACTIVE',
          risk: 'LOW',
          totalImpact: 0,
          tasks: [],
          createdAt: new Date('2024-01-01T00:00:00Z'),
          updatedAt: new Date('2024-01-01T00:00:00Z'),
        },
      ]),
      getDecision: vi.fn(async (id: string) => ({
        id,
        storeId: 's1',
        status: 'APPROVED',
        score: 0.9,
        createdAt: new Date('2024-01-01T00:00:00Z'),
        recommendations: [makeRec('dup', 'zebra'), makeRec('uniq', 'alpha')],
      })),
    };
    const data = await collectSourceData({ decision }, period, { storeId: 's1' });
    expect(data.recommendations.map((recommendation) => recommendation.id)).toEqual(['uniq', 'dup']);
  });

  it('uses an empty store id for decision lookups when not provided', async () => {
    const decision = makeDecision();
    const data = await collectSourceData({ decision }, period);
    expect(decision.listPlans).toHaveBeenCalledWith('');
    expect(data.plans).toHaveLength(1);
  });

  it('collects google search and traffic for a combined range', async () => {
    const searchAnalytics = vi.fn(async () => ({
      rows: [{ keys: ['2024-01-08'], clicks: 10, impressions: 100, ctr: 0.1, position: 3 }],
      totalClicks: 10,
      totalImpressions: 100,
      totalCtr: 0.1,
      totalPosition: 3,
    }));
    const runReport = vi.fn(async () => ({
      dimensionHeaders: ['date'],
      metricHeaders: ['sessions', 'totalUsers', 'screenPageViews'],
      rows: [{ dimensionValues: ['2024-01-08'], metricValues: ['10', '8', '30'] }],
      rowCount: 1,
    }));
    const getAccessToken = vi.fn(async () => 'token');
    const google = {
      searchConsole: { searchAnalytics },
      analytics: { runReport },
      tokenProvider: { getAccessToken },
      siteUrl: 'sc-domain:example.com',
      propertyId: '1234',
      searchType: 'web',
    };
    const data = await collectSourceData({ google }, period, { storeId: 's1', previousPeriod });
    expect(searchAnalytics).toHaveBeenCalledWith('token', 'sc-domain:example.com', {
      startDate: '2024-01-01',
      endDate: '2024-01-14',
      dimensions: ['date'],
      searchType: 'web',
    });
    expect(runReport).toHaveBeenCalledWith('token', '1234', {
      dateRanges: [{ startDate: '2024-01-01', endDate: '2024-01-14' }],
      dimensions: [{ name: 'date' }],
      metrics: [{ name: 'sessions' }, { name: 'totalUsers' }, { name: 'screenPageViews' }],
    });
    expect(data.search).toEqual([{ date: '2024-01-08', clicks: 10, impressions: 100, ctr: 0.1, position: 3 }]);
    expect(data.traffic).toEqual([{ date: '2024-01-08', sessions: 10, users: 8, pageviews: 30 }]);
  });

  it('uses an empty access token without a token provider', async () => {
    const searchAnalytics = vi.fn(async () => ({
      rows: [],
      totalClicks: 0,
      totalImpressions: 0,
      totalCtr: 0,
      totalPosition: 0,
    }));
    const data = await collectSourceData(
      { google: { searchConsole: { searchAnalytics }, siteUrl: 'example.com' } },
      period,
    );
    expect(searchAnalytics).toHaveBeenCalledWith('', 'example.com', expect.anything());
    expect(data.search).toEqual([]);
  });

  it('skips google when only a token provider is given', async () => {
    const google = { tokenProvider: { getAccessToken: vi.fn(async () => 't') } };
    const data = await collectSourceData({ google }, period);
    expect(data.search).toEqual([]);
    expect(data.traffic).toEqual([]);
  });
});
