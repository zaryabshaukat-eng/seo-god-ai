import type { ValidationCheck, ValidationContext } from '../types/validation.js';
import { fail, ok } from './result.js';

const REAL_MODES = new Set(['STAGING', 'PRODUCTION']);

/** Gates writes on the publisher's current rate budget. */
export class RateLimitValidator implements ValidationCheck {
  readonly id = 'rate_limit';

  check(ctx: ValidationContext) {
    if (!REAL_MODES.has(ctx.mode)) return ok();
    if (!ctx.step.isMutating) return ok();
    if (ctx.hasRateBudget) return ok();
    return fail(
      'rate_limit',
      'rate_limit_exhausted',
      `write rate budget exhausted for store ${ctx.execution.storeId}`,
      { stepId: ctx.step.id },
    );
  }
}
