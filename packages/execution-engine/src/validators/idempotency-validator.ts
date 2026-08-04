import type { ValidationCheck, ValidationContext } from '../types/validation.js';
import { fail, ok } from './result.js';

/** Rejects already-applied executions using the stable idempotency key. */
export class IdempotencyValidator implements ValidationCheck {
  readonly id = 'idempotency';

  check(ctx: ValidationContext) {
    const keys = ctx.existingKeys ?? [];
    if (keys.includes(ctx.step.idempotencyKey)) {
      return fail(
        'idempotency',
        'already_applied',
        `step ${ctx.step.id} was already applied for this store/resource/action`,
        { stepId: ctx.step.id, idempotencyKey: ctx.step.idempotencyKey },
      );
    }
    return ok();
  }
}
