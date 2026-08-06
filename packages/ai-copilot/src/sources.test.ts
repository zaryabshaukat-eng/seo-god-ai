import { describe, expect, it } from 'vitest';
import { InMemoryLearningStore, LearningEngineService } from '@seogod/learning-engine';
import { InMemoryObservabilityStore, ObservabilityService } from '@seogod/observability';
import { ReportEngineService } from '@seogod/reports';
import {
  approvalRequired,
  buildMetricsOverview,
  buildOptimizationPlan,
  fromDecisionEngine,
  fromLearningEngine,
  fromObservability,
  fromReportEngine,
  gatherRecommendations,
  isSafeAction,
  riskOf,
  suggestSafeActions,
  type CopilotRecommendation,
  type CopilotSources,
  type ObservabilityServiceLike,
} from './sources.js';

function recommendation(overrides: Partial<CopilotRecommendation> = {}): CopilotRecommendation {
  return {
    id: 'rec_1',
    rule: 'missing-title',
    title: 'Add missing titles',
    description: 'Pages without titles',
    rationale: 'Titles drive ranking',
    recommendedAction: 'Add a title tag',
    priority: 'medium',
    score: 60,
    impact: 'medium',
    effort: 'low',
    confidence: 0.8,
    affectedUrls: ['/a'],
    pageCount: 1,
    ...overrides,
  };
}

const OBSERVABILITY_STUB: ObservabilityServiceLike = {
  async getOverview() {
    return {
      storeCount: 1,
      executionCount: 4,
      activeExecutionCount: 0,
      completedCount: 3,
      failedCount: 1,
      rolledBackCount: 0,
      alertCount: 2,
      openAlertCount: 1,
      latestSeoScore: 78,
      latestExecutionAt: '2026-01-02T00:00:00.000Z',
      successRate: 0.75,
    };
  },
  async getExecutionMetrics() {
    return {
      totalExecutions: 4,
      queued: 0,
      executing: 0,
      completed: 3,
      failed: 1,
      cancelled: 0,
      rolledBack: 0,
      successRate: 0.75,
      failureRate: 0.25,
      rollbackRate: 0,
      averageExecutionTimeMs: 500,
      p95ExecutionTimeMs: 800,
      validationFailures: 0,
      safetyViolations: 0,
      totalRollbacks: 0,
      crawlSuccessRate: 1,
      simulated: 0,
    };
  },
  async getAlerts() {
    return [
      { alertId: 'a1', type: 'seo_regression', severity: 'critical', message: 'Score dropped', triggeredAt: '2026-01-01T00:00:00.000Z' },
      { alertId: 'a2', type: 'execution_failure', severity: 'warning', message: 'Failed', triggeredAt: '2026-01-01T00:00:00.000Z' },
      { alertId: 'a3', type: 'validation_spike', severity: 'info', message: 'Note', triggeredAt: '2026-01-01T00:00:00.000Z' },
    ];
  },
  async getHistory() {
    return {
      snapshots: [
        { overallScore: 70, pagesCrawled: 90, totalIssues: 4, brokenLinks: 1, capturedAt: '2026-01-01T00:00:00.000Z' },
        { overallScore: 78, pagesCrawled: 95, totalIssues: 3, brokenLinks: 0, capturedAt: '2026-01-02T00:00:00.000Z' },
      ],
    };
  },
};

describe('fromObservability', () => {
  it('counts alert severities', async () => {
    const source = fromObservability(OBSERVABILITY_STUB);
    const alerts = await source.alerts('store_1', 10);
    expect(alerts).toMatchObject({ total: 3, critical: 1, warning: 1, info: 1 });
  });

  it('derives crawl summaries from snapshot history', async () => {
    const source = fromObservability(OBSERVABILITY_STUB);
    const crawl = await source.crawlSummary('store_1');
    expect(crawl).toMatchObject({
      storeId: 'store_1',
      latestScore: 78,
      previousScore: 70,
      delta: 8,
      pagesCrawled: 95,
      totalIssues: 3,
      brokenLinks: 0,
      snapshots: 2,
    });
  });

  it('handles histories without snapshots', async () => {
    const source = fromObservability({ ...OBSERVABILITY_STUB, getHistory: async () => ({ snapshots: [] }) });
    const crawl = await source.crawlSummary('store_1');
    expect(crawl).toEqual({
      storeId: 'store_1',
      latestScore: null,
      previousScore: null,
      delta: null,
      pagesCrawled: null,
      totalIssues: null,
      brokenLinks: null,
      snapshots: 0,
    });
  });

  it('delegates overview and execution summaries', async () => {
    const source = fromObservability(OBSERVABILITY_STUB);
    const overview = await source.overview('store_1');
    const execution = await source.executionSummary('store_1');
    expect(overview.latestSeoScore).toBe(78);
    expect(execution.successRate).toBe(0.75);
  });
});

describe('fromObservability (real service)', () => {
  it('integrates with the observability package', async () => {
    const service = new ObservabilityService(new InMemoryObservabilityStore());
    await service.recordAnalysis({
      storeId: 'store_1',
      analyzedAt: '2026-01-01T00:00:00.000Z',
      overallScore: 55,
    });
    await service.recordAnalysis({
      storeId: 'store_1',
      analyzedAt: '2026-01-02T00:00:00.000Z',
      overallScore: 62,
    });

    const source = fromObservability(service);
    const crawl = await source.crawlSummary('store_1');
    expect(crawl).toMatchObject({ latestScore: 62, previousScore: 55, delta: 7, snapshots: 2 });

    const overview = await source.overview('store_1');
    expect(overview.latestSeoScore).toBe(62);

    const execution = await source.executionSummary('store_1');
    expect(execution.totalExecutions).toBe(0);

    const alerts = await source.alerts('store_1', 10);
    expect(alerts).toEqual({ total: 0, critical: 0, warning: 0, info: 0, items: [] });
  });
});

describe('fromLearningEngine (real service)', () => {
  it('adapts outcome analysis and feedback summaries', async () => {
    const service = new LearningEngineService({
      store: new InMemoryLearningStore(),
      now: () => '2026-01-01T00:00:00.000Z',
    });
    await service.ingestOutcome({ executionId: 'e1', storeId: 'store_1', rule: 'missing-title', status: 'SUCCESS', impact: 12 });
    await service.ingestOutcome({ executionId: 'e2', storeId: 'store_1', rule: 'missing-title', status: 'FAILURE' });
    await service.ingestOutcome({ executionId: 'e3', storeId: 'store_1', rule: 'slow-pages', status: 'SUCCESS', impact: 4 });
    await service.recordFeedback({ storeId: 'store_1', rule: 'missing-title', rating: 1 });
    await service.recordFeedback({ storeId: 'store_1', rule: 'missing-title', rating: -1 });

    const source = fromLearningEngine(service);
    const analysis = await source.analyzeOutcomes('store_1');
    expect(analysis.summary.totalOutcomes).toBe(3);
    expect(analysis.rules).toHaveLength(2);

    const feedback = await source.summarizeFeedback('store_1');
    expect(feedback).toMatchObject({ total: 2, positive: 1, negative: 1 });
  });

  it('analyzes outcomes and feedback without a store scope', async () => {
    const service = new LearningEngineService({
      store: new InMemoryLearningStore(),
      now: () => '2026-01-01T00:00:00.000Z',
    });
    const source = fromLearningEngine(service);
    const analysis = await source.analyzeOutcomes();
    expect(analysis.summary.totalOutcomes).toBe(0);
    const feedback = await source.summarizeFeedback();
    expect(feedback.total).toBe(0);
  });
});

describe('fromReportEngine (real service)', () => {
  it('generates reports through the reports engine', async () => {
    const engine = new ReportEngineService({ sources: {} });
    const source = fromReportEngine(engine);

    const report = await source.generateReport({ kind: 'kpi', storeId: 'store_1', days: 30, compare: true });
    expect(report.kind).toBe('kpi');
    expect(Array.isArray(report.kpis)).toBe(true);
    expect(report.sections.length).toBeGreaterThan(0);
  });

  it('defaults unknown kinds to executive-dashboard', async () => {
    const engine = new ReportEngineService({ sources: {} });
    const source = fromReportEngine(engine);
    const report = await source.generateReport({ kind: 'bogus' });
    expect(report.kind).toBe('executive-dashboard');
  });

  it('omits periodOptions when no days are given', async () => {
    const engine = new ReportEngineService({ sources: {} });
    const source = fromReportEngine(engine);
    const report = await source.generateReport({});
    expect(report.kind).toBe('executive-dashboard');
    expect(report.id.length).toBeGreaterThan(0);
  });
});

describe('fromDecisionEngine', () => {
  it('delegates plan listing', async () => {
    const source = fromDecisionEngine({
      async listPlans(storeId) {
        return [{ id: 'plan_1', status: 'APPROVED', risk: 'MEDIUM', taskCount: 3, totalImpact: 40, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', storeId }];
      },
    });
    const plans = await source.listPlans('store_1');
    expect(plans).toHaveLength(1);
    expect(plans[0]?.status).toBe('APPROVED');
  });
});

describe('gatherRecommendations', () => {
  it('fetches and trims recommendations', async () => {
    const sources: CopilotSources = {
      recommendations: {
        async listRecommendations() {
          return [recommendation({ id: 'r1' }), recommendation({ id: 'r2' }), recommendation({ id: 'r3' })];
        },
      },
    };
    const items = await gatherRecommendations(sources, { limit: 2 });
    expect(items.map((item) => item.id)).toEqual(['r1', 'r2']);
  });

  it('throws when recommendations are not wired', async () => {
    await expect(gatherRecommendations({})).rejects.toThrow('Recommendations source is not available.');
  });
});

describe('buildMetricsOverview', () => {
  it('combines observability and report KPI data', async () => {
    const sources: CopilotSources = {
      observability: fromObservability(OBSERVABILITY_STUB),
      reports: {
        async generateReport() {
          return {
            id: 'rep_1',
            name: 'KPIs',
            kind: 'kpi',
            period: { startDate: '2026-01-01', endDate: '2026-01-31' },
            generatedAt: '2026-01-31T00:00:00.000Z',
            sections: [],
            kpis: [{ key: 'score', label: 'Score', value: 78, previousValue: 70, changePercent: 11.4, status: 'improved' }],
            alerts: null,
          };
        },
      },
    };
    const overview = await buildMetricsOverview(sources, 'store_1');
    expect(overview.overview?.latestSeoScore).toBe(78);
    expect(overview.kpis).toHaveLength(1);
  });

  it('handles absent observability and reports', async () => {
    const overview = await buildMetricsOverview({}, 'store_1');
    expect(overview.overview).toBeNull();
    expect(overview.execution).toBeNull();
    expect(overview.crawl).toBeNull();
    expect(overview.alerts).toBeNull();
    expect(overview.kpis).toBeNull();
  });
});

describe('risk scoring', () => {
  it('classifies high effort + high priority as HIGH', () => {
    expect(riskOf(recommendation({ priority: 'high', effort: 'high' }))).toBe('HIGH');
  });

  it('classifies either high dimension as MEDIUM', () => {
    expect(riskOf(recommendation({ priority: 'high', effort: 'low' }))).toBe('MEDIUM');
    expect(riskOf(recommendation({ priority: 'low', effort: 'high' }))).toBe('MEDIUM');
  });

  it('classifies otherwise as LOW', () => {
    expect(riskOf(recommendation())).toBe('LOW');
  });

  it('requires approval for high risk or impactful high-effort changes', () => {
    expect(approvalRequired(recommendation({ priority: 'high', effort: 'high' }))).toBe(true);
    expect(approvalRequired(recommendation({ impact: 'high', effort: 'medium' }))).toBe(true);
    expect(approvalRequired(recommendation({ impact: 'high', effort: 'low' }))).toBe(false);
    expect(approvalRequired(recommendation())).toBe(false);
  });

  it('marks safe actions when risk is not HIGH', () => {
    expect(isSafeAction(recommendation())).toBe(true);
    expect(isSafeAction(recommendation({ priority: 'high', effort: 'high' }))).toBe(false);
  });
});

describe('buildOptimizationPlan', () => {
  it('ranks by score and computes summary counts', () => {
    const plan = buildOptimizationPlan(
      [
        recommendation({ id: 'r1', priority: 'critical', score: 90, effort: 'high' }),
        recommendation({ id: 'r2', score: 50 }),
        recommendation({ id: 'r3', priority: 'high', score: 70, impact: 'high', effort: 'medium' }),
      ],
      { storeId: 'store_1', createdAt: '2026-01-01T00:00:00.000Z' },
    );
    expect(plan.storeId).toBe('store_1');
    expect(plan.createdAt).toBe('2026-01-01T00:00:00.000Z');
    expect(plan.items.map((item) => item.recommendation.id)).toEqual(['r1', 'r3', 'r2']);
    expect(plan.items.map((item) => item.rank)).toEqual([1, 2, 3]);
    expect(plan.summary).toEqual({ count: 3, totalImpact: 210, criticalCount: 1, highCount: 1, safeCount: 2, approvalRequiredCount: 2 });
  });

  it('handles empty recommendation sets', () => {
    const plan = buildOptimizationPlan([]);
    expect(plan.summary.count).toBe(0);
    expect(plan.items).toEqual([]);
  });
});

describe('suggestSafeActions', () => {
  it('excludes approval-required changes and sorts by score', () => {
    const suggestions = suggestSafeActions([
      recommendation({ id: 'risky', priority: 'high', effort: 'high', score: 95 }),
      recommendation({ id: 'quick', score: 30 }),
      recommendation({ id: 'impactful', score: 80 }),
    ]);
    expect(suggestions.map((s) => s.recommendation.id)).toEqual(['impactful', 'quick']);
    expect(suggestions.every((s) => s.approvalRequired === false)).toBe(true);
  });

  it('reasons about medium-effort suggestions', () => {
    const suggestions = suggestSafeActions([recommendation({ id: 'm', effort: 'medium', score: 70 })]);
    expect(suggestions[0]?.reason).toBe('Low-to-medium risk change within safe thresholds.');
  });

  it('applies a limit', () => {
    const suggestions = suggestSafeActions(
      [recommendation({ id: 'a', score: 10 }), recommendation({ id: 'b', score: 20 })],
      { limit: 1 },
    );
    expect(suggestions).toHaveLength(1);
  });

  it('reports low-effort reasoning', () => {
    const [suggestion] = suggestSafeActions([recommendation({ effort: 'low' })]);
    expect(suggestion?.reason).toContain('Low-effort');
  });
});
