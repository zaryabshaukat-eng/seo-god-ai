import type { RiskAssessment, RiskFactors } from '../types/safety.js';
import type { ExecutionTask, TaskActionType } from '../types/plan.js';
import type { DecisionContext, RiskTolerance } from '../types/input.js';
import { resolveApprovalPolicy } from '../policies/approval-policies.js';
import { resolveExecutionPolicy } from '../policies/execution-policies.js';
import { clamp, reachFactor, smoothedRate } from '../utils/scoring.js';

/** Actions that are never destructive to store data. */
const NON_MUTATING_ACTIONS: ReadonlySet<TaskActionType> = new Set<TaskActionType>(['custom']);

/** Actions that change content wholesale and cannot be safely reverted. */
const DESTRUCTIVE_ACTIONS: ReadonlySet<TaskActionType> = new Set<TaskActionType>([
  'delete_page',
  'remove_structured_data',
  'remove_image',
  'remove_internal_links',
  'remove_redirect',
]);

/** Actions whose previous value can be captured and restored. */
const ROLLBACK_AVAILABLE_ACTIONS: ReadonlySet<TaskActionType> = new Set<TaskActionType>([
  'update_title',
  'update_meta_description',
  'update_description',
  'update_meta',
  'update_url',
  'update_alt_text',
  'update_canonical',
  'update_robots',
  'add_structured_data',
  'create_page',
  'update_collection',
  'update_product',
  'update_blog',
  'update_article',
]);

/** Whether an action writes store data (drives rollback requirements). */
export function isMutatingAction(actionType: TaskActionType): boolean {
  return !NON_MUTATING_ACTIONS.has(actionType);
}

/** Whether an action is destructive (removes or rewrites large content). */
export function isDestructiveAction(actionType: TaskActionType): boolean {
  return DESTRUCTIVE_ACTIONS.has(actionType);
}

/** Whether a previous state can be captured and restored for this action. */
export function hasRollbackPotential(actionType: TaskActionType): boolean {
  return ROLLBACK_AVAILABLE_ACTIONS.has(actionType);
}

/** Deterministic risk adjustment by store risk tolerance. */
export function riskToleranceAdjustment(tolerance: RiskTolerance): number {
  switch (tolerance) {
    case 'conservative':
      return 10;
    case 'aggressive':
      return -10;
    case 'balanced':
      return 0;
  }
}

export interface SafetyEngineOptions {
  /** Overrides for the additive risk-tolerance adjustment. */
  riskToleranceAdjustments?: Partial<Record<RiskTolerance, number>>;
}

/**
 * Deterministic safety assessment. Computes a 0..100 risk score from the
 * mutating/destructive mix, reach, business-value exposure, historical
 * failure rate, and rollback safety, then resolves the approval and execution
 * policies that govern the plan.
 */
export class SafetyEngine {
  private readonly adjustments: Partial<Record<RiskTolerance, number>>;

  constructor(options: SafetyEngineOptions = {}) {
    this.adjustments = options.riskToleranceAdjustments ?? {};
  }

  assess(tasks: ExecutionTask[], context: DecisionContext): RiskAssessment {
    const factors = this.riskFactors(tasks, context);
    const score = this.riskScore(factors, context.storeSettings.riskTolerance);
    const risk = this.levelFromScore(score);

    const base: RiskAssessment = {
      risk,
      riskScore: score,
      mutatingTaskCount: tasks.filter((task) => task.isMutating).length,
      destructiveTaskCount: tasks.filter((task) => isDestructiveAction(task.actionType)).length,
      rollbackAvailable: factors.rollbackAvailable,
      requiresApproval: false,
      approvalPolicy: 'AUTO_APPROVE',
      executionPolicy: 'SAFE',
      reasons: [],
    };
    const approval = resolveApprovalPolicy(base, {
      approvalMode: context.storeSettings.approvalMode,
      featureFlags: context.featureFlags,
    });
    const executionPolicy = resolveExecutionPolicy({
      assessment: base,
      approvalMode: context.storeSettings.approvalMode,
      riskTolerance: context.storeSettings.riskTolerance,
      featureFlags: context.featureFlags,
    });

    return {
      ...base,
      requiresApproval: approval.policy !== 'AUTO_APPROVE',
      approvalPolicy: approval.policy,
      executionPolicy,
      reasons: this.reasons(factors, risk),
    };
  }

  riskFactors(tasks: ExecutionTask[], context: DecisionContext): RiskFactors {
    const mutating = tasks.filter((task) => task.isMutating);
    const destructive = tasks.filter((task) => isDestructiveAction(task.actionType));
    const destructiveRatio = mutating.length === 0 ? 0 : destructive.length / mutating.length;
    const destructiveSeverity = destructive.some((task) => task.actionType === 'delete_page')
      ? 1
      : destructive.length > 0
        ? 0.7
        : 0;
    const avgPriority =
      tasks.length === 0 ? 0 : tasks.reduce((sum, task) => sum + task.priority, 0) / tasks.length;
    const rules = [...new Set(tasks.map((task) => task.rule))];
    const failureRates = rules.map((rule) => {
      const outcome = context.historicalOutcomes.find((entry) => entry.rule === rule);
      if (outcome === undefined) return 0;
      return 1 - smoothedRate(outcome.attempts, outcome.successes, 0.5);
    });
    const historicalFailureRate =
      failureRates.length === 0 ? 0 : failureRates.reduce((sum, rate) => sum + rate, 0) / failureRates.length;
    const rollbackAvailable =
      mutating.length === 0 ||
      mutating.every((task) => task.rollback !== null && task.rollback.available);
    return {
      destructiveRatio,
      destructiveSeverity,
      businessValue: avgPriority / 100,
      historicalFailureRate,
      rollbackAvailable,
      taskCount: tasks.length,
    };
  }

  riskScore(factors: RiskFactors, tolerance: RiskTolerance): number {
    const toleranceAdjustment =
      this.adjustments[tolerance] ?? riskToleranceAdjustment(tolerance);
    const raw =
      25 +
      factors.destructiveSeverity * 30 +
      factors.destructiveRatio * 20 +
      reachFactor(factors.taskCount, 50) * 10 +
      factors.businessValue * 15 +
      factors.historicalFailureRate * 20 +
      toleranceAdjustment +
      (factors.rollbackAvailable ? 0 : 15);
    return Math.round(clamp(raw, 0, 100));
  }

  levelFromScore(score: number): RiskAssessment['risk'] {
    if (score < 35) return 'LOW';
    if (score < 65) return 'MEDIUM';
    return 'HIGH';
  }

  private reasons(factors: RiskFactors, risk: RiskAssessment['risk']): string[] {
    const reasons: string[] = [`Risk classified as ${risk}`];
    if (factors.destructiveSeverity > 0) {
      reasons.push(`Destructive actions present (severity ${factors.destructiveSeverity.toFixed(1)})`);
    }
    if (factors.destructiveRatio > 0) {
      reasons.push(`Destructive ratio ${Math.round(factors.destructiveRatio * 100)}%`);
    }
    if (factors.historicalFailureRate > 0.2) {
      reasons.push(`Historical failure rate ${Math.round(factors.historicalFailureRate * 100)}%`);
    }
    if (!factors.rollbackAvailable) {
      reasons.push('Not every mutating task has a rollback plan');
    }
    return reasons;
  }
}
