import type { ApprovalPolicyType } from '../types/approval.js';
import type { ApprovalMode } from '../types/input.js';
import type { RiskAssessment } from '../types/safety.js';
import type { FeatureFlags } from '../types/input.js';

/**
 * Approval policies translate a risk assessment into an approval decision.
 * Rules are evaluated in order; the first matching rule wins, which keeps the
 * outcome fully deterministic.
 */
export interface ApprovalPolicyRule {
  name: string;
  /** Returns the decision when the rule fires, else null. */
  when: (assessment: RiskAssessment, input: ApprovalPolicyContext) => ApprovalPolicyType | null;
  reason: string;
}

export interface ApprovalPolicyContext {
  approvalMode: ApprovalMode;
  featureFlags: FeatureFlags;
}

/** Built-in, ordered approval rules. */
export const APPROVAL_POLICY_RULES: readonly ApprovalPolicyRule[] = [
  {
    name: 'block-high-risk-without-rollback',
    when: (assessment, context) => {
      if (
        assessment.risk === 'HIGH' &&
        !assessment.rollbackAvailable &&
        context.featureFlags['decision_engine.block_high_risk']
      ) {
        return 'DENY';
      }
      return null;
    },
    reason: 'High-risk plan without rollback safety and the block flag enabled',
  },
  {
    name: 'deny-when-flag',
    when: (_assessment, context) =>
      context.featureFlags['decision_engine.deny_plans'] ? 'DENY' : null,
    reason: 'The deny_plans feature flag is enabled',
  },
  {
    name: 'deny-conservative-high-risk',
    when: (assessment, context) => {
      if (assessment.risk === 'HIGH' && context.approvalMode === 'review') return 'DENY';
      return null;
    },
    reason: 'Conservative store review mode blocks high-risk plans',
  },
  {
    name: 'require-approval-when-flag',
    when: (_assessment, context) =>
      context.featureFlags['decision_engine.require_approval'] ? 'REQUIRE_APPROVAL' : null,
    reason: 'The require_approval feature flag is enabled',
  },
  {
    name: 'require-approval-on-risk',
    when: (assessment, context) => {
      if (assessment.risk === 'HIGH' || assessment.risk === 'MEDIUM') return 'REQUIRE_APPROVAL';
      if (context.approvalMode === 'review') return 'REQUIRE_APPROVAL';
      return null;
    },
    reason: 'Plan carries medium-or-high risk or the store runs in review mode',
  },
  {
    name: 'auto-approve-low-risk',
    when: (assessment, context) => {
      if (
        assessment.risk === 'LOW' &&
        context.featureFlags['decision_engine.allow_auto_approve'] !== false
      ) {
        return 'AUTO_APPROVE';
      }
      return null;
    },
    reason: 'Low-risk plan with rollback safety in auto mode',
  },
  {
    name: 'default-require-approval',
    when: () => 'REQUIRE_APPROVAL',
    reason: 'No rule matched; approval is required by default',
  },
];

export interface PolicyResolution {
  policy: ApprovalPolicyType;
  reasons: string[];
}

/**
 * Resolves the approval policy for a plan by running the ordered rule list
 * against the assessment. First match wins; the reason is recorded.
 */
export function resolveApprovalPolicy(
  assessment: RiskAssessment,
  context: ApprovalPolicyContext,
): PolicyResolution {
  for (const rule of APPROVAL_POLICY_RULES) {
    const policy = rule.when(assessment, context);
    if (policy !== null) {
      return { policy, reasons: [rule.reason] };
    }
  }
  return { policy: 'REQUIRE_APPROVAL', reasons: ['No rule matched; approval required by default'] };
}
