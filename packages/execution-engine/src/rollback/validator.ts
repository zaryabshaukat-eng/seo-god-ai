import type { ExecutionStep } from '../types/execution.js';

export interface RollbackStepValidation {
  valid: boolean;
  reason?: string;
}

/** Verifies a step can be rolled back before the engine attempts it. */
export function validateRollbackCapability(step: ExecutionStep): RollbackStepValidation {
  if (step.rollbackPlan === null) {
    return { valid: false, reason: 'no rollback plan exists for this step' };
  }
  if (!step.rollbackPlan.available) {
    return { valid: false, reason: step.rollbackPlan.reason ?? 'rollback plan is not available' };
  }
  if (step.isMutating && step.before === null) {
    return { valid: false, reason: 'no before-state recorded for this step' };
  }
  return { valid: true };
}
