import type { ValidationCheck, ValidationContext } from '../types/validation.js';
import { fail, ok } from './result.js';

/** Rejects executions that would conflict with an existing store lock. */
export class ConflictValidator implements ValidationCheck {
  readonly id = 'conflict';

  check(ctx: ValidationContext) {
    const lockOwner = ctx.storeLockedBy ?? null;
    if (lockOwner === null) return ok();
    if (lockOwner === ctx.execution.id) return ok();
    return fail(
      'conflict',
      'store_locked',
      `store ${ctx.execution.storeId} is locked by execution ${lockOwner}`,
      { executionId: ctx.execution.id, lockOwner },
    );
  }
}
