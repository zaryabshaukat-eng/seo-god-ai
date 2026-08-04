import type { ValidationCheck, ValidationContext } from '../types/validation.js';
import { fail, ok } from './result.js';

const REAL_MODES = new Set(['STAGING', 'PRODUCTION']);

/** Enforces write permissions: real modes need the write pipeline, and the
 * step's operation must be supported by the deployed writer capabilities. */
export class PermissionValidator implements ValidationCheck {
  readonly id = 'permission';

  check(ctx: ValidationContext) {
    const { step, mode } = ctx;
    if (!REAL_MODES.has(mode)) return ok();
    if (!step.isMutating) return ok();
    if (!ctx.canWrite) {
      return fail(
        'permission',
        'write_denied',
        `writes are not permitted in mode ${mode}`,
        { stepId: step.id },
      );
    }
    const capability = ctx.operationCapability ?? null;
    if (capability !== null) {
      const capabilities = ctx.writerCapabilities ?? [];
      if (!capabilities.includes(capability)) {
        return fail(
          'permission',
          'capability_missing',
          `writer lacks capability "${capability}" for ${step.actionType} on ${step.resourceType}`,
          { stepId: step.id, capability },
        );
      }
    }
    return ok();
  }
}
