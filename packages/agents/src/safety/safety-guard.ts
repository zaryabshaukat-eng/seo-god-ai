import type { AgentInput } from '../types/input.js';
import type { AgentResult } from '../types/output.js';
import { SafetyViolationError } from '../utils/errors.js';
import { isRejectedActionType, isSensitiveActionType } from './action-policy.js';

export interface SafetyGuard {
  /**
   * Verifies a result is safe to hand downstream. Throws on violation and
   * returns the (possibly normalized) result otherwise.
   */
  assertSafeResult(result: AgentResult, input: AgentInput): AgentResult;
}

/**
 * Enforces the platform safety policy: agents never destroy content, never
 * publish directly, never target resources outside the input, and every
 * sensitive proposal is forced to require approval.
 */
export class DefaultSafetyGuard implements SafetyGuard {
  assertSafeResult(result: AgentResult, input: AgentInput): AgentResult {
    const targetIds = new Set(input.entities.map((entity) => entity.id));
    for (const action of result.actions) {
      if (isRejectedActionType(action.actionType)) {
        throw new SafetyViolationError(
          `Action type "${action.actionType}" is rejected by the safety policy`,
          { operation: 'safety.assertSafeResult', context: { actionType: action.actionType } },
        );
      }
      if (!targetIds.has(action.resourceId)) {
        throw new SafetyViolationError(
          `Action targets resource "${action.resourceId}" that is not present in the input`,
          {
            operation: 'safety.assertSafeResult',
            context: { resourceId: action.resourceId },
          },
        );
      }
      if (typeof action.payload !== 'object' || action.payload === null || Array.isArray(action.payload)) {
        throw new SafetyViolationError(`Action "${action.actionType}" has an invalid payload`, {
          operation: 'safety.assertSafeResult',
          context: { actionType: action.actionType },
        });
      }
    }
    const recommendations = result.recommendations.map((recommendation) => {
      const sensitive =
        recommendation.affectedUrls.length > 0 &&
        (recommendation.severity === 'HIGH' || recommendation.severity === 'CRITICAL');
      return sensitive ? { ...recommendation, approvalRequired: true } : recommendation;
    });
    const actions = result.actions.map((action) => {
      const sensitive = isSensitiveActionType(action.actionType);
      return sensitive ? { ...action, rationale: `[approval required] ${action.rationale}` } : action;
    });
    return { ...result, recommendations, actions };
  }
}
