import { describe, expect, it } from 'vitest';
import { decisionInput, fixedClock, STORE_ID } from '../test/fixtures.js';
import { decisionContextFromInput } from '../prioritizer/prioritizer.js';
import { ExecutionPlanModel } from '../models/execution-plan.js';
import { ApprovalRequestModel } from '../models/approval-request.js';
import { ApprovalEngine } from './approval-engine.js';
import type { RiskAssessment } from '../types/safety.js';

function assessment(overrides: Partial<RiskAssessment> = {}): RiskAssessment {
  return {
    risk: 'LOW',
    riskScore: 20,
    mutatingTaskCount: 1,
    destructiveTaskCount: 0,
    rollbackAvailable: true,
    requiresApproval: false,
    approvalPolicy: 'AUTO_APPROVE',
    executionPolicy: 'SAFE',
    reasons: ['Risk classified as LOW'],
    ...overrides,
  };
}

function plan(risk: RiskAssessment['risk'] = 'LOW') {
  return ExecutionPlanModel.create({
    id: 'plan-1',
    storeId: STORE_ID,
    decisionId: 'decision-1',
    version: 1,
    tasks: [],
    batches: [],
    orderedTaskIds: [],
    dependencies: [],
    estimatedDurationMinutes: 1,
    totalEffortHours: 0,
    totalImpact: 0,
    risk,
    now: fixedClock,
  });
}

const engine = new ApprovalEngine();

describe('ApprovalEngine.review', () => {
  it('auto-approves low-risk plans in auto mode', () => {
    const result = engine.review({
      plan: plan(),
      assessment: assessment(),
      context: decisionContextFromInput(decisionInput()),
      now: fixedClock,
    });
    expect(result.planStatus).toBe('APPROVED');
    expect(result.approvalRequest.status).toBe('APPROVED');
    expect(result.approvalRequest.decidedBy).toBe('system');
    expect(result.approvalRequest.policy).toBe('AUTO_APPROVE');
  });

  it('holds plans awaiting approval for medium risk', () => {
    const result = engine.review({
      plan: plan('MEDIUM'),
      assessment: assessment({ risk: 'MEDIUM' }),
      context: decisionContextFromInput(decisionInput()),
      now: fixedClock,
    });
    expect(result.planStatus).toBe('AWAITING_APPROVAL');
    expect(result.approvalRequest.status).toBe('PENDING');
    expect(result.approvalRequest.requestedBy).toBe('test-user');
  });

  it('rejects high-risk plans in review mode', () => {
    const reviewContext = decisionContextFromInput(decisionInput());
    reviewContext.storeSettings.approvalMode = 'review';
    const result = engine.review({
      plan: plan('HIGH'),
      assessment: assessment({ risk: 'HIGH' }),
      context: reviewContext,
      now: fixedClock,
    });
    expect(result.planStatus).toBe('REJECTED');
    expect(result.approvalRequest.status).toBe('REJECTED');
  });
});

describe('ApprovalEngine.decide', () => {
  it('records a human decision on a pending request', () => {
    const request = ApprovalRequestModel.create({
      planId: 'plan-1',
      decisionId: 'decision-1',
      storeId: STORE_ID,
      policy: 'REQUIRE_APPROVAL',
      reason: 'reason',
      requestedBy: 'system',
      now: fixedClock,
    });
    const decided = engine.decide(request, 'APPROVED', 'alice', fixedClock);
    expect(decided.status).toBe('APPROVED');
    expect(decided.decidedBy).toBe('alice');
    expect(decided.decidedAt).toEqual(fixedClock());
  });
});
