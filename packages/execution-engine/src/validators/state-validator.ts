import type { ValidationCheck, ValidationContext } from '../types/validation.js';
import { fail, ok } from './result.js';

const REAL_MODES = new Set(['STAGING', 'PRODUCTION']);

/** Requires the current Shopify state to have been checked before a write. */
export class StateValidator implements ValidationCheck {
  readonly id = 'state';

  check(ctx: ValidationContext) {
    const { step, config, mode } = ctx;
    if (!REAL_MODES.has(mode)) return ok();
    if (!config.requireStateCheck || !step.isMutating) return ok();
    if (step.resourceType === 'store') return ok();
    if (step.actionType === 'create_page') return ok();
    if (ctx.resourceState !== undefined && ctx.resourceState !== null) return ok();
    return fail(
      'state',
      'state_not_checked',
      `current state for ${step.resourceType} ${step.resourceId} was not verified before execution`,
      { stepId: step.id },
    );
  }
}
