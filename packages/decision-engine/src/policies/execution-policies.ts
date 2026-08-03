import type { ExecutionPolicyType, RiskAssessment } from '../types/safety.js';
import type { ApprovalMode, RiskTolerance } from '../types/input.js';
import type { FeatureFlags } from '../types/input.js';

/**
 * Execution policies gate *how* a plan may run, not *whether* it is approved.
 * BLOCKED plans can never run; HIGH_IMPACT and CONSERVATIVE plans run with
 * stricter execution constraints; SAFE plans run normally.
 */
export interface ExecutionPolicyInput {
  assessment: RiskAssessment;
  approvalMode: ApprovalMode;
  riskTolerance: RiskTolerance;
  featureFlags: FeatureFlags;
}

/** Deterministic execution-policy resolution, most restrictive first. */
export function resolveExecutionPolicy(input: ExecutionPolicyInput): ExecutionPolicyType {
  const { assessment, approvalMode, riskTolerance, featureFlags } = input;

  if (featureFlags['decision_engine.block_plans']) return 'BLOCKED';
  if (assessment.risk === 'HIGH' && !assessment.rollbackAvailable) return 'BLOCKED';
  if (assessment.risk === 'HIGH' || assessment.destructiveTaskCount > 0) return 'HIGH_IMPACT';
  if (assessment.risk === 'MEDIUM' || approvalMode === 'review' || riskTolerance === 'conservative') {
    return 'CONSERVATIVE';
  }
  return 'SAFE';
}

/**
 * Renders a short, human-readable constraint set for a resolved policy so the
 * policy is explainable in the plan and approval request.
 */
export function executionPolicyConstraints(policy: ExecutionPolicyType): string[] {
  switch (policy) {
    case 'BLOCKED':
      return ['plan must not run', 'requires manual intervention'];
    case 'HIGH_IMPACT':
      return ['requires approval', 'batch limit 1', 'requires rollback plan'];
    case 'CONSERVATIVE':
      return ['requires approval', 'reduced batch size', 'staged execution'];
    case 'SAFE':
      return ['no approval required', 'standard batching'];
  }
}
