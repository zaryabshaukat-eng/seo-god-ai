import type { ExecutionStep } from '../types/execution.js';
import type { RollbackPlan, RollbackStep } from '../types/rollback.js';
import type { RollbackStepAction } from '../types/shared.js';
import type { RollbackPlan as DecisionRollbackPlan } from '@seogod/decision-engine';

const VALID_DECISION_ACTIONS: ReadonlySet<string> = new Set(['restore_field', 'restore_position', 'recreate', 'restore', 'revert']);

export interface RollbackPlannerOptions {
  /** When set, every plan produced for real mutations is marked unavailable with this reason. */
  forceUnavailableReason?: string | null;
}

function toStepAction(action: string): RollbackStepAction {
  return (VALID_DECISION_ACTIONS.has(action) ? action : 'revert') as RollbackStepAction;
}

function fieldStepsFrom(before: Record<string, unknown>): RollbackStep[] {
  return Object.entries(before).map(([field, value]) => ({
    action: 'restore_field' as const,
    resourceType: 'unknown' as const,
    resourceId: '',
    payload: { field, value },
  }));
}

/** Converts decision-engine rollback plans and derives rollback plans from step state. */
export class RollbackPlanner {
  private readonly forceUnavailableReason: string | null;

  constructor(options: RollbackPlannerOptions = {}) {
    this.forceUnavailableReason = options.forceUnavailableReason ?? null;
  }

  /** Builds an execution rollback plan from a decision-engine plan. */
  planFromDecision(decision: DecisionRollbackPlan | null): RollbackPlan | null {
    if (decision === null) return null;
    if (!decision.available || this.forceUnavailableReason !== null) {
      return {
        available: false,
        steps: [],
        reason: decision.reason ?? (decision.available ? (this.forceUnavailableReason ?? 'unavailable') : 'decision plan marked unavailable'),
      };
    }
    const steps: RollbackStep[] = decision.steps.map((step) => ({
      action: toStepAction(step.action),
      resourceType: step.resourceType,
      resourceId: step.resourceId,
      payload: step.payload,
    }));
    return { available: steps.length > 0, steps, reason: decision.reason ?? undefined };
  }

  /** Derives a rollback plan from a step's recorded before-state. */
  planForStep(step: ExecutionStep): RollbackPlan | null {
    if (!step.isMutating) return { available: true, steps: [], reason: 'read-only step needs no rollback' };
    if (this.forceUnavailableReason !== null) {
      return { available: false, steps: [], reason: this.forceUnavailableReason };
    }
    if (step.before === null || step.before === undefined) {
      return { available: true, steps: [], reason: 'nothing was modified' };
    }
    if (Array.isArray(step.before)) {
      return { available: true, steps: [], reason: 'no field-level restore for arrays' };
    }
    if (typeof step.before === 'object') {
      const steps = fieldStepsFrom(step.before as Record<string, unknown>);
      return { available: steps.length > 0, steps, reason: undefined };
    }
    return {
      available: true,
      steps: [{ action: 'restore', resourceType: step.resourceType, resourceId: step.resourceId, payload: { before: step.before } }],
      reason: undefined,
    };
  }
}
