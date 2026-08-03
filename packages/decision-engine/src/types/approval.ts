/**
 * Approval types. An {@link ApprovalRequest} records which policy governed a
 * plan and who decided, when. Policies are resolved deterministically by the
 * approval engine from risk + store settings + feature flags.
 */

export type ApprovalPolicyType = 'AUTO_APPROVE' | 'REQUIRE_APPROVAL' | 'DENY';

export type ApprovalRequestStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export interface ApprovalRequest {
  id: string;
  storeId: string;
  planId: string;
  decisionId: string;
  policy: ApprovalPolicyType;
  status: ApprovalRequestStatus;
  /** Why this policy was chosen. */
  reason: string;
  requestedBy: string;
  decidedBy: string | null;
  decidedAt: Date | null;
  createdAt: Date;
}
