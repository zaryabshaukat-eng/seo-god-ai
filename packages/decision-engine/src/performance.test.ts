import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
import { decisionInput, ORIGIN, recommendation, STORE_ID } from './test/fixtures.js';
import { InMemoryDecisionRepository } from './test/memory-repository.js';
import { DecisionEngineService } from './services/decision-engine-service.js';

const RULES = ['missing-title', 'thin-content', 'duplicate-content', 'orphan-page', 'slow-lcp'];

function manyRecommendations(count: number) {
  return Array.from({ length: count }, (_, index) => {
    const rule = RULES[index % RULES.length]!;
    const url = `${ORIGIN}/p/page-${index}`;
    return recommendation({
      id: `rec-${index}`,
      rule,
      category: 'content',
      priority: index % 3 === 0 ? 'HIGH' : index % 3 === 1 ? 'MEDIUM' : 'LOW',
      score: 100 - (index % 40),
      impact: index % 2 === 0 ? 'HIGH' : 'LOW',
      effort: index % 2 === 0 ? 'LOW' : 'HIGH',
      confidence: 0.5 + (index % 50) / 100,
      affectedUrls: [url],
      pageCount: 1,
      occurrenceCount: 1,
    });
  });
}

describe('decision engine performance', () => {
  it('prioritizes, plans, and batches 1,200 recommendations quickly', async () => {
    const repository = new InMemoryDecisionRepository();
    const service = new DecisionEngineService({ repository });
    const input = decisionInput({
      storeSettings: {
        storeId: STORE_ID,
        approvalMode: 'auto',
        riskTolerance: 'balanced',
        maxBatchSize: 50,
        maxChangesPerResource: 3,
        planCapRecommendations: null,
      },
      recommendations: manyRecommendations(1200),
    });

    const started = performance.now();
    const created = await service.createDecision(input);
    const planned = await service.planDecision(created.decision.id);
    const elapsedMs = performance.now() - started;

    expect(elapsedMs).toBeLessThan(10_000);
    expect(created.decision.summary.recommendationCount).toBe(1200);
    expect(planned.plan.tasks.length).toBeGreaterThan(0);
    expect(planned.plan.tasks.every((entry) => entry.status === 'PENDING')).toBe(true);

    const uniqueTasks = new Set(planned.plan.tasks.map((entry) => entry.id));
    expect(uniqueTasks.size).toBe(planned.plan.tasks.length);
    expect(planned.plan.batches.length).toBeGreaterThanOrEqual(1);
    expect(planned.plan.batches.every((batch) => batch.taskIds.length <= 50)).toBe(true);
  });

  it('orders 1,000 tasks deterministically across batches', async () => {
    const repository = new InMemoryDecisionRepository();
    const service = new DecisionEngineService({ repository });
    const input = decisionInput({
      storeSettings: {
        storeId: STORE_ID,
        approvalMode: 'auto',
        riskTolerance: 'balanced',
        maxBatchSize: 50,
        maxChangesPerResource: 3,
        planCapRecommendations: null,
      },
      recommendations: manyRecommendations(1000),
    });

    const first = await service.planDecision((await service.createDecision(input)).decision.id);
    const second = await service.planDecision((await service.createDecision(input)).decision.id);

    expect(first.plan.orderedTaskIds).toEqual(second.plan.orderedTaskIds);
    expect(first.plan.batches.map((batch) => batch.taskIds)).toEqual(second.plan.batches.map((batch) => batch.taskIds));
  });
});
