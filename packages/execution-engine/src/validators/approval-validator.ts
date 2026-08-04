import type { ValidationCheck, ValidationContext } from '../types/validation.js';
import { fail, ok } from './result.js';

/** Rejects any step that requires approval without an approval record. */
export class ApprovalValidator implements ValidationCheck {
  readonly id = 'approval';

  check(ctx: ValidationContext) {
    const { step } = ctx;
    if (!step.requiresApproval) return ok();
    if (step.approved) return ok();
    if (ctx.approval?.approved === true) return ok();
    return fail(
      'approval',
      'approval_required',
      `step ${step.id} (${step.actionType} on ${step.resourceType} ${step.resourceId}) requires approval`,
      { stepId: step.id, requestId: ctx.approval?.requestId },
    );
  }
}
