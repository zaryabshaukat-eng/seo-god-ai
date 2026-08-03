import { describe, expect, it } from 'vitest';
import { fixedClock, task } from '../test/fixtures.js';
import { DecisionSummaryModel } from './decision-summary.js';
import { ExecutionPlanModel } from './execution-plan.js';
import type { DecisionEngineInput } from '../types/input.js';

describe('DecisionSummaryModel', () => {
  const input = {
    recommendations: [{ id: 'r1' }, { id: 'r2' }],
  } as unknown as DecisionEngineInput;

  it('builds an initial zeroed summary', () => {
    expect(DecisionSummaryModel.initial(input)).toEqual({
      recommendationCount: 2,
      taskCount: 0,
      batchCount: 0,
      estimatedExecutionMinutes: 0,
      totalEffortHours: 0,
      totalImpact: 0,
      highRiskTaskCount: 0,
      approvalRequired: false,
    });
  });

  it('derives a full summary from a plan', () => {
    const plan = ExecutionPlanModel.create({
      id: 'plan-1',
      storeId: 'store-1',
      decisionId: 'decision-1',
      version: 1,
      tasks: [task({ id: 't1', risk: 'HIGH' }), task({ id: 't2', risk: 'LOW' })],
      batches: [],
      orderedTaskIds: [],
      dependencies: [],
      estimatedDurationMinutes: 5,
      totalEffortHours: 2,
      totalImpact: 90,
      risk: 'HIGH',
      now: fixedClock,
    });
    const summary = DecisionSummaryModel.forPlan(input, { ...plan, status: 'AWAITING_APPROVAL' });
    expect(summary).toMatchObject({
      recommendationCount: 2,
      taskCount: 2,
      batchCount: 0,
      estimatedExecutionMinutes: 5,
      totalEffortHours: 2,
      totalImpact: 90,
      highRiskTaskCount: 1,
      approvalRequired: true,
    });
    expect(DecisionSummaryModel.forPlan(input, plan).approvalRequired).toBe(false);
  });
});
