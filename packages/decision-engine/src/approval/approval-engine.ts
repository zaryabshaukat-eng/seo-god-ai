import type { ApprovalRequest, ApprovalRequestStatus } from '../types/approval.js';
import type { ExecutionPlan, PlanStatus } from '../types/plan.js';
import type { RiskAssessment } from '../types/safety.js';
import type { DecisionContext } from '../types/input.js';
import { resolveApprovalPolicy } from '../policies/approval-policies.js';
import { ApprovalRequestModel } from '../models/approval-request.js';

export interface ApprovalReviewInput {
  plan: ExecutionPlan;
  assessment: RiskAssessment;
  context: DecisionContext;
  now: () => Date;
}

export interface ApprovalReviewResult {
  planStatus: PlanStatus;
  approvalRequest: ApprovalRequest;
}

/**
 * Deterministic approval engine. Reviews a plan's risk assessment against the
 * store's approval policies and produces an approval request plus the plan
 * status the review implies (APPROVED / AWAITING_APPROVAL / REJECTED).
 */
export class ApprovalEngine {
  review(input: ApprovalReviewInput): ApprovalReviewResult {
    const { plan, assessment, context } = input;
    const resolution = resolveApprovalPolicy(assessment, {
      approvalMode: context.storeSettings.approvalMode,
      featureFlags: context.featureFlags,
    });
    const request = ApprovalRequestModel.create({
      planId: plan.id,
      decisionId: plan.decisionId,
      storeId: plan.storeId,
      policy: resolution.policy,
      reason: resolution.reasons.join('; '),
      requestedBy: context.requestedBy,
      now: input.now,
    });
    switch (resolution.policy) {
      case 'AUTO_APPROVE':
        return {
          planStatus: 'APPROVED',
          approvalRequest: ApprovalRequestModel.decide(request, 'APPROVED', 'system', input.now),
        };
      case 'DENY':
        return {
          planStatus: 'REJECTED',
          approvalRequest: ApprovalRequestModel.decide(request, 'REJECTED', 'system', input.now),
        };
      case 'REQUIRE_APPROVAL':
        return { planStatus: 'AWAITING_APPROVAL', approvalRequest: request };
    }
  }

  /** Records a human decision on a pending approval request. */
  decide(
    request: ApprovalRequest,
    decision: Exclude<ApprovalRequestStatus, 'PENDING'>,
    decidedBy: string,
    now: () => Date,
  ): ApprovalRequest {
    return ApprovalRequestModel.decide(request, decision, decidedBy, now);
  }
}
