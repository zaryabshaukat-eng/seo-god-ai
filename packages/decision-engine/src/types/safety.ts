/**
 * Safety and policy types. {@link RiskAssessment} is the deterministic risk
 * model for a plan; the approval and execution policy layers translate it into
 * an approval decision and an execution posture.
 */

import type { ApprovalPolicyType } from './approval.js';
import type { RiskLevel } from './result.js';

export type ExecutionPolicyType = 'SAFE' | 'CONSERVATIVE' | 'HIGH_IMPACT' | 'BLOCKED';

export interface RiskAssessment {
  risk: RiskLevel;
  riskScore: number;
  mutatingTaskCount: number;
  destructiveTaskCount: number;
  rollbackAvailable: boolean;
  requiresApproval: boolean;
  approvalPolicy: ApprovalPolicyType;
  executionPolicy: ExecutionPolicyType;
  /** Ordered reasons for the assessment, most important first. */
  reasons: string[];
}

export interface RiskFactors {
  /** 0..1 fraction of tasks that are destructive. */
  destructiveRatio: number;
  /** 0..1 — severity of destructive actions present. */
  destructiveSeverity: number;
  /** 0..1 — business value exposure (money pages, revenue tier). */
  businessValue: number;
  /** 0..1 — historical failure rate across included rules. */
  historicalFailureRate: number;
  /** Whether a rollback exists for every mutating task. */
  rollbackAvailable: boolean;
  /** Task count driving reach. */
  taskCount: number;
}
