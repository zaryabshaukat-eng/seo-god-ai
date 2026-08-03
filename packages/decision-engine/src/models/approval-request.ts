import type { ApprovalPolicyType, ApprovalRequest, ApprovalRequestStatus } from '../types/approval.js';
import { deterministicUuid } from '../utils/ids.js';

export interface ApprovalRequestCreateInput {
  planId: string;
  decisionId: string;
  storeId: string;
  policy: ApprovalPolicyType;
  reason: string;
  requestedBy: string;
  now: () => Date;
}

/**
 * Approval request model: creation and deterministic decisions. An approval
 * request is immutable; deciding returns a copy with the decision stamped.
 */
export class ApprovalRequestModel {
  static create(input: ApprovalRequestCreateInput): ApprovalRequest {
    return {
      id: deterministicUuid('approval-request', `${input.planId}\u0000${input.policy}`),
      storeId: input.storeId,
      planId: input.planId,
      decisionId: input.decisionId,
      policy: input.policy,
      status: 'PENDING',
      reason: input.reason,
      requestedBy: input.requestedBy,
      decidedBy: null,
      decidedAt: null,
      createdAt: input.now(),
    };
  }

  static fromRecord(record: ApprovalRequest): ApprovalRequest {
    return { ...record };
  }

  static decide(
    request: ApprovalRequest,
    decision: Exclude<ApprovalRequestStatus, 'PENDING'>,
    decidedBy: string,
    now: () => Date,
  ): ApprovalRequest {
    return { ...request, status: decision, decidedBy, decidedAt: now() };
  }
}
