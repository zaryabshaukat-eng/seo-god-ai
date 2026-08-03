import { describe, expect, it } from 'vitest';
import { APPROVAL_POLICY_RULES, resolveApprovalPolicy } from './approval-policies.js';
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

describe('resolveApprovalPolicy', () => {
  it('denies high-risk plans without rollback under the block flag', () => {
    const result = resolveApprovalPolicy(
      assessment({ risk: 'HIGH', rollbackAvailable: false }),
      { approvalMode: 'auto', featureFlags: { 'decision_engine.block_high_risk': true } },
    );
    expect(result.policy).toBe('DENY');
    expect(result.reasons).toHaveLength(1);
  });

  it('denies when the deny flag is set', () => {
    const result = resolveApprovalPolicy(
      assessment(),
      { approvalMode: 'auto', featureFlags: { 'decision_engine.deny_plans': true } },
    );
    expect(result.policy).toBe('DENY');
  });

  it('denies high-risk plans in review mode', () => {
    const result = resolveApprovalPolicy(assessment({ risk: 'HIGH' }), {
      approvalMode: 'review',
      featureFlags: {},
    });
    expect(result.policy).toBe('DENY');
  });

  it('requires approval when the flag is set', () => {
    const result = resolveApprovalPolicy(assessment(), {
      approvalMode: 'auto',
      featureFlags: { 'decision_engine.require_approval': true },
    });
    expect(result.policy).toBe('REQUIRE_APPROVAL');
  });

  it('requires approval for medium or high risk', () => {
    expect(
      resolveApprovalPolicy(assessment({ risk: 'MEDIUM' }), { approvalMode: 'auto', featureFlags: {} }).policy,
    ).toBe('REQUIRE_APPROVAL');
    expect(
      resolveApprovalPolicy(assessment({ risk: 'HIGH' }), { approvalMode: 'auto', featureFlags: {} }).policy,
    ).toBe('REQUIRE_APPROVAL');
  });

  it('requires approval in review mode', () => {
    expect(
      resolveApprovalPolicy(assessment(), { approvalMode: 'review', featureFlags: {} }).policy,
    ).toBe('REQUIRE_APPROVAL');
  });

  it('auto-approves low-risk plans in auto mode', () => {
    expect(
      resolveApprovalPolicy(assessment(), { approvalMode: 'auto', featureFlags: {} }).policy,
    ).toBe('AUTO_APPROVE');
  });

  it('falls back to require approval when nothing matches', () => {
    const result = resolveApprovalPolicy(assessment({ risk: 'LOW', rollbackAvailable: false }), {
      approvalMode: 'auto',
      featureFlags: { 'decision_engine.allow_auto_approve': false },
    });
    expect(result.policy).toBe('REQUIRE_APPROVAL');
  });

  it('evaluates rules in a stable order', () => {
    expect(APPROVAL_POLICY_RULES.length).toBeGreaterThan(0);
    expect(APPROVAL_POLICY_RULES[0]!.name).toBe('block-high-risk-without-rollback');
    expect(APPROVAL_POLICY_RULES.at(-1)!.name).toBe('default-require-approval');
  });
});
