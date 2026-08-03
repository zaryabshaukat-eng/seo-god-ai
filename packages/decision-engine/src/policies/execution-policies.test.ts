import { describe, expect, it } from 'vitest';
import { executionPolicyConstraints, resolveExecutionPolicy } from './execution-policies.js';
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

function input(overrides: Partial<Parameters<typeof resolveExecutionPolicy>[0]> = {}) {
  return {
    assessment: assessment(),
    approvalMode: 'auto' as const,
    riskTolerance: 'balanced' as const,
    featureFlags: {},
    ...overrides,
  };
}

describe('resolveExecutionPolicy', () => {
  it('blocks when the block flag is set', () => {
    expect(
      resolveExecutionPolicy(input({ featureFlags: { 'decision_engine.block_plans': true } })),
    ).toBe('BLOCKED');
  });

  it('blocks high risk without rollback safety', () => {
    expect(
      resolveExecutionPolicy(input({ assessment: assessment({ risk: 'HIGH', rollbackAvailable: false }) })),
    ).toBe('BLOCKED');
  });

  it('classifies high risk as HIGH_IMPACT', () => {
    expect(resolveExecutionPolicy(input({ assessment: assessment({ risk: 'HIGH' }) }))).toBe(
      'HIGH_IMPACT',
    );
  });

  it('classifies any destructive work as HIGH_IMPACT', () => {
    expect(
      resolveExecutionPolicy(input({ assessment: assessment({ destructiveTaskCount: 1 }) })),
    ).toBe('HIGH_IMPACT');
  });

  it('classifies medium risk, review mode, or conservative tolerance as CONSERVATIVE', () => {
    expect(resolveExecutionPolicy(input({ assessment: assessment({ risk: 'MEDIUM' }) }))).toBe(
      'CONSERVATIVE',
    );
    expect(resolveExecutionPolicy(input({ approvalMode: 'review' }))).toBe('CONSERVATIVE');
    expect(resolveExecutionPolicy(input({ riskTolerance: 'conservative' }))).toBe('CONSERVATIVE');
  });

  it('classifies everything else as SAFE', () => {
    expect(resolveExecutionPolicy(input())).toBe('SAFE');
  });
});

describe('executionPolicyConstraints', () => {
  it('renders constraints for every policy', () => {
    expect(executionPolicyConstraints('BLOCKED')).toHaveLength(2);
    expect(executionPolicyConstraints('HIGH_IMPACT')).toContain('requires rollback plan');
    expect(executionPolicyConstraints('CONSERVATIVE')).toContain('reduced batch size');
    expect(executionPolicyConstraints('SAFE')).toContain('standard batching');
  });
});
