import type { ValidationCheck, ValidationContext } from '../types/validation.js';
import { fail, ok } from './result.js';

const REAL_MODES = new Set(['STAGING', 'PRODUCTION']);

/** Requires a rollback plan to be available for every real-mode mutation. */
export class RollbackValidator implements ValidationCheck {
  readonly id = 'rollback';

  check(ctx: ValidationContext) {
    const { step, mode } = ctx;
    if (!REAL_MODES.has(mode)) return ok();
    if (!step.isMutating) return ok();
    const plan = step.rollbackPlan;
    if (plan !== null && plan.available) return ok();
    return fail(
      'rollback',
      'rollback_unavailable',
      `no safe rollback exists for ${step.actionType} on ${step.resourceType} ${step.resourceId}: ${plan?.reason ?? 'no plan'}`,
      { stepId: step.id },
    );
  }
}
