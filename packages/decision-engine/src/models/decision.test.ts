import { describe, expect, it } from 'vitest';
import { decisionInput, fixedClock, recommendation } from '../test/fixtures.js';
import { Prioritizer } from '../prioritizer/prioritizer.js';
import { DecisionModel } from './decision.js';

function makeDecision() {
  const input = decisionInput({
    recommendations: [recommendation({ id: 'rec-b' }), recommendation({ id: 'rec-a' })],
  });
  const prioritized = new Prioritizer().prioritize(input);
  const summary = { recommendationCount: 2, taskCount: 0, batchCount: 0, estimatedExecutionMinutes: 0, totalEffortHours: 0, totalImpact: 0, highRiskTaskCount: 0, approvalRequired: false };
  return DecisionModel.create({ input, prioritized, summary, now: fixedClock });
}

describe('DecisionModel.create', () => {
  it('creates a pending decision with a deterministic id', () => {
    const decision = makeDecision();
    expect(decision.status).toBe('PENDING');
    expect(decision.planId).toBeNull();
    expect(decision.recommendationIds).toEqual(['rec-a', 'rec-b']);
    expect(decision.createdAt).toEqual(fixedClock());
    expect(DecisionModel.create({
      input: decisionInput(),
      prioritized: [],
      summary: { recommendationCount: 1, taskCount: 0, batchCount: 0, estimatedExecutionMinutes: 0, totalEffortHours: 0, totalImpact: 0, highRiskTaskCount: 0, approvalRequired: false },
      now: fixedClock,
    }).id).not.toBe(decision.id);
  });

  it('scores the average of prioritized recommendations', () => {
    const decision = makeDecision();
    expect(decision.score).toBeGreaterThanOrEqual(0);
    expect(decision.score).toBeLessThanOrEqual(100);
  });

  it('scores zero when nothing is prioritized', () => {
    const decision = DecisionModel.create({
      input: decisionInput(),
      prioritized: [],
      summary: { recommendationCount: 1, taskCount: 0, batchCount: 0, estimatedExecutionMinutes: 0, totalEffortHours: 0, totalImpact: 0, highRiskTaskCount: 0, approvalRequired: false },
      now: fixedClock,
    });
    expect(decision.score).toBe(0);
  });

  it('defaults the source to manual', () => {
    const decision = DecisionModel.create({
      input: decisionInput({ source: undefined }),
      prioritized: [],
      summary: { recommendationCount: 1, taskCount: 0, batchCount: 0, estimatedExecutionMinutes: 0, totalEffortHours: 0, totalImpact: 0, highRiskTaskCount: 0, approvalRequired: false },
      now: fixedClock,
    });
    expect(decision.source).toBe('manual');
  });
});

describe('DecisionModel transitions', () => {
  it('updates status, plan id, and summary with a new timestamp', () => {
    const decision = makeDecision();
    const later = (): Date => new Date('2026-01-02T00:00:00.000Z');
    const withStatus = DecisionModel.setStatus(decision, 'APPROVED', later);
    expect(withStatus.status).toBe('APPROVED');
    expect(withStatus.updatedAt).toEqual(later());
    expect(decision.status).toBe('PENDING');

    const withPlan = DecisionModel.setPlanId(decision, 'plan-1', later);
    expect(withPlan.planId).toBe('plan-1');

    const withSummary = DecisionModel.setSummary(decision, { ...decision.summary, taskCount: 3 }, later);
    expect(withSummary.summary.taskCount).toBe(3);
  });

  it('copies recommendations on fromRecord', () => {
    const decision = makeDecision();
    const copy = DecisionModel.fromRecord(decision);
    expect(copy.recommendations[0]).not.toBe(decision.recommendations[0]);
  });
});
