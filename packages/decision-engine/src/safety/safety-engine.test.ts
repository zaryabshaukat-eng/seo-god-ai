import { describe, expect, it } from 'vitest';
import { decisionInput, ORIGIN, STORE_ID, task } from '../test/fixtures.js';
import { decisionContextFromInput } from '../prioritizer/prioritizer.js';
import {
  hasRollbackPotential,
  isDestructiveAction,
  isMutatingAction,
  riskToleranceAdjustment,
  SafetyEngine,
} from './safety-engine.js';
import type { ExecutionTask } from '../types/plan.js';
import type { DecisionEngineInput } from '../types/input.js';
import type { RollbackPlan } from '../types/result.js';

function availableRollback(taskId: string, actionType: ExecutionTask['actionType'] = 'update_title'): RollbackPlan {
  return {
    taskId,
    storeId: STORE_ID,
    planId: 'plan-1',
    actionType,
    resourceType: 'page',
    resourceId: `${ORIGIN}/p/1`,
    available: true,
    reason: 'previous field values will be restored',
    steps: [],
  };
}

function context(overrides: Partial<DecisionEngineInput> = {}) {
  return decisionContextFromInput(decisionInput(overrides));
}

describe('action classification helpers', () => {
  it('treats only custom as non-mutating', () => {
    expect(isMutatingAction('custom')).toBe(false);
    expect(isMutatingAction('update_title')).toBe(true);
  });

  it('classifies destructive actions', () => {
    expect(isDestructiveAction('delete_page')).toBe(true);
    expect(isDestructiveAction('remove_redirect')).toBe(true);
    expect(isDestructiveAction('update_title')).toBe(false);
  });

  it('knows which actions can be rolled back', () => {
    expect(hasRollbackPotential('update_title')).toBe(true);
    expect(hasRollbackPotential('delete_page')).toBe(false);
  });
});

describe('riskToleranceAdjustment', () => {
  it('adjusts the score by tolerance', () => {
    expect(riskToleranceAdjustment('conservative')).toBe(10);
    expect(riskToleranceAdjustment('aggressive')).toBe(-10);
    expect(riskToleranceAdjustment('balanced')).toBe(0);
  });
});

describe('SafetyEngine.riskFactors', () => {
  it('computes factors from the task mix', () => {
    const engine = new SafetyEngine();
    const tasks = [
      task({ id: 'a', priority: 90, actionType: 'delete_page' }),
      task({ id: 'b', priority: 80, rollback: availableRollback('b') }),
    ];
    const factors = engine.riskFactors(tasks, context());
    expect(factors.destructiveRatio).toBe(0.5);
    expect(factors.destructiveSeverity).toBe(1);
    expect(factors.businessValue).toBeCloseTo(0.85, 5);
    expect(factors.rollbackAvailable).toBe(false);
    expect(factors.taskCount).toBe(2);
  });

  it('counts historical failure rates per rule', () => {
    const engine = new SafetyEngine();
    const tasks = [task({ id: 'a', rule: 'missing-title', rollback: availableRollback('a') })];
    const ctx = decisionContextFromInput(
      decisionInput({
        historicalOutcomes: [{ rule: 'missing-title', attempts: 2, successes: 0, averageImpact: 0 }],
      }),
    );
    const factors = engine.riskFactors(tasks, ctx);
    expect(factors.historicalFailureRate).toBeGreaterThan(0);
  });

  it('scores non-delete destructive actions at 0.7 severity', () => {
    const engine = new SafetyEngine();
    const tasks = [
      task({ id: 'rm', actionType: 'remove_redirect', priority: 90, rollback: availableRollback('rm', 'remove_redirect') }),
    ];
    const factors = engine.riskFactors(tasks, context());
    expect(factors.destructiveRatio).toBe(1);
    expect(factors.destructiveSeverity).toBe(0.7);
  });

  it('scores empty and non-mutating task sets safely', () => {
    const engine = new SafetyEngine();
    const empty = engine.riskFactors([], context());
    expect(empty.destructiveRatio).toBe(0);
    expect(empty.businessValue).toBe(0);
    const nonMutating = engine.riskFactors(
      [task({ id: 'c', actionType: 'custom', isMutating: false })],
      context(),
    );
    expect(nonMutating.destructiveRatio).toBe(0);
    expect(nonMutating.rollbackAvailable).toBe(true);
  });
});

describe('SafetyEngine.assess', () => {
  it('classifies a benign single task as LOW and auto-approves', () => {
    const engine = new SafetyEngine();
    const tasks = [task({ id: 'a', priority: 0, rollback: availableRollback('a') })];
    const assessment = engine.assess(tasks, context());
    expect(assessment.risk).toBe('LOW');
    expect(assessment.requiresApproval).toBe(false);
    expect(assessment.approvalPolicy).toBe('AUTO_APPROVE');
    expect(assessment.executionPolicy).toBe('SAFE');
    expect(assessment.reasons[0]).toBe('Risk classified as LOW');
  });

  it('requires approval for medium risk', () => {
    const engine = new SafetyEngine();
    const tasks = [task({ id: 'a', priority: 80, rollback: availableRollback('a') })];
    const assessment = engine.assess(tasks, context());
    expect(assessment.risk).toBe('MEDIUM');
    expect(assessment.requiresApproval).toBe(true);
    expect(assessment.approvalPolicy).toBe('REQUIRE_APPROVAL');
    expect(assessment.executionPolicy).toBe('CONSERVATIVE');
  });

  it('flags high risk for destructive work and blocks under the block flag', () => {
    const engine = new SafetyEngine();
    const tasks = [
      task({ id: 'del', priority: 90, actionType: 'delete_page' }),
      task({ id: 'upd', priority: 80, rollback: availableRollback('upd') }),
    ];
    const assessment = engine.assess(tasks, context());
    expect(assessment.risk).toBe('HIGH');
    expect(assessment.destructiveTaskCount).toBe(1);
    expect(assessment.mutatingTaskCount).toBe(2);

    const blocked = engine.assess(tasks, context({ featureFlags: { 'decision_engine.block_plans': true } }));
    expect(blocked.executionPolicy).toBe('BLOCKED');
  });

  it('denies when the block-high-risk flag is set and no rollback is available', () => {
    const engine = new SafetyEngine();
    const tasks = [task({ id: 'del', priority: 90, actionType: 'delete_page' })];
    const assessment = engine.assess(
      tasks,
      context({ featureFlags: { 'decision_engine.block_high_risk': true } }),
    );
    expect(assessment.approvalPolicy).toBe('DENY');
  });

  it('honors custom risk tolerance adjustments', () => {
    const engine = new SafetyEngine({ riskToleranceAdjustments: { balanced: -40 } });
    const tasks = [task({ id: 'a', priority: 0, rollback: availableRollback('a') })];
    const assessment = engine.assess(tasks, context());
    expect(assessment.risk).toBe('LOW');
  });

  it('warns when rollback is missing for a mutating task', () => {
    const engine = new SafetyEngine();
    const tasks = [task({ id: 'a', priority: 0, rollback: null })];
    const assessment = engine.assess(tasks, context());
    expect(assessment.rollbackAvailable).toBe(false);
    expect(assessment.reasons).toContain('Not every mutating task has a rollback plan');
  });

  it('warns about a high historical failure rate', () => {
    const engine = new SafetyEngine();
    const tasks = [task({ id: 'a', rollback: availableRollback('a') })];
    const assessment = engine.assess(
      tasks,
      decisionContextFromInput(
        decisionInput({
          historicalOutcomes: [{ rule: 'missing-title', attempts: 2, successes: 0, averageImpact: 0 }],
        }),
      ),
    );
    expect(assessment.reasons.some((reason) => reason.startsWith('Historical failure rate'))).toBe(
      true,
    );
  });
});

describe('SafetyEngine risk scoring', () => {
  it('levels scores at the thresholds', () => {
    const engine = new SafetyEngine();
    expect(engine.levelFromScore(20)).toBe('LOW');
    expect(engine.levelFromScore(35)).toBe('MEDIUM');
    expect(engine.levelFromScore(65)).toBe('HIGH');
  });

  it('rounds and clamps the risk score', () => {
    const engine = new SafetyEngine();
    const factors = {
      destructiveRatio: 0,
      destructiveSeverity: 0,
      businessValue: 0,
      historicalFailureRate: 0,
      rollbackAvailable: true,
      taskCount: 0,
    };
    expect(engine.riskScore(factors, 'balanced')).toBe(25);
  });
});
