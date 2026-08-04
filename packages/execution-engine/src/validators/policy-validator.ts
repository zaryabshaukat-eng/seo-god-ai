import type { ValidationCheck, ValidationContext } from '../types/validation.js';
import { fail, ok } from './result.js';
import { isModeAllowed } from '../safety/config.js';

/** Applies execution policies and feature-flag gating to the whole run. */
export class PolicyValidator implements ValidationCheck {
  readonly id = 'policy';

  check(ctx: ValidationContext) {
    const { execution, config } = ctx;
    if (!isModeAllowed(execution.mode, config)) {
      return fail(
        'policy',
        'mode_not_allowed',
        `mode ${execution.mode} is not allowed by the safety configuration`,
        { executionId: execution.id },
      );
    }
    const productionFlag = config.featureFlags['allow-production'];
    if (productionFlag === false && execution.mode === 'PRODUCTION') {
      return fail(
        'policy',
        'production_disabled',
        'production executions are disabled by feature flag',
        { executionId: execution.id },
      );
    }
    return ok();
  }
}
